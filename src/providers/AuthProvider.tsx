import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  User,
  onAuthStateChanged, 
  sendPasswordResetEmail, 
  signOut as firebaseSignOut
} from 'firebase/auth';
import { AuthContext, type AuthContextType } from '../contexts/AuthContext';
import { getAuth } from '../services/firebase/db';
import { initializeFirebaseServices } from '../services/firebase/init';
import { getNetworkStatus, initNetworkMonitoring, waitForNetwork } from '../services/firebase/network';
import { handleAuthError } from '../services/auth/errors';
import { LoadingScreen } from '../components/common/LoadingScreen';
import { logOperation } from '../services/firebase/logging';
import { UserProfile } from '../types/auth';
import { 
  authenticateUser, 
  loadUserProfile, 
  initializeAuthSession, 
  clearSessionState
} from '../services/auth';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [initAttempts, setInitAttempts] = useState<number>(0);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [networkStatus, setNetworkStatus] = useState(getNetworkStatus());
  const MAX_INIT_ATTEMPTS = 3;
  const INIT_TIMEOUT = 30000; // 30 seconds
  const INIT_RETRY_DELAY = 2000;
  
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const initialize = async () => {
      if (isInitialized || isInitializing) return;

      // Wait for network if offline
      if (!navigator.onLine) {
        const hasNetwork = await waitForNetwork(INIT_TIMEOUT);
        if (!hasNetwork && mounted) {
          setError('No network connection available');
          return;
        }
      }

      try {
        setIsInitializing(true);
        setLoading(true);
        setError(null);
        setNetworkError(null);
        
        await initializeFirebaseServices();
        
        // Double check mounted state
        
        if (!mounted) return;
        
        setIsInitialized(true);
        setInitAttempts(0);
        
        const auth = getAuth();
        unsubscribe = onAuthStateChanged(auth, handleAuthStateChange);
      } catch (error) {
        // Only update state if still mounted
        if (!mounted) return;
        setIsInitializing(false);
        
        setInitAttempts(prev => prev + 1);
        setError('Failed to initialize authentication. Please try again.');
        logOperation('AuthProvider.init', 'error', error);

        // Schedule retry if under max attempts
        if (initAttempts < MAX_INIT_ATTEMPTS - 1) {
          setTimeout(initialize, INIT_RETRY_DELAY * (initAttempts + 1));
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
      if (networkCleanup) networkCleanup();
    };
  }, [initAttempts, isInitialized]);

  // Monitor network status
  useEffect(() => {
    const cleanup = initNetworkMonitoring({
      onOnline() {
        setError(null);
        setNetworkError(null);
        setNetworkStatus(getNetworkStatus());
      },
      onOffline() {
        setNetworkError('No internet connection. Please check your network and try again.');
        setNetworkStatus(getNetworkStatus());
      }
    });

    return cleanup;
  }, []);

  // Handle auth state changes
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const clearAuthState = () => {
      clearSessionState();
      if (mounted) {
        setUserProfile(null);
        setCurrentUser(null);
      }
    };
    
    // Only handle auth state changes after both Firebase and Auth are initialized
    if (!isInitialized) {
      return;
    }
    
    const auth = getAuth();

    unsubscribe = onAuthStateChanged(auth, async (user) => {
      logOperation('AuthProvider.onAuthStateChanged', user ? 'user-present' : 'no-user');
      
      try {
        if (!user) {
          clearAuthState();
          return;
        }

        // Load user profile
        const profile = await loadUserProfile(user.uid);
        if (!profile) {
          clearAuthState();
          return;
        }

        // Set auth state
        setCurrentUser(user);
    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [isInitialized]);

  const signIn = async (email: string, password: string) => {
    setError(null);
    setLoading(true);

    // Validate initialization
    if (!isInitialized) {
      setError('Authentication service not initialized');
      setLoading(false);
      return;
    }
    
    try {
      if (!isInitialized) {
        throw new Error('Authentication service not initialized');
      }
      
      const { user, profile, role } = await authenticateUser(email, password);

      // Set auth state
      // Update auth state
      setCurrentUser(user);
      setUserProfile(profile);
      sessionStorage.setItem('isAuthenticated', 'true');
      sessionStorage.setItem('userRole', role);
      
      // Navigate after state is updated
      logOperation('AuthProvider.signIn', 'success', { 
        role,
        userId: user.uid
      });

      // Determine and navigate to correct path
      const redirectPath = role === 'admin' ? '/admin' :
                         role === 'regional' ? '/regional' : 
                         '/dashboard';
      navigate(redirectPath, { replace: true });
      
    } catch (error) {
      const authError = handleAuthError(error);
      logOperation('AuthProvider.signIn', 'error', error);
      logOperation('AuthProvider.signIn', 'error', authError);
      setError(authError.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (email: string) => {
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

  const handleSignOut = async () => {
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

  if (loading || !isInitialized) {
    return <LoadingScreen 
      error={error}
      networkError={networkError}
      retryCount={initAttempts}
      maxRetries={MAX_INIT_ATTEMPTS}
      isOffline={!getNetworkStatus().isOnline}
    />;
  }

  const value = {
    currentUser,
    userProfile,
    signIn,
    resetPassword: handleResetPassword,
    signOut: handleSignOut,
    loading,
    error,
    isInitialized,
    networkStatus
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};