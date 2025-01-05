const setupNetworkMonitoring = () => {
  return initNetworkMonitoring({
    onOnline: async () => {
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
    onOffline: () => {
      logOperation('network', 'offline');
      scheduleReconnect();
    }
  });
};