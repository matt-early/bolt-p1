import { User } from 'firebase/auth';
import { getAuth } from '../../firebase/db';
import { logOperation } from '../../firebase/logging';
import { getNetworkStatus, waitForNetwork } from '../../firebase/network';
import { clearSessionState } from './state';
import { 
  SESSION_TIMEOUT, 
  GRACE_PERIOD, 
  NETWORK_TIMEOUT,
  AUTH_ERROR_MESSAGES
} from './constants';

export const validateTokenResult = async (user: User): Promise<boolean> => {
  try {
    // Get token without forcing refresh first
    const token = await user.getIdToken(false);
    if (!token) {
      return false;
    }

    // Get token result
    const tokenResult = await user.getIdTokenResult();
    const now = Date.now();
    const issuedAt = tokenResult.issuedAtTime ? new Date(tokenResult.issuedAtTime) : null;
    
    if (!issuedAt) {
      logOperation('validateTokenResult', 'error', 'Invalid token issue time');
      return false;
    }

    const tokenAge = now - issuedAt.getTime();
    if (tokenAge > SESSION_TIMEOUT + GRACE_PERIOD) {
      logOperation('validateTokenResult', 'error', 'Session expired');
      return false;
    }

    // Store token refresh time
    sessionStorage.setItem('lastTokenRefresh', now.toString());
    sessionStorage.setItem('tokenExpiration', (now + SESSION_TIMEOUT).toString());
    
    return true;
  } catch (error) {
    logOperation('validateTokenResult', 'error', error);
    return false;
  }
};

export const validateSession = async (user: User | null): Promise<boolean> => {
  try {
    if (!user) {
      clearSessionState();
      return false;
    }

    const { isOnline } = getNetworkStatus();
    const cachedSession = sessionStorage.getItem('isAuthenticated');
    const lastRefresh = sessionStorage.getItem('lastTokenRefresh');
    
    // If offline, use cached session
    if (!isOnline && cachedSession && lastRefresh) {
      const age = Date.now() - parseInt(lastRefresh, 10);
      if (age > SESSION_TIMEOUT) {
        clearSessionState();
        return false;
      }
      return true;
    }

    // Online validation
    try {
      const isValid = await validateTokenResult(user);
      if (!isValid) {
        // Only clear session if online
        if (isOnline) {
          clearSessionState();
          return false;
        }
        return !!cachedSession;
      }

      logOperation('validateSession', 'success', { userId: user.uid });
      return true;
    } catch (error: any) {
      logOperation('validateSession', 'error', error);
      // Only clear session if online
      if (isOnline) {
        clearSessionState();
        return false;
      }
      return !!cachedSession;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Session validation failed';
    logOperation('validateSession', 'error', { userId: user?.uid, error: errorMessage });
    return !!cachedSession;
  }
};