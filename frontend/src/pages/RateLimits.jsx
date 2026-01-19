import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rateLimitApi, sourcesApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Gauge,
  Plus,
  Edit,
  Trash2,
  Loader2,
  XCircle,
  CheckCircle2,
} from 'lucide-react';

export default function RateLimits() {
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [formData, setFormData] = useState({
    source_id: '',
    max_requests: 100,
    window_seconds: 60,
    is_enabled: true,
  });
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['rate-limits'],
    queryFn: () => rateLimitApi.list().then((r) => r.data),
  });

  const { data: sourcesData } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data) => rateLimitApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['rate-limits']);
      setShowModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => rateLimitApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['rate-limits']);
      setShowModal(false);
      setEditingRule(null);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => rateLimitApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['rate-limits']);
    },
  });

  const resetForm = () => {
    setFormData({
      source_id: '',
      max_requests: 100,
      window_seconds: 60,
      is_enabled: true,
    });
  };

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setFormData({
      source_id: rule.source_id,
      max_requests: rule.max_requests,
      window_seconds: rule.window_seconds,
      is_enabled: rule.is_enabled,
    });
    setShowModal(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (editingRule) {
      updateMutation.mutate({ id: editingRule.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id) => {
    if (confirm('Are you sure you want to delete this rate limit rule?')) {
      deleteMutation.mutate(id);
    }
  };

  const getSourceName = (sourceId) => {
    return sourcesData?.sources?.find((s) => s.id === sourceId)?.name || 'Unknown';
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
          <h1 className="text-3xl font-bold text-[var(--color-text)]">Rate Limits</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Configure rate limiting rules for API sources
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              setEditingRule(null);
              resetForm();
              setShowModal(true);
            }}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            <span>Add Rule</span>
          </button>
        )}
      </div>

      {/* Rules list */}
      {data?.rules?.length === 0 ? (
        <div className="card p-12 text-center">
          <Gauge className="w-16 h-16 mx-auto text-[var(--color-text-muted)] mb-4" />
          <p className="text-lg font-medium text-[var(--color-text)] mb-2">
            No rate limit rules configured
          </p>
          <p className="text-[var(--color-text-muted)]">
            {isAdmin
              ? 'Add your first rate limit rule to control API request rates'
              : 'Contact an administrator to configure rate limits'}
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
                  Max Requests
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  Window
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                  Status
                </th>
                {isAdmin && (
                  <th className="px-6 py-3 text-right text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data?.rules?.map((rule) => (
                <tr
                  key={rule.id}
                  className="hover:bg-surface-50 dark:hover:bg-surface-800/30"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-[var(--color-text)]">
                      {getSourceName(rule.source_id)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--color-text)]">
                      {rule.max_requests} requests
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-[var(--color-text)]">
                      {rule.window_seconds}s
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {rule.is_enabled ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-surface-100 dark:bg-surface-700 text-[var(--color-text-muted)]">
                        <XCircle className="w-3 h-3" />
                        Disabled
                      </span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(rule)}
                          className="btn-secondary p-2"
                          title="Edit rule"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(rule.id)}
                          disabled={deleteMutation.isPending}
                          className="btn-danger p-2"
                          title="Delete rule"
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
                {editingRule ? 'Edit Rate Limit Rule' : 'Add Rate Limit Rule'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false);
                  setEditingRule(null);
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
                  disabled={!!editingRule}
                >
                  <option value="">Select a source</option>
                  {sourcesData?.sources?.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
                {editingRule && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    ⚠️ Source cannot be changed after creation
                  </p>
                )}
              </div>

              <div>
                <label className="label">Max Requests</label>
                <input
                  type="number"
                  value={formData.max_requests}
                  onChange={(e) =>
                    setFormData({ ...formData, max_requests: parseInt(e.target.value) })
                  }
                  className="input"
                  required
                  min="1"
                  max="1000000"
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Maximum number of requests allowed
                </p>
              </div>

              <div>
                <label className="label">Window (seconds)</label>
                <input
                  type="number"
                  value={formData.window_seconds}
                  onChange={(e) =>
                    setFormData({ ...formData, window_seconds: parseInt(e.target.value) })
                  }
                  className="input"
                  required
                  min="1"
                  max="86400"
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Time window in seconds
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_enabled"
                  checked={formData.is_enabled}
                  onChange={(e) =>
                    setFormData({ ...formData, is_enabled: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <label htmlFor="is_enabled" className="text-sm text-[var(--color-text)]">
                  Enabled
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setEditingRule(null);
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
                  ) : editingRule ? (
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

