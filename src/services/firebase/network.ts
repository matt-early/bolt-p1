import { logOperation } from './logging';

interface NetworkMonitoringCallbacks {
  onOnline: () => void;
  onOffline: () => void;
}

export interface NetworkStatus {
  isOnline: boolean;
  lastOnline: Date | null;
  isInitialized: boolean;
  connectionAttempts: number;
  lastAttempt: Date | null;
}

let networkStatus: NetworkStatus = {
  isOnline: navigator.onLine,
  lastOnline: navigator.onLine ? new Date() : null,
  isInitialized: false,
  connectionAttempts: 0,
  lastAttempt: null
};

const MIN_RETRY_INTERVAL = 5000; // Minimum 5 seconds between retries

export const getNetworkStatus = (): NetworkStatus => ({ ...networkStatus });

export const initNetworkMonitoring = (callbacks: NetworkMonitoringCallbacks): (() => void) => {
  const handleOnline = () => {
    networkStatus = {
      ...networkStatus,
      isOnline: true,
      lastOnline: new Date(),
      connectionAttempts: 0
    };
    logOperation('network', 'online');
    callbacks.onOnline();
  };

  const handleOffline = () => {
    networkStatus = {
      ...networkStatus,
      isOnline: false,
      connectionAttempts: networkStatus.connectionAttempts + 1,
      lastAttempt: new Date()
    };
    logOperation('network', 'offline');
    callbacks.onOffline();
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Set initial status and trigger appropriate callback
  networkStatus.isInitialized = true;
  networkStatus.isOnline = navigator.onLine;
  
  if (navigator.onLine) {
    callbacks.onOnline();
  } else {
    callbacks.onOffline();
  }

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
};

export const waitForNetwork = async (timeout = 30000): Promise<boolean> => {
  if (navigator.onLine) return true;

  const now = Date.now();
  if (networkStatus.lastAttempt) {
    const timeSinceLastAttempt = now - networkStatus.lastAttempt.getTime();
    if (timeSinceLastAttempt < MIN_RETRY_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_RETRY_INTERVAL - timeSinceLastAttempt));
    }
  }

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeout);

    const handleOnline = () => {
      cleanup();
      networkStatus.lastAttempt = new Date();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('online', handleOnline);
    };

    window.addEventListener('online', handleOnline);
  });
};