import { logOperation } from './logging';

export interface NetworkStatus {
  isOnline: boolean;
  lastOnline: Date | null;
  isInitialized: boolean;
  retryCount: number;
}

let networkStatus: NetworkStatus = {
  isOnline: navigator.onLine,
  lastOnline: navigator.onLine ? new Date() : null,
  isInitialized: false,
  retryCount: 0
};

// Initialize network monitoring immediately
const initializeNetworkStatus = () => {
  const handleOnline = () => {
    networkStatus = {
      isOnline: true,
      lastOnline: new Date(),
      isInitialized: true,
      retryCount: 0
    };
    logOperation('network', 'online');
  };

  const handleOffline = () => {
    networkStatus = {
      ...networkStatus,
      isOnline: false,
      isInitialized: true,
      retryCount: networkStatus.retryCount + 1
    };
    logOperation('network', 'offline');
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // Set initial status
  networkStatus.isInitialized = true;
  networkStatus.isOnline = navigator.onLine;

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
};

// Initialize immediately
initializeNetworkStatus();

export const getNetworkStatus = (): NetworkStatus => networkStatus;

export const initNetworkMonitoring = (
  onOnline?: () => void,
  onOffline?: () => void
) => {
  const handleOnline = () => {
    networkStatus.isOnline = true;
    networkStatus.lastOnline = new Date();
    logOperation('network', 'online');
    onOnline?.();
  };

  const handleOffline = () => {
    networkStatus.isOnline = false;
    logOperation('network', 'offline');
    onOffline?.();
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
};

export const waitForNetwork = async (timeout = 30000): Promise<boolean> => {
  if (navigator.onLine) return true;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(false), timeout);
    
    const handleOnline = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('online', handleOnline);
      resolve(true);
    };

    window.addEventListener('online', handleOnline);
  });
};