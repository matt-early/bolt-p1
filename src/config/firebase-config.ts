import { FirebaseOptions } from 'firebase/app';
import { logOperation } from '../services/firebase/logging';

// Required Firebase config fields
const REQUIRED_FIELDS = [
  'apiKey',
  'authDomain', 
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId'
];

// Production Firebase configuration
export const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const getFirebaseConfig = (): FirebaseOptions => {
  try {
    // Check for missing required fields
    const missingFields = REQUIRED_FIELDS.filter(field => !firebaseConfig[field as keyof FirebaseOptions]);

    if (missingFields.length > 0) {
      throw new Error(
        `Missing required Firebase configuration fields:\n${missingFields.join('\n')}`
      );
    }

    logOperation('getFirebaseConfig', 'success', 'Production config loaded');
    return firebaseConfig;
  } catch (error) {
    logOperation('getFirebaseConfig', 'error', error);
    throw error;
  }
};