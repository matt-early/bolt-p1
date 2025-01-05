import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { getAuth, getDb } from '../firebase/db';
import { logOperation } from '../firebase/logging'; 
import { handleAuthError } from './errors';
import { loadUserProfile } from './init';
import { ROLE_MAPPING } from '../../types/auth';
import { initializeAuthSession } from './session';

export const authenticateUser = async (email: string, password: string) => {
  try {
    logOperation('signIn', 'start');
    
    // Validate auth is initialized
    const auth = getAuth();
    if (!auth) {
      throw new Error('Authentication service not initialized');
    }


    const normalizedEmail = email.toLowerCase().trim();
    logOperation('signIn', 'authenticating', { email: normalizedEmail });

    const userCredential = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    logOperation('signIn', 'authenticated', { uid: userCredential.user.uid });

    // Initialize auth session
    const isValid = await initializeAuthSession(userCredential.user);
    if (!isValid) {
      logOperation('signIn', 'error', 'Failed to initialize session');
      throw new Error('Failed to initialize session');
    }

    // Load user profile
    logOperation('signIn', 'loading-profile');
    const profile = await loadUserProfile(userCredential.user.uid);
    if (!profile) {
      logOperation('signIn', 'error', 'Failed to load user profile');
      logOperation('signIn', 'error', 'Failed to load user profile');
      throw new Error('Failed to load user profile');
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

      profile.lastLoginAt = timestamp;
      logOperation('signIn', 'updated-last-login');
    } catch (error) {
      // Non-critical error - log but continue
      logOperation('signIn', 'warning', 'Failed to update last login time');
    }

    logOperation('signIn', 'success', { 
      uid: userCredential.user.uid,
      role: profile.role 
    });
    
    return {
      user: userCredential.user,
      profile,
      role: profile.role,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    const authError = handleAuthError(error);
    logOperation('signIn', 'error', authError);
    throw new Error(authError.message);
  }
};