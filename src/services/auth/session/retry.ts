import { logOperation } from '../../firebase/logging';
import { waitForNetwork } from '../../firebase/network';
import { AUTH_ERROR_MESSAGES } from './constants';

interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  timeout?: number;
  operation: string;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'operation'>> = {
  maxAttempts: 3,
  baseDelay: 1000,
  timeout: 15000
};

export const retryAuthOperation = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions
): Promise<T> => {
  const { maxAttempts, baseDelay, timeout } = { ...DEFAULT_OPTIONS, ...options };
  let attempt = 1;

  while (attempt <= maxAttempts) {
    try {
      // Wait for network if offline
      if (!navigator.onLine) {
        logOperation(options.operation, 'waiting-for-network');
        const hasNetwork = await waitForNetwork(timeout / 2);
        if (!hasNetwork) {
          throw new Error(AUTH_ERROR_MESSAGES.NETWORK_ERROR);
        }
      }

      // Execute operation with timeout
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Operation timed out')), timeout)
        )
      ]);
    } catch (error) {
      logOperation(options.operation, 'retry-error', {
        attempt,
        maxAttempts,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }

  throw new Error('Max retry attempts exceeded');
};