import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  error?: string | null;
  retryCount?: number;
  maxRetries?: number;
  isOffline?: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  error,
  retryCount = 0,
  maxRetries = 3,
  isOffline = !navigator.onLine
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg text-red-600 text-center p-6 max-w-md">
          <p className="text-lg font-medium mb-2">Error</p>
          {isOffline ? (
            <p className="text-sm mb-4">
              No internet connection. Please check your network and try again.
            </p>
          ) : (
            <p className="text-sm whitespace-pre-wrap">{error}</p>
          )}
          {retryCount > 0 && retryCount < maxRetries && (
            <p className="text-sm text-gray-600 mt-2">
              Retrying... Attempt {retryCount} of {maxRetries}
            </p>
          )}
          {retryCount >= maxRetries && (
            <p className="text-sm text-red-600 mt-2">
              Maximum retry attempts reached. Please refresh the page to try again.
            </p>
          )}
          {!isOffline && (
            <p className="text-xs text-red-500 mt-4">
              Please check your environment configuration and try again.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          <p className="mt-4 text-sm text-gray-600">
            {isOffline 
              ? 'Waiting for network connection...'
              : retryCount > 0 
                ? `Retrying initialization... (${retryCount}/${maxRetries})` 
                : 'Initializing application...'}
          </p>
        </div>
      )}
    </div>
  );
};