import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cachePolicyApi, sourcesApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { validateCron } from '../utils/validation';
import {
  Settings2,
  Plus,
  Edit,
  Trash2,
  Loader2,
  XCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
} from 'lucide-react';

export default function CachePolicies() {
  const [showModal, setShowModal] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [formData, setFormData] = useState({
    source_id: '',
    max_ttl_seconds: 86400,
    no_cache: false,
    purge_schedule: '',
  });
  const [cronError, setCronError] = useState('');
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['cache-policies'],
    queryFn: () => cachePolicyApi.list().then((r) => r.data),
  });

  const { data: sourcesData } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data) => cachePolicyApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['cache-policies']);
      setShowModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data) => cachePolicyApi.upsert(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['cache-policies']);
      setShowModal(false);
      setEditingPolicy(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => cachePolicyApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['cache-policies']);
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => cachePolicyApi.cleanup(),
    onSuccess: () => {
      queryClient.invalidateQueries(['cache']);
      queryClient.invalidateQueries(['metrics']);
    },
  });

  const resetForm = () => {
    setFormData({
      source_id: '',
      max_ttl_seconds: 86400,
      no_cache: false,
      purge_schedule: '',
    });
  };

  const handleEdit = (policy) => {
    setEditingPolicy(policy);
    setFormData({
      source_id: policy.source_id,
      max_ttl_seconds: policy.max_ttl_seconds,
      no_cache: policy.no_cache,
      purge_schedule: policy.purge_schedule || '',
    });
    setShowModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate cron expression if provided
    if (formData.purge_schedule) {
      const cronValidation = validateCron(formData.purge_schedule);
      if (!cronValidation.valid) {
        setCronError(cronValidation.error || 'Invalid cron expression');
        return;
      }
    }
    
    setCronError('');
    const submitData = { ...formData };
    if (!submitData.purge_schedule) {
      delete submitData.purge_schedule;
    }
    if (editingPolicy) {
      updateMutation.mutate(submitData);
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleCronBlur = () => {
    if (formData.purge_schedule) {
      const cronValidation = validateCron(formData.purge_schedule);
      setCronError(cronValidation.valid ? '' : (cronValidation.error || 'Invalid cron expression'));
    } else {
      setCronError('');
    }
  };

  const handleDelete = (id) => {
    if (confirm('Are you sure you want to delete this cache policy?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleCleanup = () => {
    if (confirm('Are you sure you want to purge all expired cache entries?')) {
      cleanupMutation.mutate();
    }
  };

  const getSourceName = (sourceId) => {
    return sourcesData?.sources?.find((s) => s.id === sourceId)?.name || 'Unknown';
  };

  const formatTTL = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">Cache Policies</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Configure caching behavior for API sources
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <>
              <button
                onClick={handleCleanup}
                disabled={cleanupMutation.isPending}
                className="btn-secondary flex items-center gap-2"
              >
                {cleanupMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>Cleanup Expired</span>
              </button>
              <button
                onClick={() => {
                  setEditingPolicy(null);
                  resetForm();
                  setShowModal(true);
                }}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span>Add Policy</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Policies list */}
      {data?.policies?.length === 0 ? (
        <div className="card p-12 text-center">
          <Settings2 className="w-16 h-16 mx-auto text-[var(--color-text-muted)] mb-4" />
          <p className="text-lg font-medium text-[var(--color-text)] mb-2">
            No cache policies configured
          </p>
          <p className="text-[var(--color-text-muted)]">
            {isAdmin
              ? 'Add your first cache policy to control caching behavior'
              : 'Contact an administrator to configure cache policies'}
          </p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface-50 dark:bg-surface-800/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  Source
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  Max TTL
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  Cache
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  Purge Schedule
                </th>
                {isAdmin && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data?.policies?.map((policy) => (
                <tr
                  key={policy.id}
                  className="hover:bg-surface-50 dark:hover:bg-surface-800/30"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {getSourceName(policy.source_id)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                      <Clock className="w-4 h-4 text-[var(--color-text-muted)]" />
                      {formatTTL(policy.max_ttl_seconds)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {policy.no_cache ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                        <XCircle className="w-3 h-3 mr-1" />
                        Disabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Enabled
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-mono text-[var(--color-text-muted)]">
                      {policy.purge_schedule || '-'}
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(policy)}
                          className="btn-secondary p-2"
                          title="Edit policy"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(policy.id)}
                          disabled={deleteMutation.isPending}
                          className="btn-danger p-2"
                          title="Delete policy"
                        >
                          {deleteMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && isAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="card max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-[var(--color-text)]">
                {editingPolicy ? 'Edit Cache Policy' : 'Add Cache Policy'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingPolicy(null);
                  resetForm();
                }}
                className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Source</label>
                <select
                  value={formData.source_id}
                  onChange={(e) =>
                    setFormData({ ...formData, source_id: e.target.value })
                  }
                  className="input"
                  required
                  disabled={!!editingPolicy}
                >
                  <option value="">Select a source</option>
                  {sourcesData?.sources?.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
                {editingPolicy && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    ⚠️ Source cannot be changed after creation
                  </p>
                )}
              </div>

              <div>
                <label className="label">Max TTL (seconds)</label>
                <input
                  type="number"
                  value={formData.max_ttl_seconds}
                  onChange={(e) =>
                    setFormData({ ...formData, max_ttl_seconds: parseInt(e.target.value) })
                  }
                  className="input"
                  required
                  min="0"
                  max="31536000"
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Maximum time-to-live for cached entries (0 = no limit)
                </p>
              </div>

              <div>
                <label className="label">Purge Schedule (Cron)</label>
                <input
                  type="text"
                  value={formData.purge_schedule}
                  onChange={(e) => {
                    setFormData({ ...formData, purge_schedule: e.target.value });
                    if (cronError) setCronError(''); // Clear error on change
                  }}
                  onBlur={handleCronBlur}
                  className={`input font-mono ${cronError ? 'border-red-500' : ''}`}
                  placeholder="0 2 * * *"
                />
                {cronError ? (
                  <p className="text-sm text-red-500 mt-1">{cronError}</p>
                ) : (
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    Optional cron expression for automatic cleanup (e.g., "0 2 * * *" for daily at 2 AM)
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="no_cache"
                  checked={formData.no_cache}
                  onChange={(e) =>
                    setFormData({ ...formData, no_cache: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <label htmlFor="no_cache" className="text-sm text-[var(--color-text)]">
                  Disable caching for this source
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingPolicy(null);
                    resetForm();
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="btn-primary"
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : editingPolicy ? (
                    'Update'
                  ) : (
                    'Create'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

