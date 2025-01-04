import { 
  collection,
  doc,
  getDoc,
  where,
  getDocs,
  setDoc,
  addDoc,
  Timestamp,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  fetchSignInMethodsForEmail,
  getIdTokenResult,
  signInWithEmailAndPassword
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { getAuth, getDb } from './firebase/db';
import { UserProfile, AuthRequest, UserRole, ROLE_MAPPING } from '../types/auth';
import { logOperation } from './firebase/logging';
import { fetchPendingRequests, updateRequestStatus } from './auth/requests';
import { approveAuthRequest } from './auth/approval';

// Re-export auth functions
export { approveAuthRequest };
export * from './auth/errors';
export * from './auth/init';
export * from './auth/session';

export const authenticateUser = async (email: string, password: string) => {
  try {
    logOperation('signIn', 'start');
    
    const auth = getAuth();
    if (!auth) {
      throw new Error('Authentication service not initialized');
    }

    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    const userCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    
    // Load user profile
    const profile = await loadUserProfile(userCredential.user.uid);
    if (!profile) {
      throw new Error('Failed to load user profile');
    }

    // Update last login time
    try {
      const db = getDb();
      const timestamp = new Date().toISOString();
      const userRef = doc(db, 'users', userCredential.user.uid);
      await setDoc(userRef, {
        lastLoginAt: timestamp,
        role: ROLE_MAPPING[profile.role as keyof typeof ROLE_MAPPING] || profile.role
      }, { merge: true });
      
      // Update profile with new timestamp
      profile.lastLoginAt = timestamp;
      
      logOperation('signIn', 'success', { lastLoginAt: timestamp });
    } catch (error) {
      // Non-critical error - log but don't fail sign in
      logOperation('signIn', 'warning', 'Failed to update last login time');
    }

    return {
      user: userCredential.user,
      profile,
      role: profile.role
    };
  } catch (error) {
    const authError = handleAuthError(error);
    logOperation('signIn', 'error', authError);
    throw new Error(authError.message);
  }
};

export const createAuthRequest = async (params: {
  email: string;
  name: string;
  staffCode: string;
  storeIds: string[];
  primaryStoreId: string;
  role: UserRole;
  status: 'pending';
  requestedAt: string;
}): Promise<void> => {
  try {
    const db = getDb();
    const requestsRef = collection(db, 'authRequests');
    await addDoc(requestsRef, {
      ...params,
      requestedAt: Timestamp.now()
    });
    logOperation('createAuthRequest', 'success');
  } catch (error) {
    logOperation('createAuthRequest', 'error', error);
    throw error;
  }
};

export const fetchPendingAuthRequests = async (): Promise<AuthRequest[]> => {
  return fetchPendingRequests();
};

export const rejectAuthRequest = async (
  requestId: string,
  reviewerId: string,
  reason: string
): Promise<void> => {
  try {
    await updateRequestStatus(requestId, 'rejected', reviewerId, reason);
    logOperation('rejectAuthRequest', 'success');
  } catch (error) {
    logOperation('rejectAuthRequest', 'error', error);
    throw error;
  }
};