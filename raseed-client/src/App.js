import React, { useRef, useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const App = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const [stream, setStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [message, setMessage] = useState('');
  const [showMessageBox, setShowMessageBox] = useState(false);

  const [userId, setUserId] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [chatQuestion, setChatQuestion] = useState('');
  const [chatResponse, setChatResponse] = useState('');
  const [isChatting, setIsChatting] = useState(false);

  // Keep track of last uploaded session to optionally link chats
  const [lastSessionId, setLastSessionId] = useState('');

  // Show message popup
  const MessageBox = ({ message, onClose }) => {
    if (!showMessageBox) return null;
    return (
      <div className="fixed inset-0 bg-gray-700 bg-opacity-60 flex items-center justify-center p-4 z-50">
        <div className="bg-white p-6 rounded-xl shadow-xl max-w-sm w-full text-center">
          <p className="text-lg font-semibold mb-4">{message}</p>
          <button
            onClick={onClose}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition"
          >
            OK
          </button>
        </div>
      </div>
    );
  };

  const showCustomMessage = useCallback(msg => {
    setMessage(msg);
    setShowMessageBox(true);
  }, []);

  const closeMessageBox = () => {
    setShowMessageBox(false);
    setMessage('');
  };

  // Firebase initialization and anonymous auth
  useEffect(() => {
    const firebaseConfig = {
      apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
      authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
      storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.REACT_APP_FIREBASE_APP_ID,
    };

    if (!firebaseConfig.apiKey) {
      console.error("Firebase config missing");
      return;
    }

    try {
      const app = initializeApp(firebaseConfig);
      const firebaseAuth = getAuth(app);

      signInAnonymously(firebaseAuth).catch(error => {
        console.error("Anonymous sign-in failed:", error);
        showCustomMessage("Authentication failed. Please refresh the page.");
      });

      onAuthStateChanged(firebaseAuth, (user) => {
        if (user) {
          setUserId(user.uid);
          setIsAuthReady(true);
          console.log("Authenticated with uid:", user.uid);
        } else {
          setUserId('');
          setIsAuthReady(false);
        }
      });
    } catch (error) {
      console.error("Firebase initialization error:", error);
      showCustomMessage("Could not connect to Firebase.");
    }
  }, [showCustomMessage]);

  // Manage camera stream lifecycle
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  // Attach stream to video element
  useEffect(() => {
    if (isCameraActive && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.warn("Video play interrupted.", e));
    }
  }, [isCameraActive, stream]);

  // Start camera
  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setCapturedImage(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setStream(mediaStream);
      setIsCameraActive(true);
    } catch (err) {
      showCustomMessage(`Camera Error: ${err.name}. Please grant permission and try again.`);
      setIsCameraActive(false);
    } finally {
      setIsLoading(false);
    }
  }, [showCustomMessage]);

  // Stop camera
  const stopCamera = useCallback(() => {
    setIsCameraActive(false);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
  }, [stream]);

  // Capture image from camera
  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current || videoRef.current.videoWidth === 0) {
      showCustomMessage("Camera not ready. Please wait a moment.");
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/png');
    setCapturedImage(imageData);
    stopCamera();
  };

  // Handle image upload (camera capture or file picker) to backend
  const uploadImageToBackend = async () => {
    if (!capturedImage || !userId) {
      showCustomMessage("Cannot upload. Image or User ID missing.");
      return;
    }
    setIsLoading(true);
    setChatResponse('');

    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5001/process-image';

    try {
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageData: capturedImage,
          userId,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Upload failed.");
      }
      setLastSessionId(result.sessionId);
      showCustomMessage("Receipt processed successfully! You can now ask questions.");
      setCapturedImage(null);
    } catch (error) {
      console.error("Upload Error:", error);
      showCustomMessage(`Upload Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle file input change (upload photo)
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showCustomMessage("Please upload a valid image file.");
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => setCapturedImage(reader.result);
    reader.readAsDataURL(file);
  };

  // Handle chat submit (ask question)
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatQuestion.trim() || !userId) {
      showCustomMessage("Please type a question and be authenticated.");
      return;
    }
    setIsChatting(true);
    setChatResponse('');
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:5001/chat';

    try {
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: chatQuestion,
          userId,
          sessionId: lastSessionId || null,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "Failed to get a response.");
      }
      setChatResponse(result.content);
    } catch (error) {
      console.error("Chat Error:", error);
      setChatResponse(`Error: ${error.message}`);
    } finally {
      setIsChatting(false);
      setChatQuestion('');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 flex flex-col items-center justify-center p-6 font-sans">
      <div className="shadow-lg rounded-2xl border border-gray-300 bg-white p-8 max-w-lg w-full">
        <h1 className="text-4xl font-extrabold text-center text-gray-800 mb-4">📸 Receipt Manager & Chat AI</h1>
        <p className="text-center text-gray-600 mb-8">
          Capture or upload receipt images to extract data, then ask questions about your receipts.
        </p>

        <div className="relative w-full aspect-video bg-gray-900 rounded-xl overflow-hidden shadow-inner mb-6 flex items-center justify-center">
          {isLoading && (
            <div className="absolute inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 text-white text-xl font-semibold select-none">
              Processing...
            </div>
          )}

          {isCameraActive && !capturedImage && (
            <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
          )}

          {capturedImage && (
            <img src={capturedImage} alt="Preview" className="w-full h-full object-contain rounded-xl" />
          )}

          {!isCameraActive && !capturedImage && !isLoading && (
            <div className="text-gray-400 p-4 text-center select-none">
              Click <span className="font-semibold">Start Camera</span> or <span className="font-semibold">Upload Receipt</span>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {!isCameraActive && !capturedImage && (
            <>
              <button
                onClick={startCamera}
                disabled={isLoading || !isAuthReady}
                className="bg-green-600 hover:bg-green-700 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
              >
                {isLoading ? "Starting..." : "Start Camera"}
              </button>
              {/* File Upload */}
              <label
                htmlFor="file-upload"
                className="cursor-pointer bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg text-center select-none transition"
              >
                Upload Receipt
              </label>
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isLoading || !isAuthReady}
              />
            </>
          )}
          {isCameraActive && !capturedImage && (
            <button
              onClick={captureImage}
              disabled={isLoading}
              className="col-span-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
            >
              Capture Image
            </button>
          )}
          {capturedImage && (
            <>
              <button
                onClick={uploadImageToBackend}
                disabled={isLoading || !isAuthReady}
                className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
              >
                {isLoading ? "Uploading..." : "Upload & Analyze"}
              </button>
              <button
                onClick={startCamera}
                disabled={isLoading}
                className="bg-red-500 hover:bg-red-600 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
              >
                Retake
              </button>
            </>
          )}
        </div>

        {/* Chat Section */}
        <div className="border-t border-gray-300 pt-6">
          <h2 className="text-2xl font-bold text-gray-700 mb-4 text-center">Ask a Question</h2>
          <form onSubmit={handleChatSubmit}>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={chatQuestion}
                onChange={(e) => setChatQuestion(e.target.value)}
                placeholder="Ask questions about your receipts history..."
                disabled={isChatting || !isAuthReady}
                className="flex-grow p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 transition disabled:bg-gray-100"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={isChatting || !chatQuestion.trim() || !isAuthReady}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-lg transition disabled:opacity-50"
              >
                {isChatting ? "Thinking..." : "Send"}
              </button>
            </div>
          </form>

          {chatResponse && (
            <div className="mt-6 p-5 bg-gray-50 border border-gray-200 rounded-xl whitespace-pre-wrap text-gray-800 shadow-inner">
              <h3 className="font-semibold mb-2">Answer:</h3>
              <p>{chatResponse}</p>
            </div>
          )}
        </div>
      </div>

      <MessageBox message={message} onClose={closeMessageBox} />
    </div>
  );
};

export default App;
