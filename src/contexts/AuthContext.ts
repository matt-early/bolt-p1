import { createContext } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile } from '../types/auth';
import type { NetworkStatus } from '../services/firebase/network';

// Define the context type
export interface AuthContextType {
  currentUser: User | null;
  userProfile: UserProfile | null;
  signIn: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  loading: boolean;
  error: string | null;
  isInitialized: boolean;
  networkStatus: NetworkStatus;
}

// Create and export the context
export const AuthContext = createContext<AuthContextType | undefined>(undefined);