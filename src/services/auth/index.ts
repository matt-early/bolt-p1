// Core auth functionality
export { authenticateUser } from './signIn';
export { handleAuthError } from './errors';
export { loadUserProfile } from './init';

// Session management
export {
  initializeAuthSession,
  validateSession,
  refreshSession,
  setupSessionRefresh,
  validateNetworkState,
  setupAuthCleanup,
  registerCleanup,
  clearSessionState,
  setSessionState
} from './session';

// Types
export type { AuthError } from './errors';
export type { UserRole, UserProfile, AuthRequest } from '../../types/auth';