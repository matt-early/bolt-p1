import { 
  doc,
  collection,
  getDoc,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { 
  fetchSignInMethodsForEmail,
  createUserWithEmailAndPassword
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { getAuth, getDb } from '../firebase/db';
import { UserProfile } from '../../types/auth';
import { logOperation } from '../firebase/logging';
import { getCollection } from '../firebase/collections';
import { checkUserRecords } from './checks';
import { verifyAdminPermissions } from './admin/permissions';

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
    authUid?: string;
    users: boolean;
    sales: boolean;
  };
}

const checkAuthAccount = async (email: string): Promise<{ exists: boolean; uid?: string }> => {
  try {
    const auth = getAuth();
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if email exists in auth system
    const methods = await fetchSignInMethodsForEmail(auth, normalizedEmail);
    if (methods.length > 0) {
      logOperation('checkAuthAccount', 'exists');
      return { exists: true };
    }

    return { exists: false };
  } catch (error) {
    logOperation('checkAuthAccount', 'error', error);
    return { exists: false };
  }
};

const checkExistingUser = async (email: string) => {
  try {
    const normalizedEmail = email.toLowerCase().trim();

    // Check Firebase Auth and user records in parallel
    const [authResult, records] = await Promise.all([
      checkAuthAccount(normalizedEmail),
      checkUserRecords(normalizedEmail)
    ]);

    logOperation('checkExistingUser', 'check', {
      email: normalizedEmail,
      hasAuthAccount: authResult.exists,
      authUid: authResult.uid,
      hasUserRecord: records.users,
      hasSalesRecord: records.sales
    });

    const result: UserExistenceCheck = {
      exists: authResult.exists || records.users || records.sales,
      details: {
        auth: authResult.exists,
        authUid: authResult.uid,
        users: records.users,
        sales: records.sales
      }
    };

    return result;
  } catch (error) {
    logOperation('checkExistingUser', 'error', error);
    return {
      exists: false,
      details: { 
        auth: false,
        authUid: undefined,
        users: false,
        sales: false
      }
    };
  }
};

const getExistingUserError = (checkResult: UserExistenceCheck): string | null => {
  if (!checkResult.exists) return null;
  if (checkResult.details.users && checkResult.details.sales) {
    return 'This account already exists. Please check User Management for account status.';
  }

  // Has auth but no records - can proceed with record creation
  if (checkResult.details.auth && !checkResult.details.users && !checkResult.details.sales) {
    return 'Authentication account exists. Click Continue to create required profiles.';
  }

  // Has partial records - system inconsistency
  if (checkResult.details.users || checkResult.details.sales) {
    return 'Incomplete account records found. Please check User Management or contact administrator.';
  }

  return 'This email is already registered. Please use a different email address.';
};

const createUserAccount = async (email: string, password: string, existingUid?: string) => {
  try {
    const auth = getAuth();
    const normalizedEmail = email.toLowerCase().trim();
    
    // If we have an existing UID, return that user
    if (existingUid) {
      logOperation('createUserAccount', 'using-existing-uid', { uid: existingUid });
      return { user: { uid: existingUid } };
    }
    
    // Create new user if no existing auth account
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
      logOperation('createUserAccount', 'created-new-user', { uid: userCredential.user.uid });
      return { user: userCredential.user };
    } catch (error) {
      if (error instanceof FirebaseError && error.code === 'auth/email-already-in-use') {
        // Double check if we can proceed with record creation
        const records = await checkUserRecords(normalizedEmail);
        if (records.uid) {
          logOperation('createUserAccount', 'using-existing-records', { uid: records.uid });
          return { user: { uid: records.uid } };
        } else {
          throw new Error('Authentication account exists but unable to retrieve UID');
        }
      }
      throw error;
    }
  } catch (error) {
    logOperation('createUserAccount', 'error', error);
    throw error;
  }
};

export const approveAuthRequest = async (
  requestId: string,
  reviewerId: string,
  userData: Omit<UserProfile, 'id' | 'approved' | 'createdAt'> & { forceContinue?: boolean }
): Promise<ApprovalResult> => {
  const normalizedEmail = userData.email?.toLowerCase().trim();

  try {
    // Verify admin permissions first
    const hasPermission = await verifyAdminPermissions();
    if (!hasPermission) {
      throw new Error('You do not have permission to approve requests');
    }

    const auth = getAuth();
    const db = getDb();

    if (!normalizedEmail) {
      throw new Error('Email address is required');
    }

    if (!auth.currentUser) {
      throw new Error('Not authenticated');
    }

    // Check if email already exists
    if (!userData.forceContinue) {
      const existingUser = await checkExistingUser(normalizedEmail);
      const errorMessage = getExistingUserError(existingUser);

      // Only block if there are existing records
      if (errorMessage) {
        return {
          success: false,
          existingUser: existingUser.details,
          error: errorMessage
        };
      }
    }

    // Get the auth request
    const requestRef = doc(db, 'authRequests', requestId);
    const requestDoc = await getDoc(requestRef);
    if (!requestDoc.exists()) {
      throw new Error('Authentication request not found');
    }
    
    // Check if request is already processed
    const requestStatus = requestDoc.data().status;
    if (requestStatus === 'approved' || requestStatus === 'rejected') {
      throw new Error('This request has already been processed');
    }

    // Double check the email hasn't been taken while processing
    const finalCheck = await checkExistingUser(normalizedEmail);
    if (finalCheck.exists) {
      const errorMessage = getExistingUserError(finalCheck);
      if (errorMessage && !userData.forceContinue) {
        return {
          success: false,
          existingUser: finalCheck.details,
          error: errorMessage
        };
      }
    }

    let userId: string;

    try {
      logOperation('approveAuthRequest', 'creating-user');
      const { user } = await createUserAccount(
        normalizedEmail,
        requestDoc.data().password,
        finalCheck.details.authUid
      );
      userId = user.uid;
      if (!userId) {
        throw new Error('Failed to get valid user ID');
      }
      logOperation('approveAuthRequest', 'new-user-created', { userId });
    } catch (error) {
      logOperation('approveAuthRequest', 'error', error);
      
      if (error instanceof FirebaseError) {
        if (error.code === 'auth/email-already-in-use') {
          // Check if we can proceed with record creation
          const records = await checkUserRecords(normalizedEmail);
          if (!records.users && !records.sales) {
            return {
              success: false,
              existingUser: {
                auth: true,
                users: false,
                sales: false
              },
              error: 'This email already has an authentication account. Click Continue to create the necessary profiles.'
            };
          }
        }
        return {
          success: false,
          error: error.message || 'Failed to create user account'
        };
      }
      throw error;
    }

    // Start batch write
    const batch = writeBatch(db);

    logOperation('approveAuthRequest', 'creating-profiles');

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
      reviewedBy: reviewerId,
      reviewedAt: serverTimestamp()
    });

    // Commit all changes
    logOperation('approveAuthRequest', 'committing-changes');
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
            error: error.message || 'Failed to approve request'
          };
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to approve request'
    };
  }
};