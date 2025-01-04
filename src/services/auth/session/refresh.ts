import { User } from 'firebase/auth';
import { logOperation } from '../../firebase/logging';
import { getNetworkStatus } from '../../firebase/network';
import { handleTokenError, validateTokenAge } from './handlers';
import { setSessionState, clearSessionState } from './state';
import { AUTH_ERROR_MESSAGES, SESSION_TIMEOUT, REFRESH_THRESHOLD } from './constants';
import { retryAuthOperation } from '../retry';

const REFRESH_RETRY_DELAY = 1000; // 1 second

export const refreshSession = async (user: User): Promise<void> => {
  try {
    const { isOnline } = getNetworkStatus();
    const cachedSession = sessionStorage.getItem('isAuthenticated');
    
    if (!isOnline) {
      if (cachedSession) {
        logOperation('refreshSession', 'warning', 'Offline - using cached session');
        return;
      }
      logOperation('refreshSession', 'error', {
        message: 'Network offline',
        userId: user.uid
      });
      throw new Error(AUTH_ERROR_MESSAGES['auth/network-request-failed']);
    }

    // First try to refresh the token
    await retryAuthOperation(
      () => user.getIdToken(true), 
      {
        operation: 'refreshToken',
        maxAttempts: 3,
        baseDelay: 1000,
        timeout: 10000
      }
    );

    // Get token result after refresh
    const result = await user.getIdTokenResult();
    
    // Update session state
    const now = Date.now();
    sessionStorage.setItem('lastTokenRefresh', now.toString());
    sessionStorage.setItem('tokenExpiration', (now + SESSION_TIMEOUT).toString());

    logOperation('refreshSession', 'success');
  } catch (error) {
    logOperation('refreshSession', 'error', error);
    
    // Only throw if online and no cached session
    if (isOnline || !cachedSession) {
      throw error;
    }
  }
};

export const setupSessionRefresh = (
  user: User,
  onRefresh: () => void,
  onError: (error: Error) => void
) => {
  let timeoutId: NodeJS.Timeout;

  const scheduleNextCheck = async () => {
    try {
      const tokenResult = await user.getIdTokenResult();
      const now = Date.now();
      const issuedAt = tokenResult.issuedAtTime ? new Date(tokenResult.issuedAtTime) : null;
      
      if (!issuedAt) {
        throw new Error('Invalid token issue time');
      }
      
      const tokenAge = now - issuedAt.getTime();
      const timeUntilRefresh = Math.max(0, SESSION_TIMEOUT - REFRESH_THRESHOLD - tokenAge);

      // Schedule next check
      timeoutId = setTimeout(async () => {
        try {
          await refreshSession(user);
          onRefresh();
          scheduleNextCheck(); // Schedule next check after successful refresh
        } catch (error) {
          // Schedule retry
          setTimeout(scheduleNextCheck, REFRESH_RETRY_DELAY);
          onError(error instanceof Error ? error : new Error('Session refresh failed'));
        }
      }, Math.max(0, timeUntilRefresh));
    } catch (error) {
      logOperation('scheduleNextCheck', 'error', error);
      setTimeout(scheduleNextCheck, REFRESH_RETRY_DELAY);
    }
  };

  // Start the refresh cycle
  scheduleNextCheck();

  // Return cleanup function
  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  };
};