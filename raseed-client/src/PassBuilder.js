import React, { useState } from 'react';


// This component receives the grocery list data from your chat response
function PassBuilder({ passData }) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // This function is called when the user clicks the final button
  const handleAddToWallet = async () => {
    // Basic validation
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Make an API call to your Python backend's new endpoint
      const response = await fetch('http://localhost:5001/create-wallet-pass', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Send the email and the original pass data to the backend
        body: JSON.stringify({
          email: email,
          passData: passData,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        // Handle errors from the backend
        throw new Error(result.error || 'An unknown error occurred.');
      }

      // If successful, the backend returns the save URL. Redirect the user to it.
      if (result.saveUrl) {
        window.location.href = result.saveUrl;
      }

    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="pass-builder-container">
      <h2>Create Your Grocery Pass</h2>
      
      <div className="grocery-list">
        <h3>Your Items:</h3>
        <ul>
          {passData.items && passData.items.map((item, index) => (
            <li key={index}>
              {item.name} <span>(Quantity: {item.quantity || 1})</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="email-form">
        <p>Enter your email to add this list to your Google Wallet.</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="your.email@example.com"
          disabled={isLoading}
        />
        <button onClick={handleAddToWallet} disabled={isLoading}>
          {isLoading ? 'Creating...' : 'Add to Google Wallet'}
        </button>
      </div>

      {error && <p className="error-message">{error}</p>}
    </div>
  );
}

export default PassBuilder;