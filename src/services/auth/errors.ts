import { logOperation } from '../firebase/logging';
import { FirebaseError } from 'firebase/app';

export type AuthErrorCode = keyof typeof AUTH_ERROR_MESSAGES;

export const AUTH_ERROR_MESSAGES = {
  'auth/invalid-credential': 'Invalid email or password',
  'auth/invalid-login-credentials': 'Invalid email or password',
  'auth/user-not-found': 'No account exists with this email address',
  'auth/wrong-password': 'Incorrect password',
  'auth/user-disabled': 'This account has been disabled',
  'auth/too-many-requests': 'Too many failed attempts. Please try again later',
  'auth/network-request-failed': 'Network error. Please check your connection',
  'auth/requires-recent-login': 'Please sign in again to continue',
  'auth/invalid-email': 'Invalid email format',
  'auth/missing-credentials': 'Email and password are required',
  'auth/email-already-in-use': 'An account already exists with this email address',
  'auth/weak-password': 'Password should be at least 6 characters',
  'default': 'An error occurred during authentication'
} as const;

interface AuthError {
  code: string;
  message: string;
  originalError?: unknown;
}

export const handleAuthError = (error: unknown): AuthError => {
  if (error instanceof FirebaseError) {
    const message = AUTH_ERROR_MESSAGES[error.code as AuthErrorCode] || 
                   AUTH_ERROR_MESSAGES.default;
    
    logOperation('handleAuthError', 'firebase-error', { code: error.code, message });
    return { 
      code: error.code, 
      message,
      originalError: error
    };
  }

  if (!navigator.onLine) {
    return {
      code: 'network-error',
      message: AUTH_ERROR_MESSAGES['auth/network-request-failed'],
      originalError: error
    };
  }

  const message = error instanceof Error ? error.message : AUTH_ERROR_MESSAGES.default;
  logOperation('handleAuthError', 'unknown-error', { message });
  
  return {
    code: 'unknown',
    message,
    originalError: error
  };
};