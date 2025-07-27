import os
import json
import requests
from datetime import datetime
from dotenv import load_dotenv

# LangChain and Google Cloud imports
from langchain_google_vertexai import ChatVertexAI
from langchain.schema import HumanMessage
from google.oauth2 import service_account

# Firebase and Flask imports
import firebase_admin
from firebase_admin import credentials, firestore
from flask import Flask, request, jsonify
from flask_cors import CORS

from google.auth.transport.requests import AuthorizedSession
import jwt

# Load environment variables from .env file
load_dotenv()


class ImageChatService:
    def __init__(self):
        # Get and validate environment variables first
        project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
        location = os.getenv("GOOGLE_CLOUD_REGION")
        self.ISSUER_ID = os.getenv("GOOGLE_WALLET_ISSUER_ID")
        if not project_id or not location:
            raise ValueError("GIP_PROJECT_ID and GCP_LOCATION environment variables must be set in your .env file.")

        # UPDATED: Initialize ChatVertexAI with validated variables
        self.llm = ChatVertexAI(
            project=project_id,
            location=location,
            model_name=os.getenv("MODEL_NAME", "gemini-1.5-flash-001"),
            temperature=0.7,
        )
        self.key_file_path = os.environ.get('GOOGLE_WALLET_CREDENTIALS_PATH',
            os.path.join(os.getcwd(), 'google-wallet-credentials.json')
        )
        print(f"DEBUG: Using key file path: {self.key_file_path}")
        if not self.key_file_path or not os.path.exists(self.key_file_path):
            raise ValueError("GOOGLE_WALLET_CREDENTIALS_PATH environment variable not set or file not found.")
        self._init_firebase()
        self._init_google_wallet_auth() # <-- Add this line

    def _init_firebase(self):
        if not firebase_admin._apps:
            cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
            if not cred_path:
                raise ValueError("FIREBASE_CREDENTIALS_PATH environment variable not set.")
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        self.db = firestore.client()

    # In your ImageChatService class

    def _init_google_wallet_auth(self):
        """Initializes credentials for signing and creating Wallet passes."""
        # Load credentials from the specific wallet JSON file
        cred_path = self.key_file_path  # Use the path we already validated in __init__

        if not cred_path or not os.path.exists(cred_path):
            raise ValueError("GOOGLE_WALLET_CREDENTIALS_PATH env variable not set or file not found.")

        # Load the service account info from JSON file
        with open(cred_path, 'r') as f:
            service_account_info = json.load(f)

        # Create a credentials object from the service account info
        self.google_credentials = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/wallet_object.issuer"]
        )

        # For making authorized API calls to Google Wallet API
        self.auth_session = AuthorizedSession(self.google_credentials)

        # For signing the JWT for the pass - extract from the JSON file
        self.service_account_email = service_account_info['client_email']
        self.private_key = service_account_info['private_key']
        
    def _clean_llm_json_response(self, llm_response_text: str) -> str:
        # Helper to strip markdown from LLM JSON responses
        text = llm_response_text.strip()
        if text.startswith("```json"):
            text = text[len("```json"):].lstrip()
        elif text.startswith("```"):
            text = text[len("```"):].lstrip()
        if text.endswith("```"):
            text = text[:-len("```")].rstrip()
        return text

    # --- NEW: Google Wallet Authentication and Helpers ---
    def _create_pass_class(self):
        """Creates the pass class on Google's servers if it doesn't exist."""
        class_id = f"{self.ISSUER_ID}.project_grocery_list"
        url = f"https://walletobjects.googleapis.com/walletobjects/v1/genericClass/{class_id}"
        
        try:
            response = self.auth_session.get(url)
            if response.status_code == 200:
                print(f"DEBUG: Pass class '{class_id}' already exists.")
                return True # Class already exists
            
            if response.status_code != 404:
                print(f"Error checking pass class: {response.text}")
                return False # Unexpected error

            # Class not found, so create it
            class_payload = {
                "id": class_id,
                "cardTitle": {"defaultValue": {"language": "en", "value": "Grocery List"}},
                "header": {"defaultValue": {"language": "en", "value": "Your Items"}},
                "hexBackgroundColor": "#4285f4",
                "logo": {"sourceUri": {"uri": "https://storage.googleapis.com/wallet-lab-tools-codelab-artifacts-public/pass_google_logo.jpg"}}
            }
            response = self.auth_session.post("https://walletobjects.googleapis.com/walletobjects/v1/genericClass", json=class_payload)
            response.raise_for_status()
            print(f"DEBUG: Pass class '{class_id}' created successfully.")
            return True
        except Exception as e:
            print(f"ERROR: Failed to create/verify pass class: {e}")
            return False


    def create_wallet_pass_jwt(self, user_email: str, pass_data: dict) -> dict:
        """Creates the final pass object and a signed JWT for the 'Add to Wallet' button."""
        self._create_pass_class() # Ensure class exists before creating an object
        
        class_id = f"{self.ISSUER_ID}.project_grocery_list"
        object_id_suffix = f"{user_email.replace('@', '_at_')}-{int(datetime.now().timestamp())}"
        object_id = f"{self.ISSUER_ID}.{object_id_suffix}"

        # Create text modules from the grocery list items
        print(f"DEBUG: Creating pass for user: {user_email} with object ID: {object_id} pass_data: {pass_data}  ")
        text_modules = []
        for i, item in enumerate(pass_data.get('items', [])):
            name = item.get('name', 'Unknown Item')
            quantity = item.get('quantity', 1)
            text_modules.append({
                "id": f"item_{i}",
                "header": name,
                "body": f"Quantity: {quantity}"
            })

        pass_object = {
            "id": object_id,
            "classId": class_id,
            "genericType": "GENERIC_TYPE_UNSPECIFIED",
            "hexBackgroundColor": "#fbbc04",
            "cardTitle": {"defaultValue": {"language": "en", "value": "Your Grocery List"}},
            "header": {"defaultValue": {"language": "en", "value": user_email}},
            "barcode": {"type": "QR_CODE", "value": object_id},
            "textModulesData": text_modules
        }

        claims = {
            "iss": self.service_account_email,
            "aud": "google",
            "typ": "savetowallet",
            "origins": ["http://localhost:3000", "http://localhost:3001"], # IMPORTANT: Add your frontend's URL here
            "payload": {"genericObjects": [pass_object]},
        }

        token = jwt.encode(claims, self.private_key, algorithm="RS256")
        save_url = f"https://pay.google.com/gp/v/save/{token}"
        
        return {"saveUrl": save_url}

    # --- Price Comparison and Location Tools ---

    def _get_user_location(self) -> dict:
        """Get user location from IP address for context."""
        try:
            response = requests.get('https://ipapi.co/json/', timeout=5)
            response.raise_for_status()
            location_data = response.json()
            return {
                'city': location_data.get('city', 'Unknown'),
                'region': location_data.get('region', 'Unknown'),
                'country': location_data.get('country_name', 'Unknown')
            }
        except Exception as e:
            print(f"DEBUG: Location detection failed: {e}")
            return {'city': 'Unknown', 'region': 'Unknown', 'country': 'United States'}

    def _search_prices_tool(self, query: str) -> dict:
        """Tool for searching product prices using Google Custom Search API."""
        api_key = os.getenv("GOOGLE_API_KEY")
        search_engine_id = os.getenv("SEARCH_ENGINE_ID")
        
        if not api_key or not search_engine_id:
            return {"error": "Price search unavailable - missing API credentials", "available": False}
        
        location = self._get_user_location()
        search_query = f"{query} best prices in {location['city']} {location['country']}, more emphasis on online availability and country"

        try:
            url = "https://www.googleapis.com/customsearch/v1"
            params = {"key": api_key, "cx": search_engine_id, "q": search_query, "num": 5}
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            return {"results": response.json(), "available": True}
        except requests.exceptions.HTTPError as e:
            return {"error": f"API returned status {e.response.status_code}", "available": False}
        except requests.exceptions.RequestException as e:
            return {"error": f"Network or request error: {str(e)}", "available": False}

    # --- Conversational Logic Handlers ---

    def _detect_intent(self, user_input: str) -> str:
        """Uses the LLM to classify the user's primary intent."""
        prompt = f"""
        Analyze the user's request and classify its intent. The possible intents are:
        - 'PRICE_COMPARISON': For any question about the price of an item, cost, or comparing prices.
        - 'CREATE_PASS': For any request to generate a grocery list or pass.
        - 'GENERAL_QUESTION': For any other question, especially about their past receipts.

        User Request: "{user_input}"
        Intent:"""
        response = self.llm.invoke(prompt)
        detected_intent = response.content.strip().upper()

        if "PRICE_COMPARISON" in detected_intent:
            return "PRICE_COMPARISON"
        if "CREATE_PASS" in detected_intent:
            return "CREATE_PASS"
        return "GENERAL_QUESTION"

    def _handle_price_comparison(self, question: str) -> dict:
        """Handles the entire flow for a price comparison question."""
        extraction_prompt = f"From the following user question, extract just the name of the product or item they are asking about. For example, from 'how much is an iphone 15 pro max 256gb these days?', extract 'iphone 15 pro max 256gb'.\n\nQuestion: '{question}'"
        product_query = self.llm.invoke(extraction_prompt).content.strip().replace('"', '')

        if not product_query:
            return {"type": "text", "content": "I'm sorry, I couldn't understand which product you're asking about. Please be more specific."}

        print(f"DEBUG: Searching online for: '{product_query}'")
        search_results = self._search_prices_tool(product_query)

        if not search_results.get("available"):
            error_msg = search_results.get("error", "An unknown error occurred.")
            return {"type": "text", "content": f"I couldn't search for prices right now. Reason: {error_msg}"}
        
        if "items" not in search_results.get("results", {}):
             return {"type": "text", "content": f"I couldn't find any specific online listings for '{product_query}'. You could try a broader search term."}

        synthesis_prompt = f"""
        You are a helpful price comparison assistant. A user asked: "{question}"
        I performed a web search and found these results: {json.dumps(search_results.get('results', {}), indent=2)}
        Based *only* on these search results, provide a concise answer. Summarize the prices found, mentioning the source website (from the 'title' or 'displayLink').
        If the results do not contain specific prices, state that you couldn't find exact pricing information but can provide the links. Do not make up information.
        """
        final_answer = self.llm.invoke(synthesis_prompt).content
        return {"type": "text", "content": final_answer}

    def _handle_receipt_question(self, question: str, user_id: str, session_id: str) -> dict:
        """Handles the logic for answering questions about saved receipts."""
        receipts_query = self.db.collection("receipts").stream()
        user_receipts = [doc.to_dict() for doc in receipts_query]
        if not user_receipts:
            return {"type": "text", "content": "No receipt data found. Please upload a receipt image first."}

        chat_history_query = self.db.collection("chat_history").where("user_id", "==", user_id)\
            .order_by("timestamp", direction=firestore.Query.DESCENDING).limit(10).stream()
        recent_chats = [doc.to_dict() for doc in chat_history_query]

        context = {"receipts": user_receipts, "chat_history": recent_chats}
        prompt = f"""You are a helpful assistant answering questions about receipts.
        Context: {json.dumps(context, default=str)}
        User question: {question}
        Answer based ONLY on the above data."""

        response = self.llm.invoke([HumanMessage(content=prompt)])
        answer = response.content

        chat_entry = {
            "user_id": user_id, "question": question, "answer": answer,
            "timestamp": datetime.now(), "session_id": session_id or None
        }
        self.db.collection("chat_history").add(chat_entry)
        return {"type": "text", "content": answer}

    # --- Main Conversational Router ---
    
    def answer_question(self, question: str, user_id: str, session_id: str = None) -> dict:
        """Acts as a router. Detects intent and delegates to the appropriate handler."""
        if not user_id:
            return {"type": "error", "content": "User ID is required."}

        intent = self._detect_intent(question)
        print(f"DEBUG: Detected intent: {intent}")

        if intent == "PRICE_COMPARISON":
            return self._handle_price_comparison(question)
            
        elif intent == "CREATE_PASS":
            pass_data = self.create_grocery_pass(question, user_id)
            if "error" in pass_data:
                return {"type": "error", "content": f"Sorry, failed to create grocery pass: {pass_data['error']}"}
            
            # This now correctly returns the dictionary object
            return {"type": "PASS_BUILDER", "content": pass_data} 
            
        else: # GENERAL_QUESTION
            return self._handle_receipt_question(question, user_id, session_id)

    # --- Other Functionalities ---

    def create_grocery_pass(self, grocery_list: str, user_id: str) -> dict:
        """Generates a structured grocery list from user text."""
        prompt = f"""
            Format the user's grocery list into a JSON object with a 'user_id' and a list of 'items',
            each with 'name' and optional 'quantity'.
            User request: \"\"\"{grocery_list}\"\"\"
            Return ONLY the JSON object.
            """
        message = HumanMessage(content=prompt)
        response = self.llm.invoke([message])
        raw_json_str = self._clean_llm_json_response(response.content)
        try:
            pass_data = json.loads(raw_json_str)
            pass_data['user_id'] = user_id
            return pass_data
        except json.JSONDecodeError:
            return {"error": "Failed to parse grocery pass from LLM response.", "raw_response": response.content}

    def _extract_json_from_image(self, image_data_uri: str, user_id: str) -> dict:
        """Analyzes a receipt image and extracts structured data."""
        upload_timestamp = datetime.now()
        
        # UPDATED: The prompt now asks for a list of items
        prompt = f"""
        Analyze this receipt image and extract a JSON object with the following details.
        - The `items` field should be a list of all items found on the receipt.
        - Each item in the list should be an object with its own `name`, `price`, and `quantity`.
        - Also include `purchase_date` and `purchase_place` for the overall receipt.
        - If `purchase_date` is missing, use today's date: {upload_timestamp.strftime('%Y-%m-%d')}.
        - Return ONLY the JSON object without extra text or markdown.
        
        Example format:
        {{
        "items": [
            {{ "name": "Milk", "price": 2.50, "quantity": 1 }},
            {{ "name": "Bread", "price": 1.75, "quantity": 2 }}
        ],
        "purchase_date": "2025-07-27",
        "purchase_place": "SuperMart"
        }}
        """

        message = HumanMessage(content=[{"type": "text", "text": prompt}, {"type": "image_url", "image_url": {"url": image_data_uri}}])
        response = self.llm.invoke([message])

        try:
            raw_json_str = self._clean_llm_json_response(response.content)
            parsed_data = json.loads(raw_json_str)
            
            # Add the userId to the top-level of the parsed data
            parsed_data["userId"] = user_id
            
            if not parsed_data.get("purchase_date"):
                parsed_data["purchase_date"] = upload_timestamp.strftime('%Y-%m-%d')
                
            return parsed_data
        except json.JSONDecodeError:
            return {"error": "Failed to parse content into JSON.", "raw_response": response.content}
    def process_and_save_image(self, image_data_uri: str, user_id: str) -> str:
        """Processes an image, extracts data, and saves the entire receipt as a single document in Firestore."""
        print(f"Processing image for user: {user_id}")
        extracted_data = self._extract_json_from_image(image_data_uri, user_id)
        if "error" in extracted_data:
            raise ValueError("Failed to extract JSON data from the image.")

        # Create one document for the entire receipt
        receipt_doc = {
            "user_id": user_id,
            "items": extracted_data.get("items", []), # Store all items as an array
            "purchase_date": extracted_data.get("purchase_date"),
            "purchase_place": extracted_data.get("purchase_place"),
            "upload_timestamp": datetime.now(),
            "last_updated": datetime.now(),
        }

        # Add the single document to Firestore
        update_time, doc_ref = self.db.collection("receipts").add(receipt_doc)
        doc_id = doc_ref.id
        print(f"Saved receipt with doc ID: {doc_id}")
        return doc_id

    def create_grocery_pass(self, grocery_list: str, user_id: str) -> dict:
        prompt = f"""Format the user's grocery list into a JSON object with a 'user_id' and a list of 'items', each with 'name' and optional 'quantity'. User request: \"\"\"{grocery_list}\"\"\" Return ONLY the JSON object."""
        message = HumanMessage(content=prompt)
        response = self.llm.invoke([message])
        raw_json_str = self._clean_llm_json_response(response.content)
        try:
            pass_data = json.loads(raw_json_str)
            pass_data['user_id'] = user_id
            return pass_data
        except json.JSONDecodeError: return {"error": "Failed to parse grocery pass from LLM response.", "raw_response": response.content}

# --- Flask App Setup ---

app = Flask(__name__)
CORS(app, origins=["http://localhost:3000", "http://localhost:3001"])
image_chat_service = ImageChatService()

@app.route("/process-image", methods=["POST"])
def process_image_endpoint():
    data = request.get_json()
    if not data or "imageData" not in data or "userId" not in data:
        return jsonify({"error": "Missing 'imageData' or 'userId'"}), 400
    try:
        doc_id = image_chat_service.process_and_save_image(data["imageData"], data["userId"])
        return jsonify({"message": "Image processed successfully", "docId": doc_id}), 201
    except Exception as e:
        print(f"Error in /process-image: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/create-wallet-pass", methods=["POST"])
def create_wallet_pass_endpoint():
    data = request.get_json() # Use get_json() to parse the request
    if not data or "email" not in data or "passData" not in data:
        return jsonify({"error": "Missing 'email' or 'passData' in request"}), 400

    try:
        email = data["email"]
        pass_data = data["passData"] # This will now be a dictionary
        
        result = image_chat_service.create_wallet_pass_jwt(email, pass_data)
        return jsonify(result), 200
    except Exception as e:
        print(f"Error in /create-wallet-pass: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/chat", methods=["POST"])
def chat_endpoint():
    """Main conversational endpoint that now returns a structured dictionary."""
    data = request.get_json()
    if not data or "question" not in data or "userId" not in data:
        return jsonify({"error": "Missing 'question' or 'userId'"}), 400
    try:
        response_data = image_chat_service.answer_question(data["question"], data["userId"], session_id=data.get("sessionId"))
        return jsonify(response_data)
    except Exception as e:
        print(f"Error in /chat: {e}")
        return jsonify({"type": "error", "content": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)