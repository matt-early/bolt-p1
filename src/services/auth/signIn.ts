import { signInWithEmailAndPassword, type AuthError as FirebaseAuthError } from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { AUTH_SETTINGS } from '../../config/auth-settings';
import { logOperation } from '../firebase/logging';
import { retryAuthOperation } from './retry';
import { handleAuthNetworkError } from './network';
import { AUTH_ERROR_MESSAGES, handleAuthError } from './errors';
import { UserProfile, ROLE_MAPPING } from '../../types/auth';
import { loadUserProfile } from './init';
import { FirebaseError } from 'firebase/app';

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

interface SignInResult {
  user: any;
  profile: UserProfile;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const attemptFirestoreOperation = async <T>(
  operation: () => Promise<T>,
  retryCount = 0
): Promise<T> => {
  try {
    return await operation();
  } catch (error: any) {
    if (error.code === 'unavailable' && retryCount < MAX_RETRIES) {
      await delay(RETRY_DELAY * Math.pow(2, retryCount));
      return attemptFirestoreOperation(operation, retryCount + 1);
    }
    throw error;
  }
};
export const authenticateUser = async (email: string, password: string) => {
  try {
    logOperation('signIn', 'start');

    // Wait for auth to be ready
    const auth = getAuth();
    if (!auth) {
      throw new Error('Authentication service not initialized');
    }
    
    // Wait for Firebase initialization
    const auth = getAuth();
    if (!auth) {
      throw new Error('Authentication service not initialized');
    }

    if (!email || !password) {
      throw new Error(AUTH_ERROR_MESSAGES.default);
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    let userCredential;
    try {
      logOperation('signIn', 'authenticating', { email: normalizedEmail });
      
      userCredential = await retryAuthOperation(
        () => signInWithEmailAndPassword(auth, normalizedEmail, password),
        {
          maxAttempts: 3,
          baseDelay: 1000,
          operation: 'signIn'
        }
      );

      logOperation('signIn', 'authenticated', { uid: userCredential.user.uid });
    } catch (error) {
      if (error instanceof FirebaseError) {
        const message = AUTH_ERROR_MESSAGES[error.code as keyof typeof AUTH_ERROR_MESSAGES] || 
                       AUTH_ERROR_MESSAGES.default;
        throw new Error(message);
      }
      throw error;
    }
    
    // Force token refresh to ensure claims are up to date
    logOperation('signIn', 'refreshing-token');
    await retryAuthOperation(
      () => userCredential.user.getIdTokenResult(true)
    );

    // Load user profile
    logOperation('signIn', 'loading-profile');
    const profile = await loadUserProfile(userCredential.user.uid);
    if (!profile) {
      logOperation('signIn', 'error', 'Failed to load user profile');
      throw new Error(AUTH_ERROR_MESSAGES['auth/user-not-found']);
    }

    // Update last login time
    try {
      const db = getDb();
      const timestamp = new Date().toISOString();
      const userRef = doc(db, 'users', userCredential.user.uid);
      await updateDoc(userRef, {
        lastLoginAt: timestamp,
        role: ROLE_MAPPING[profile.role as keyof typeof ROLE_MAPPING] || profile.role
      });
      
      // Update profile with new timestamp
      profile.lastLoginAt = timestamp;
      
      logOperation('signIn', 'success', { lastLoginAt: timestamp });
    } catch (error) {
      // Non-critical error - log but don't fail sign in
      logOperation('signIn', 'warning', 'Failed to update last login time');
    }

    logOperation('signIn', 'complete', { 
      uid: userCredential.user.uid,
      role: profile.role
    });
    
    // Return auth result with role for navigation
    return {
      user: userCredential.user,
      profile,
      role: profile.role
    };
  } catch (error: any) {
    logOperation('signIn', 'error', error);
    
    if (error instanceof FirebaseError && error.code === 'auth/network-request-failed') {
      throw new Error(handleAuthNetworkError(error));
    }
    
    const message = error instanceof Error ? error.message : 'Unable to sign in at this time';
    throw new Error(message);
  }
};