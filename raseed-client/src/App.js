import React, { useRef, useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import PassBuilder from './PassBuilder';
import './App.css'; // Import the new stylesheet

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

  const [lastSessionId, setLastSessionId] = useState('');

  const [showPassBuilder, setShowPassBuilder] = useState(false);
  const [passBuilderData, setPassBuilderData] = useState(null);

  const MessageBox = ({ message, onClose }) => {
    if (!showMessageBox) return null;
    return (
      <div className="message-box-overlay">
        <div className="message-box">
          <p className="message-box-text">{message}</p>
          <button onClick={onClose} className="btn btn-primary">
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

  // Firebase initialization and other functions remain the same...
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

  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  useEffect(() => {
    if (isCameraActive && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.warn("Video play interrupted.", e));
    }
  }, [isCameraActive, stream]);

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

  const stopCamera = useCallback(() => {
    setIsCameraActive(false);
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setStream(null);
  }, [stream]);

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
      if (result.type === 'PASS_BUILDER') {
        setPassBuilderData(result.content);
        setShowPassBuilder(true);
        setChatResponse('');
      } else {
        setChatResponse(result.content);
      }
    } catch (error) {
      console.error("Chat Error:", error);
      setChatResponse(`Error: ${error.message}`);
    } finally {
      setIsChatting(false);
      setChatQuestion('');
    }
  };


  return (
    <div className="app-container">
      <div className="content-wrapper">
        <h1 className="main-title">📸 Receipt Manager & Chat AI</h1>
        <p className="main-subtitle">
          Capture or upload receipt images to extract data, then ask questions about your receipts.
        </p>

        <div className="media-preview">
          {isLoading && (
            <div className="loading-overlay">
              Processing...
            </div>
          )}

          {isCameraActive && !capturedImage && (
            <video ref={videoRef} className="media-content" autoPlay playsInline muted />
          )}

          {capturedImage && (
            <img src={capturedImage} alt="Preview" className="media-content media-image" />
          )}

          {!isCameraActive && !capturedImage && !isLoading && (
            <div className="media-placeholder">
              Click <strong>Start Camera</strong> or <strong>Upload Receipt</strong>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <div className="action-buttons">
          {!isCameraActive && !capturedImage && (
            <>
              <button
                onClick={startCamera}
                disabled={isLoading || !isAuthReady}
                className="btn btn-green"
              >
                {isLoading ? "Starting..." : "Start Camera"}
              </button>
              <label
                htmlFor="file-upload"
                className="btn btn-blue"
              >
                Upload Receipt
              </label>
              <input
                id="file-upload"
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
                disabled={isLoading || !isAuthReady}
              />
            </>
          )}
          {isCameraActive && !capturedImage && (
            <button
              onClick={captureImage}
              disabled={isLoading}
              className="btn btn-indigo full-width"
            >
              Capture Image
            </button>
          )}
          {capturedImage && (
            <>
              <button
                onClick={uploadImageToBackend}
                disabled={isLoading || !isAuthReady}
                className="btn btn-purple"
              >
                {isLoading ? "Uploading..." : "Upload & Analyze"}
              </button>
              <button
                onClick={startCamera}
                disabled={isLoading}
                className="btn btn-red"
              >
                Retake
              </button>
            </>
          )}
        </div>

        <div className="chat-section">
          <h2 className="section-title">Ask a Question</h2>
          <form onSubmit={handleChatSubmit} className="chat-form">
            <input
              type="text"
              value={chatQuestion}
              onChange={(e) => setChatQuestion(e.target.value)}
              placeholder="Ask questions about your receipts history..."
              disabled={isChatting || !isAuthReady}
              className="chat-input"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={isChatting || !chatQuestion.trim() || !isAuthReady}
              className="btn btn-indigo"
            >
              {isChatting ? "Thinking..." : "Send"}
            </button>
          </form>

          {chatResponse && (
            <div className="chat-response">
              <h3>Answer:</h3>
              <p>{chatResponse}</p>
            </div>
          )}
        </div>
      </div>

      <MessageBox message={message} onClose={closeMessageBox} />
      {showPassBuilder && passBuilderData && (
        <PassBuilder
          passData={passBuilderData}
          onClose={() => setShowPassBuilder(false)}
        />
      )}
    </div>
  );
};

export default App;