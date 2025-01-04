import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  User,
  onAuthStateChanged,
  sendPasswordResetEmail, 
  signOut as firebaseSignOut
} from 'firebase/auth';
import { createContext, useContext } from 'react';
import { getAuth } from '../services/firebase/db';
import { initializeFirebaseServices } from '../services/firebase/init';
import { LoadingScreen } from '../components/common/LoadingScreen';
import { logOperation } from '../services/firebase/logging';
import { initNetworkMonitoring, getNetworkStatus } from '../services/firebase/network';
import { UserProfile } from '../types/auth';
import { 
  authenticateUser, 
  loadUserProfile, 
  initializeAuthSession, 
  clearSessionState,
  handleAuthError 
} from '../services/auth';

interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  error: string | null;
  isInitialized: boolean;
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
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [initAttempts, setInitAttempts] = useState<number>(0);
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const MAX_INIT_ATTEMPTS = 3;

  // Initialize Firebase and auth state
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const initialize = async () => {
      if (isInitialized) return;
      
      try {
        setLoading(true);
        setError(null);
        
        await initializeFirebaseServices();
        
        if (!mounted) return;
        
        setIsInitialized(true);
        setInitAttempts(0);

        // Set up auth state listener after initialization
        const auth = getAuth();
        unsubscribe = onAuthStateChanged(auth, handleAuthStateChange);
      } catch (error) {
        if (!mounted) return;
        
        setInitAttempts(prev => prev + 1);
        setError('Failed to initialize authentication. Please try again.');
        logOperation('AuthProvider.init', 'error', error);
        
        if (initAttempts < MAX_INIT_ATTEMPTS - 1) {
          setTimeout(initialize, 2000 * (initAttempts + 1));
        }
      } finally {
        if (mounted) {
          setIsInitializing(false);
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [initAttempts, isInitialized, isInitializing]);

  // Handle auth state changes
  const handleAuthStateChange = async (user: User | null) => {
    try {
      if (user) {
        setLoading(true);
        
        // Initialize auth session
        const isValid = await initializeAuthSession(user);
        if (!isValid) {
          clearAuthState();
          return;
        }

        // Load user profile
        const profile = await loadUserProfile(user.uid);
        if (profile) {
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
      setLoading(false);
    }
  };

  const clearAuthState = () => {
    clearSessionState();
    setUserProfile(null);
    setCurrentUser(null);
  };
  // Initialize Firebase on mount
  const signIn = async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    
    try {
      logOperation('AuthProvider.signIn', 'start', { email });
      
      if (!isInitialized) {
        throw new Error('Authentication service not initialized');
      }

      const { user, profile, role } = await authenticateUser(email, password);
      
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
      
      // Use navigate instead of window.location
      navigate(redirectPath, { replace: true });
    } catch (error) {
      logOperation('signIn', 'error', error);
      const { message } = handleAuthError(error);
      setError(message);
      throw new Error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (isInitialized || isInitializing) return;
      
      try {
        setIsInitializing(true);
        setLoading(true);
        setError(null);
        setNetworkError(null);
        
        if (initAttempts >= MAX_INIT_ATTEMPTS) {
          throw new Error('Failed to initialize after multiple attempts');
        }

        await initializeFirebaseServices();
        if (mounted) {
          setIsInitialized(true);
          setInitAttempts(0);
        }
      } catch (error) {
        if (mounted) {
          setInitAttempts(prev => prev + 1);
          setError('Failed to initialize Firebase. Please try again.');
          logOperation('AuthProvider.init', 'error', error);
          
          // Retry after delay if not max attempts
          if (initAttempts < MAX_INIT_ATTEMPTS - 1) {
            setTimeout(init, 2000 * (initAttempts + 1));
          }
        }
      } finally {
        if (mounted) {
          setIsInitializing(false);
          setLoading(false);
        }
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [initAttempts, isInitialized, isInitializing]);

  // Monitor network status
  useEffect(() => {
    const cleanup = initNetworkMonitoring(
      // On online
      () => {
        setError(null);
        setNetworkError(null);
      },
      // On offline
      () => {
        setNetworkError('No internet connection. Please check your network and try again.');
      }
    );

    return cleanup;
  }, []);

  // Handle auth state changes
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    
    if (!isInitialized) {
      return;
    }
    
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
  }, [isInitialized]);

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
    isInitialized
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};