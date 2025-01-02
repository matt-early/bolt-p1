import React, { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../providers/AuthProvider';
import { AUTH_SETTINGS } from '../../config/auth-settings';
import { LoadingScreen } from '../common/LoadingScreen';

interface PrivateRouteProps {
  children: React.ReactNode;
}

export const PrivateRoute: React.FC<PrivateRouteProps> = ({ 
  children
}) => {
  const { currentUser, userProfile, loading } = useAuth();
  const location = useLocation();

  // Clear any stale auth state
  useEffect(() => {
    if (!currentUser && !loading) {
      sessionStorage.clear();
      localStorage.clear();
    }
  }, [currentUser, loading]);

  if (loading) {
    return <LoadingScreen />;
  }

  // Check if user is authenticated
  if (!currentUser || !userProfile) {
    sessionStorage.clear();
    localStorage.clear();
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check route permissions based on user role
  const path = location.pathname;
  const userRole = userProfile.role;

  // Admin has access to everything
  if (userRole === AUTH_SETTINGS.ROLES.ADMIN) {
    return <>{children}</>;
  }

  // Regional manager access
  if (userRole === AUTH_SETTINGS.ROLES.REGIONAL) {
    const allowedPaths = ['/regional', '/salespeople', '/stores', '/regions', '/metrics'];
    if (!allowedPaths.some(p => path.startsWith(p))) {
      return <Navigate to="/unauthorized" replace />;
    }
    return <>{children}</>;
  }

  // Team member access
  if (userRole === AUTH_SETTINGS.ROLES.TEAM_MEMBER) {
    const allowedPaths = ['/dashboard'];
    if (!allowedPaths.some(p => path.startsWith(p))) {
      return <Navigate to="/unauthorized" replace />;
    }
    return <>{children}</>;
  }

  // Default - no access
  if (path !== '/unauthorized') {
    return <Navigate to="/unauthorized" replace />;
  }

  return <>{children}</>;
};