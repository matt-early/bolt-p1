import { 
  doc,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { 
  fetchSignInMethodsForEmail,
  createUserWithEmailAndPassword,
  getAuth as getFirebaseAuth
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { getAuth, getDb } from '../firebase/db';
import { UserProfile } from '../../types/auth';
import { logOperation } from '../firebase/logging';
import { retry } from '../firebase/retry';
import { verifyAdminPermissions } from './admin/permissions';
import { getCollection } from '../firebase/collections';

interface ApprovalResult {
  success: boolean;
  userId?: string;
  error?: string;
  existingUser?: {
    auth: boolean;
    users: boolean;
    sales: boolean;
  };
}

interface UserExistenceCheck {
  exists: boolean;
  details: {
    auth: boolean;
    users: boolean;
    sales: boolean;
  };
}

const checkExistingUser = async (email: string) => {
  try {
    const auth = getFirebaseAuth();
    const normalizedEmail = email.toLowerCase().trim();

    // Check Firebase Auth
    const methods = await fetchSignInMethodsForEmail(auth, normalizedEmail);
    const existsInAuth = methods.length > 0;

    // Check Firestore collections in parallel
    const usersRef = getCollection('USERS');
    const salesRef = getCollection('SALESPEOPLE');

    const [userDocs, salesDocs] = await Promise.all([
      getDocs(query(usersRef,
        where('email', '==', normalizedEmail))),
      getDocs(query(salesRef,
        where('email', '==', normalizedEmail)))
    ]);

    const existsInUsers = !userDocs.empty;
    const existsInSales = !salesDocs.empty;

    logOperation('checkExistingUser', 'check', {
      email: normalizedEmail,
      existsInAuth,
      existsInUsers,
      existsInSales
    });

    const result: UserExistenceCheck = {
      exists: existsInAuth || existsInUsers || existsInSales,
      details: {
        auth: existsInAuth,
        users: existsInUsers,
        sales: existsInSales
      }
    };

    return result;
  } catch (error) {
    logOperation('checkExistingUser', 'error', error);
    throw error;
  }
};

const getExistingUserError = (checkResult: UserExistenceCheck): string | null => {
  if (!checkResult.exists) return null;

  if (checkResult.details.users || checkResult.details.sales) {
    return 'This email is already registered in our system. Please use a different email address.';
  }

  if (checkResult.details.auth) {
    return 'This email is already registered with another account. Please use a different email address.';
  }

  return 'This email address is not available. Please use a different one.';
};

export const approveAuthRequest = async (
  requestId: string,
  reviewerId: string,
  userData: Omit<UserProfile, 'id' | 'approved' | 'createdAt'> & { forceContinue?: boolean }
): Promise<ApprovalResult> => {
  try {
    const auth = getFirebaseAuth();
    const db = getDb();
    const normalizedEmail = userData.email?.toLowerCase().trim();

    if (!normalizedEmail) {
      return {
        success: false,
        error: 'Email address is required'
      };
    }

    if (!auth.currentUser) {
      throw new Error('Not authenticated');
    }

    // Verify admin permissions
    const hasPermission = await retry(
      () => verifyAdminPermissions(),
      { operation: 'approveAuthRequest.verifyPermissions' }
    );

    if (!hasPermission) {
      throw new Error('You do not have permission to approve requests');
    }

    // Check if email already exists
    if (!userData.forceContinue) {
      const existingUser = await checkExistingUser(normalizedEmail);
      
      // Return existing user details to let UI handle the flow
      if (existingUser.exists) {
        return {
          success: false,
          existingUser: existingUser.details,
          error: getExistingUserError(existingUser)
        };
      }
    }

    // Get the auth request
    const requestRef = doc(db, 'authRequests', requestId);
    const requestDoc = await getDoc(requestRef);
    if (!requestDoc.exists()) {
      throw new Error('Authentication request not found');
    }
    const requestData = requestDoc.data();

    // Double check the email hasn't been taken while processing
    const finalCheck = await checkExistingUser(normalizedEmail);
    if (finalCheck.exists) {
      return {
        success: false,
        existingUser: finalCheck.details,
        error: getExistingUserError(finalCheck) || 'Email is no longer available'
      };
    }

    let userId: string;

    try {
      // Try to create new user first
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        requestData.password
      );
      userId = userCredential.user.uid;
      logOperation('approveAuthRequest', 'new-user-created', { userId });
    } catch (error) {
      logOperation('approveAuthRequest', 'error', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create user'
      };
    }

    // Start batch write
    const batch = writeBatch(db);

    // Create user profile
    const userRef = doc(db, 'users', userId);
    batch.set(userRef, {
      email: normalizedEmail,
      name: userData.name.trim(),
      role: userData.role,
      staffCode: userData.staffCode?.trim(),
      storeIds: userData.storeIds,
      primaryStoreId: userData.primaryStoreId,
      approved: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    });

    // Create salesperson profile for team members
    if (userData.role === 'team_member') {
      const salespersonRef = doc(db, 'salespeople', userId);
      batch.set(salespersonRef, {
        email: normalizedEmail,
        name: userData.name.trim(),
        role: userData.role,
        staffCode: userData.staffCode?.trim(),
        storeIds: userData.storeIds,
        primaryStoreId: userData.primaryStoreId,
        approved: true,
        createdAt: serverTimestamp()
      });
    }

    // Update request status
    batch.update(requestRef, {
      status: 'approved',
      reviewedBy: auth.currentUser.uid,
      reviewedAt: serverTimestamp()
    });

    // Commit all changes
    await batch.commit();
    logOperation('approveAuthRequest', 'success', { userId });
    
    // Return success with user status
    return { 
      success: true, 
      userId
    };

  } catch (error) {
    logOperation('approveAuthRequest', 'error', error);

    if (error instanceof FirebaseError) {
      switch (error.code) {
        case 'auth/email-already-in-use':
          logOperation('approveAuthRequest', 'error', {
            code: error.code,
            email: normalizedEmail
          });
          return {
            success: false, 
            error: 'This email is already registered with another account. Please use a different email address.'
          };
        case 'auth/invalid-email':
          return {
            success: false,
            error: 'Invalid email address format'
          };
        case 'permission-denied':
          return {
            success: false,
            error: 'You do not have permission to approve requests'
          };
        default:
          return {
            success: false,
            error: `Failed to approve request: ${error.message}`
          };
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve request'
    };
  }
};