import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';
import { logOperation } from './logging';
import { waitForNetwork } from './network';
import { clearCollectionCache } from './collections';
import { initNetworkMonitoring } from './network';
import { getFirebaseConfig } from '../../config/firebase-config';
import { setDb, setAuth } from './db';

const INIT_TIMEOUT = 15000; // 15 second timeout
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const RECONNECT_DELAY = 1000;

// Track initialization state
let initialized = false;
let initializationPromise: Promise<void> | null = null;
let app: ReturnType<typeof initializeApp> | null = null;
let networkCleanup: (() => void) | null = null;
let reconnectTimeout: number | null = null;

const clearReconnectTimeout = () => {
  if (reconnectTimeout) {
    window.clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
};

export const getFirebaseApp = async () => {
  if (!app) {
    await initializeFirebaseServices();
  }
  if (!app) {
    throw new Error('Firebase app not initialized');
  }
  return app;
};

const initializeWithTimeout = async () => {
  return Promise.race([
    initializeCore(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firebase initialization timed out')), INIT_TIMEOUT)
    )
  ]);
};

const initializeCore = async () => {
  try {
    const config = getFirebaseConfig();
    
    // Wait for any existing app to be fully initialized
    if (app) {
      try {
        const auth = getAuth(app);
        const db = getFirestore(app);
        return { auth, db };
      } catch (error) {
        logOperation('initializeCore', 'warning', 'Existing app not ready');
      }
    }
    
    // Check if app already exists
    try {
      if (app) {
        const auth = getAuth(app);
        const db = getFirestore(app);
        return { auth, db };
      }
    } catch (error) {
      logOperation('initializeCore', 'warning', 'Failed to get existing app');
    }
    
    app = initializeApp(config);
    const auth = getAuth(app);
    const db = getFirestore(app);

    setAuth(auth);
    setDb(db);

    // Clear cache
    clearCollectionCache();
    
    // Enable offline persistence
    try {
      await enableIndexedDbPersistence(db);
      logOperation('initializeCore', 'persistence-enabled');
      initialized = true;
      initialized = true;
    } catch (err: any) {
      if (err.code === 'failed-precondition') {
        logOperation('initializeCore', 'warning', 'Multiple tabs open');
      } else if (err.code === 'unimplemented') {
        logOperation('initializeCore', 'warning', 'Persistence not supported');
      }
      // Still mark as initialized even if persistence fails
      initialized = true;
    }

    return { auth, db };
  } catch (error) {
    logOperation('initializeCore', 'error', error);
    throw error;
  }
};

const setupNetworkMonitoring = () => {
  return initNetworkMonitoring(
    // On online
    async () => {
      clearReconnectTimeout();
      if (!initialized && !initializationPromise) {
        logOperation('network', 'online', 'Retrying initialization');
        try {
          await initializeFirebaseServices();
        } catch (error) {
          logOperation('network.retry', 'error', error);
          scheduleReconnect();
        }
      }
    },
    // On offline
    () => {
      logOperation('network', 'offline');
      scheduleReconnect();
    }
  );
};

const scheduleReconnect = () => {
  clearReconnectTimeout();
  reconnectTimeout = window.setTimeout(async () => {
    try {
      await initializeFirebaseServices();
    } catch (error) {
      logOperation('reconnect', 'error', error);
      scheduleReconnect(); // Schedule another attempt
    }
  }, RECONNECT_DELAY);
};

export const initializeFirebaseServices = async () => {
  if (initialized) return;
  if (initializationPromise) return initializationPromise;

  let retryCount = 0;

  // Setup network monitoring if not already setup
  if (!networkCleanup) {
    networkCleanup = setupNetworkMonitoring();
  }

  initializationPromise = (async () => {
    try {
      logOperation('initializeFirebaseServices', 'start');

      while (retryCount < MAX_RETRIES) {
        try {
          // Wait for network if offline
          if (!navigator.onLine) {
            await waitForNetwork(INIT_TIMEOUT);
          }

          await initializeWithTimeout();
          initialized = true;
          retryCount = 0;
          clearReconnectTimeout(); // Clear any pending reconnect
          logOperation('initializeFirebaseServices', 'success');
          return;
        } catch (error) {
          retryCount++;
          if (retryCount === MAX_RETRIES) throw error;

          logOperation('initializeFirebaseServices', 'retry', {
            attempt: retryCount,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, retryCount - 1)));
        }
      }
    } catch (error) {
      logOperation('initializeFirebaseServices', 'error', error);
      initialized = false;
      scheduleReconnect();
      throw error;
    } finally {
      initializationPromise = null;
    }
  })();

  return initializationPromise;
};

// Clean up on module unload
window.addEventListener('unload', () => {
  clearReconnectTimeout();
  if (networkCleanup) {
    networkCleanup();
  }
});

// Export the app instance
export { app };