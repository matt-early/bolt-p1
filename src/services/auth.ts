import { 
  collection,
  doc,
  where,
  getDocs,
  setDoc,
  addDoc,
  Timestamp,
  serverTimestamp,
  writeBatch,
  getDoc
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { getAuth, getDb } from './firebase/db';
import { UserProfile, AuthRequest, UserRole, ROLE_MAPPING } from '../types/auth';
import { logOperation } from './firebase/logging';
import { fetchPendingRequests, updateRequestStatus } from './auth/requests';

// Re-export auth functions
export * from './auth/signIn';
export * from './auth/passwordReset';
import { verifyAdminPermissions } from './auth/admin/permissions';

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

export const approveAuthRequest = async (
  requestId: string,
  reviewerId: string,
  userData: Omit<UserProfile, 'id' | 'approved' | 'createdAt'>
): Promise<void> => {
  try {
    const auth = await getAuth();
    const db = await getDb();
    if (!db) {
      throw new Error('Database not initialized');
    }

    const currentUser = auth.currentUser;
    let hasPermission = false;
    
    if (!currentUser) {
      logOperation('approveAuthRequest', 'error', { message: 'Not authenticated' });
      throw new Error('You must be logged in to perform this action');
    }

    try {
      // Force token refresh first
      await currentUser.getIdToken(true);
      const tokenResult = await retryAuthOperation(
        () => currentUser.getIdTokenResult(true),
        { operation: 'approveAuthRequest.getIdToken' }
      );
      
      hasPermission = tokenResult.claims?.admin === true;
      
      if (!hasPermission) {
        hasPermission = await retryAuthOperation(
          () => verifyAdminPermissions(),
          { operation: 'approveAuthRequest.verifyPermissions' }
        );
      }
    } catch (error) {
      logOperation('approveAuthRequest', 'error', {
        message: 'Failed to verify permissions',
        error
      });
      hasPermission = false;
    }
    // Verify admin permissions first
    if (!hasPermission) {
      logOperation('approveAuthRequest', 'error', { 
        message: 'Admin permissions required',
        userId: currentUser.uid 
      });
      throw new Error('You do not have permission to approve requests');
    }

    const generateSecurePassword = () => {
      const length = 12;
      const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
      let password = '';
      
      // Ensure at least one of each required character type
      password += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(Math.random() * 26)];
      password += 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)];
      password += '0123456789'[Math.floor(Math.random() * 10)];
      password += '!@#$%^&*'[Math.floor(Math.random() * 8)];
      
      // Fill remaining length with random characters
      while (password.length < length) {
        password += charset[Math.floor(Math.random() * charset.length)];
      }
      
      // Shuffle the password
      return password.split('').sort(() => Math.random() - 0.5).join('');
    };

    const normalizedEmail = userData.email.toLowerCase().trim();
    logOperation('approveAuthRequest', 'start', { requestId, email: normalizedEmail });

    // Get the original auth request
    const requestRef = doc(db, 'authRequests', requestId);
    const requestDoc = await getDoc(requestRef);
    if (!requestDoc.exists()) {
      logOperation('approveAuthRequest', 'error', { 
        message: 'Auth request not found',
        requestId 
      });
      throw new Error('Authentication request not found');
    }
    const requestData = requestDoc.data();
    
    // Use provided password from registration
    if (!requestData.password) {
      logOperation('approveAuthRequest', 'error', { 
        message: 'Password missing from request',
        requestId 
      });
      throw new Error('Password is required for registration');
    }
    const password = requestData.password;

    // Check for existing user
    try {
      const methods = await fetchSignInMethodsForEmail(auth, normalizedEmail);
      if (methods.length > 0) {
        logOperation('approveAuthRequest', 'error', { 
          message: 'Email already exists',
          email: normalizedEmail 
        });
        throw new Error('An account already exists with this email address');
      }
    } catch (error: any) {
      if (error?.code === 'auth/invalid-email') {
        logOperation('approveAuthRequest', 'error', { 
          message: 'Invalid email format',
          email: normalizedEmail 
        });
        throw new Error('Invalid email address format');
      }
      throw error;
    }

    let userId: string;
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      userId = userCredential.user.uid;
      
      logOperation('approveAuthRequest', 'user-created', { userId });
    } catch (error) {
      if (error instanceof FirebaseError && error.code === 'auth/email-already-in-use') {
        throw new Error('An account already exists with this email address');
      }
      throw error;
    }

    // Create base profile data
    const profileData = {
      ...userData,
      email: normalizedEmail,
      role: ROLE_MAPPING[userData.role] || userData.role,
      approved: true, 
      createdAt: new Date().toISOString()
    };

    // Create user profile
    const userRef = doc(db, 'users', userId);
    await setDoc(userRef, profileData);
    logOperation('approveAuthRequest', 'profile-created', { userId });

    // Create salesperson profile if role is team_member
    if (userData.role === 'team_member') {
      const salespersonRef = doc(db, 'salespeople', userId);
      await setDoc(salespersonRef, {
        ...profileData,
        createdAt: serverTimestamp()
      });
      logOperation('approveAuthRequest', 'team-member-created', { userId });
    }

    // Then update request status
    await updateRequestStatus(requestId, 'approved', reviewerId);
    
    logOperation('approveAuthRequest', 'success', { userId });
  } catch (error) {
    logOperation('approveAuthRequest', 'error', error);
    throw error;
  }
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