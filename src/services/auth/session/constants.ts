// Session timeout settings
export const SESSION_TIMEOUT = 55 * 60 * 1000; // 55 minutes
export const REFRESH_THRESHOLD = 5 * 60 * 1000; // 5 minutes
export const GRACE_PERIOD = 5 * 60 * 1000; // 5 minute grace period

// Network settings
export const NETWORK_TIMEOUT = 30000; // 30 seconds

// Retry settings
export const TOKEN_REFRESH_ATTEMPTS = 3;
export const TOKEN_REFRESH_DELAY = 1000;

// Auth error messages
export const AUTH_ERROR_MESSAGES = {
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  REFRESH_FAILED: 'Failed to refresh session. Please sign in again.',
  INVALID_SESSION: 'Invalid session. Please sign in again.',
  OFFLINE_NO_CACHE: 'No cached session available while offline.'
} as const;