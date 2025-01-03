import { getDocs, query, where } from 'firebase/firestore';
import { FirebaseError } from 'firebase/app';
import { getCollection } from '../../firebase/collections';
import { logOperation } from '../../firebase/logging';

export interface UserRecordsCheck {
  users: boolean;
  sales: boolean;
}

export const checkUserRecords = async (email: string): Promise<UserRecordsCheck> => {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const usersRef = getCollection('USERS');
    const salesRef = getCollection('SALESPEOPLE');

    // Check both collections in parallel
    const [userDocs, salesDocs] = await Promise.all([
      getDocs(query(usersRef, where('email', '==', normalizedEmail))),
      getDocs(query(salesRef, where('email', '==', normalizedEmail)))
    ]);

    const result = {
      users: !userDocs.empty,
      sales: !salesDocs.empty
    };

    logOperation('checkUserRecords', 'success', result);
    return result;
  } catch (error) {
    // Don't treat permission errors as failures
    if (error instanceof FirebaseError && error.code === 'permission-denied') {
      logOperation('checkUserRecords', 'warning', 'Permission denied checking user records');
      return { users: false, sales: false };
    }

    logOperation('checkUserRecords', 'error', error);
    throw error;
  }
};