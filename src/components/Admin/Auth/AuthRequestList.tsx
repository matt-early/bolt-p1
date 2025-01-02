import React, { useState, useEffect } from 'react';
import { UserCheck, UserX, AlertCircle } from 'lucide-react';
import { AuthRequest } from '../../../types/auth';
import { Store } from '../../../types';
import { 
  fetchPendingAuthRequests, 
  approveAuthRequest, 
  rejectAuthRequest 
} from '../../../services/auth';
import { fetchStores } from '../../../services/stores';
import { useAuth } from '../../../providers/AuthProvider';
import { RequestList } from './components/RequestList';
import { ErrorDisplay } from './components/ErrorDisplay';
import { EmptyState } from './components/EmptyState';
import { LoadingState } from './components/LoadingState';
import { SuccessNotification } from '../../common/SuccessNotification';

export const AuthRequestList: React.FC = () => {
  const [requests, setRequests] = useState<AuthRequest[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const { currentUser } = useAuth();

  useEffect(() => {
    loadRequests();
  }, [currentUser]);

  const loadRequests = async () => {
    try {
      if (!currentUser) return;
      setLoading(true);
      const [data, storesData] = await Promise.all([
        fetchPendingAuthRequests(),
        fetchStores()
      ]);
      setRequests(data);
      setStores(storesData);
      setError(null);
    } catch (err) {
      setError('Failed to load authentication requests');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (request: AuthRequest) => {
    try {
      if (!currentUser) return;
      if (!currentUser.email) {
        setError('User email not found');
        return;
      }

      setSuccessMessage(null);
      setError(null);

      // Set loading state for this request
      setRequests(prev => 
        prev.map(r => r.id === request.id ? { ...r, loading: true } : r)
      );

      // Attempt to approve the request
      await approveAuthRequest(request.id, currentUser.uid, {
        email: request.email.toLowerCase().trim(),
        name: request.name,
        role: request.role,
        storeIds: request.storeIds,
        primaryStoreId: request.primaryStoreId,
        staffCode: request.staffCode
      });

      // On success, remove from pending list
      setRequests(prev => prev.filter(r => r.id !== request.id));

      // Show success message with more details
      setSuccessMessage(
        `Successfully approved ${request.name}'s request.\nA password reset email has been sent to ${request.email}.`
      );

    } catch (err) {
      let message = 'Failed to approve request';
      
      if (err instanceof Error) {
        if (err.message.includes('permission')) {
          message = 'You do not have permission to approve requests';
        } else {
          message = err.message;
        }
      }
      
      setError(message);

      // Reset loading states
      setRequests(prev =>
        prev.map(r => r.id === request.id ? { ...r, loading: false } : r)
      );
    }
  };

  const handleReject = async (requestId: string) => {
    try {
      if (!currentUser) return;
      setSuccessMessage(null);
      setError(null);
      
      const request = requests.find(r => r.id === requestId);
      if (!request) return;
      
      await rejectAuthRequest(requestId, currentUser.uid, 'Request rejected by admin');
      setRequests(requests.filter(r => r.id !== requestId));
      
      setSuccessMessage(`Successfully rejected ${request.name}'s request`);
    } catch (err) {
      setError('Failed to reject request');
    }
  };

  const clearSuccessMessage = () => {
    setSuccessMessage(null);
  };


  if (loading) {
    return <LoadingState />;
  }

  return (
    <div className="bg-white shadow-md rounded-lg">
      {successMessage && (
        <SuccessNotification 
          message={successMessage}
          onClose={clearSuccessMessage}
        />
      )}

      <div className="px-4 py-5 sm:px-6">
        <h3 className="text-lg font-medium leading-6 text-gray-900">
          Pending Authentication Requests
        </h3>
      </div>
      {error && (
        <ErrorDisplay message={error} />
      )}

      <RequestList
        requests={requests}
        stores={stores}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
};