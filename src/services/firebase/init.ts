import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { logOperation } from './logging';
import { clearCollectionCache } from './collections';
import { initNetworkMonitoring } from './network';
import { getFirebaseConfig } from '../../config/firebase-config';
import { setDb, setAuth } from './db';

// Track initialization state
let initialized = false;
let initializationPromise: Promise<void> | null = null;
let app: ReturnType<typeof initializeApp> | null = null;
let networkCleanup: (() => void) | null = null;
let initAttempts = 0;

const MAX_INIT_ATTEMPTS = 3;
const INIT_TIMEOUT = 30000; // 30 seconds

export const getFirebaseApp = async () => {
  if (!app) {
    await initializeFirebaseServices();
  }
  if (!app) {
    throw new Error('Firebase app not initialized');
  }
  return app;
};

const setupNetworkMonitoring = () => {
  return initNetworkMonitoring(
    // On online - retry initialization if failed
    async () => {
      if (!initialized && !initializationPromise) {
        initAttempts = 0;
        logOperation('network', 'online', 'Retrying initialization');
        try {
          await initializeFirebaseServices();
        } catch (error) {
          logOperation('network.retry', 'error', error);
        }
      }
    },
    // On offline - log error
    () => {
      logOperation('network', 'offline');
    }
  );
};

export const initializeFirebaseServices = async () => {
  if (initialized) return;
  if (initializationPromise) return initializationPromise;

  // Reset initialization state
  initialized = false;
  
  // Check max attempts
  if (initAttempts >= MAX_INIT_ATTEMPTS) {
    const error = new Error('Failed to initialize Firebase after multiple attempts');
    logOperation('initializeFirebaseServices', 'error', { 
      error,
      attempts: initAttempts 
    });
    throw error;
  }
  
  initAttempts++;

  // Setup network monitoring if not already setup
  if (!networkCleanup) {
    networkCleanup = setupNetworkMonitoring();
  }

  initializationPromise = (async () => {
    try {
      logOperation('initializeFirebaseServices', 'start');

      const config = getFirebaseConfig();

      // Initialize Firebase
      app = initializeApp(config);
      const auth = getAuth(app);
      const db = getFirestore(app);

      // Set instances in db service
      setAuth(auth);
      setDb(db);

      // Clear cache
      clearCollectionCache();
      
      // Enable offline persistence
      try {
        await enableIndexedDbPersistence(db);
        logOperation('initializeFirebaseServices', 'persistence-enabled');
      } catch (err: any) {
        if (err.code === 'failed-precondition') {
          logOperation('initializeFirebaseServices', 'warning', 'Multiple tabs open');
        } else if (err.code === 'unimplemented') {
          logOperation('initializeFirebaseServices', 'warning', 'Persistence not supported');
        }
      }

      initialized = true;
      initAttempts = 0;
      logOperation('initializeFirebaseServices', 'success');

    } catch (error) {
      logOperation('initializeFirebaseServices', 'error', error);
      
      // Handle offline case
      if (!navigator.onLine && networkCleanup) {
        networkCleanup();
        networkCleanup = setupNetworkMonitoring();
      }
      
      initialized = false;
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
};

// Export the app instance
export { app };