import { createContext } from 'react';
import type { User } from 'firebase/auth';
import type { UserProfile } from '../types/auth';

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

export const AuthContext = createContext<AuthContextType | null>(null);