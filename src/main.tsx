import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { initializeFirebaseServices } from './services/firebase/init';
import { AuthErrorBoundary } from './components/Auth/AuthErrorBoundary';
import { AuthProvider } from './providers/AuthProvider';
import App from './App';
import './index.css';

// Initialize Firebase before rendering
initializeFirebaseServices().then(() => {
  const root = createRoot(document.getElementById('root')!);

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <AuthErrorBoundary>
            <App />
          </AuthErrorBoundary>
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>
  );
}).catch(error => {
  console.error('Failed to initialize Firebase:', error);
});