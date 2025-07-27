# Image Chat with Firebase

AI-powered image analysis tool that extracts structured data from images and stores conversations in Firebase.

## Features

- Upload images via file path or URL
- Interactive Q&A about image content
- Extract structured JSON data from images
- Store sessions and conversations in Firebase

## Installation

### Option 1: Using uv (Recommended)

1. Install uv:

**Windows:**
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

**macOS/Linux:**
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

2. Create virtual environment and install dependencies:

**Windows:**
```cmd
uv venv
.venv\Scripts\activate
uv pip install -r requirements.txt
```

**macOS/Linux:**
```bash
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

### Option 2: Traditional pip/venv

**Windows:**
```bash
python -m venv .venv
.venv\Scripts\activate
```

**macOS/Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Install Dependencies:**
```bash
pip install -r requirements.txt
```

### 3. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project or select existing one
3. Enable Firestore Database:
   - Go to "Firestore Database" in left sidebar
   - Click "Create database"
   - Choose "Start in test mode" or "Start in production mode"
   - Select a location
4. Enable Firestore API:
   - Visit the [API Console](https://console.developers.google.com/apis/api/firestore.googleapis.com/overview)
   - Click "Enable" if not already enabled
5. Create Service Account:
   - Go to Project Settings > Service Accounts
   - Click "Generate new private key"
   - Save as `firebase_credentials.json` in project directory

### 4. Environment Variables

Create `.env` file:
```
GOOGLE_API_KEY=your_google_api_key
MODEL_NAME=gemini-2.0-flash
FIREBASE_CREDENTIALS_PATH=firebase_credentials.json
```

## Usage

```bash
python3 image_chat_firebase.py
```

### Commands
- Enter any question about the image
- Type `save` to store session to Firebase
- Type `quit` to exit

## Requirements

- Python 3.8+
- Google AI API key ([Get one here](https://makersuite.google.com/app/apikey))
- Firebase project with Firestore enabled
- Firebase service account credentials

## Troubleshooting

**Firestore API Error:**
- Enable Firestore API at the provided console link
- Wait 2-3 minutes after enabling

**Database Not Found:**
- Create Firestore database in Firebase Console
- Ensure you selected the correct project

**Credentials Error:**
- Verify `firebase_credentials.json` path in `.env`
- Ensure service account has Firestore permissions

## Example

```
=== Image Chat with Firebase ===
Choose mode:
1. Upload - Process and store image to Firebase
2. Chat - Ask questions about stored data

Enter choice (1/2) or 'quit': 1
=== UPLOAD MODE ===
Enter image path or URL: grocery_bill.png          
Image processed and saved to Firebase with ID: Oa5sWvpaeKkUwOtmeAAy
Upload time: 2025-07-23 03:12:55
=== CHAT MODE ===
Ask questions about your uploaded data. Type 'quit' to exit.

Your question: when did i buy eggs
Answer: Based on the data, you bought "Large Eggs" on two occasions:

*   **July 23, 2025**
*   **May 22, 2024**
```

## Deactivate Virtual Environment

```bash
deactivate
```