import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  User,
  onAuthStateChanged,
  sendPasswordResetEmail, 
  signOut as firebaseSignOut
} from 'firebase/auth';
import { getAuth } from '../services/firebase/db';
import { initializeFirebaseServices } from '../services/firebase/init';
import { LoadingScreen } from '../components/common/LoadingScreen';
import { logOperation } from '../services/firebase/logging';
import { initNetworkMonitoring, getNetworkStatus } from '../services/firebase/network';
import { UserProfile } from '../types/auth';
import { signIn as firebaseSignIn } from '../services/auth';
import { loadUserProfile } from '../services/auth/init';
import { 
  initializeAuthSession,
  clearSessionState
} from '../services/auth/session';
// Import AuthErrorBoundary only once

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [firebaseInitialized, setFirebaseInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initAttempts, setInitAttempts] = useState(0);
  const MAX_INIT_ATTEMPTS = 3;
  
  // Initialize Firebase
  useEffect(() => {
    const init = async () => {
      try {
        setIsInitializing(true);
        if (firebaseInitialized) return;
        if (initAttempts >= MAX_INIT_ATTEMPTS) {
          const { isOnline } = getNetworkStatus();
          setError(
            isOnline
              ? 'Failed to initialize Firebase after multiple attempts' 
              : 'No internet connection. Please check your network and try again.'
          );
          return;
        }
        
        await initializeFirebaseServices();
        setFirebaseInitialized(true);
        logOperation('AuthProvider', 'firebase-initialized');
      } catch (err) {
        const { isOnline } = getNetworkStatus();
        const message = !isOnline
          ? 'No internet connection. Please check your network and try again.'
          : err instanceof Error ? err.message : 'Failed to initialize Firebase';
        setError(message);
        console.error('Firebase initialization error:', err);
        setInitAttempts(prev => prev + 1);
        setTimeout(init, 2000 * (initAttempts + 1)); // Exponential backoff
      } finally {
        if (mounted) {
          setIsInitializing(false);
        }
      }
    };
    
    let mounted = true;
    init();
    return () => {
      mounted = false;
    };
  }, [firebaseInitialized, initAttempts]);

  // Monitor network status
  useEffect(() => {
    const cleanup = initNetworkMonitoring(
      // On online
      () => {
        if (!firebaseInitialized && !isInitializing) { // Now isInitializing is defined
          setInitAttempts(0); // Reset attempts
          setError(null);
          setFirebaseInitialized(false); // Trigger re-initialization
        }
      },
      // On offline
      () => {
        setError('No internet connection. Please check your network and try again.');
      }
    );

    return cleanup;
  }, [firebaseInitialized, isInitializing]);

  // Handle auth state changes
  useEffect(() => {
    if (!firebaseInitialized) return;

    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    const auth = getAuth();
    
    const clearAuthState = () => {
      clearSessionState();
      if (mounted) {
        setUserProfile(null);
        setCurrentUser(null);
      }
    };

    unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          setLoading(true);
          
          // Initialize auth session
          const isValid = await initializeAuthSession(user);
          if (!isValid && mounted) {
            clearAuthState();
            return;
          }

          // Load user profile
          const profile = await loadUserProfile(user.uid);
          if (profile && mounted) {
            setUserProfile(profile);
            sessionStorage.setItem('isAuthenticated', 'true');
            setCurrentUser(user);
          } else {
            logOperation('authStateChange', 'warning', 'No user profile found');
            clearAuthState();
          }
        } else {
          clearAuthState();
        }
      } catch (err) {
        logOperation('authStateChange', 'error', err);
        clearAuthState();
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    });

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [firebaseInitialized]);

  const signIn = async (email: string, password: string) => {
    setError(null);
    try {
      logOperation('AuthProvider.signIn', 'start', { email });
      
      const { user, profile, role } = await firebaseSignIn(email, password);
      
      // Set auth state
      setCurrentUser(user);
      setUserProfile(profile);
      sessionStorage.setItem('isAuthenticated', 'true');
      sessionStorage.setItem('userRole', role);
      
      // Determine redirect based on role
      const redirectPath = role === 'admin' ? '/admin' :
                         role === 'regional' ? '/regional' : 
                         '/dashboard';
      
      logOperation('AuthProvider.signIn', 'success', { 
        role,
        redirect: redirectPath
      });
      
      // Use window.location for hard redirect to ensure clean state
      window.location.href = redirectPath;

    } catch (error) {
      logOperation('signIn', 'error', error);
      const message = error instanceof Error ? error.message : 'Authentication failed';
      setError(message);
      throw new Error(message);
    }
  };

  const resetPassword = async (email: string) => {
    setError(null);
    try {
      const auth = getAuth();
      await sendPasswordResetEmail(auth, email);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reset password';
      setError(message);
      throw new Error(message);
    }
  };

  const signOut = async () => {
    setError(null);
    try {
      clearSessionState();
      setUserProfile(null);
      setCurrentUser(null);
      const auth = getAuth();
      await firebaseSignOut(auth);
      window.location.href = '/login';
    } catch (error) {
      logOperation('signOut', 'error', error);
      const message = error instanceof Error ? error.message : 'Failed to sign out';
      setError(message);
      throw new Error(message);
    }
  };

  const value = {
    currentUser,
    userProfile,
    signIn,
    resetPassword,
    signOut,
    loading,
    error
  };

  if (!firebaseInitialized || loading) {
    return <LoadingScreen 
      error={error}
      retryCount={initAttempts}
      maxRetries={MAX_INIT_ATTEMPTS}
      isOffline={!getNetworkStatus().isOnline}
    />;
  }

  // Wrap the provider in the error boundary
  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};