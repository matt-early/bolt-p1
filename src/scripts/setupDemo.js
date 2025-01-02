import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyAM36LZtP1TlTn63UX0nKkZ5lQN5prFiWM",
  authDomain: "twodegrees-retail.firebaseapp.com",
  projectId: "twodegrees-retail",
  storageBucket: "twodegrees-retail.firebasestorage.app",
  messagingSenderId: "910958083337",
  appId: "1:910958083337:web:3c9b1dbf8a63cb1fada7d8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

import { initializeDemoData } from './initDemoData.js';

const setupDemo = async () => {
  try {
    await initializeDemoData(auth, db);
    console.log('Demo setup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Demo setup failed:', error);
    process.exit(1);
  }
};

setupDemo();