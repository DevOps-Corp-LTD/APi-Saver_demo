import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi, cacheApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Database, Save, Loader2, Trash2, Lock } from 'lucide-react';

const DEFAULT_CONFIGS = [
  { key: 'cache_ttl', label: 'Default Cache TTL (seconds)', type: 'number' },
  {
    key: 'source_selection_mode',
    label: 'Source Selection Mode',
    type: 'select',
    options: ['priority', 'round-robin'],
  },
];

export default function CacheConfig() {
  const [configValues, setConfigValues] = useState({});
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: () => configApi.list().then((r) => r.data),
  });

  const setMutation = useMutation({
    mutationFn: ({ key, value, isSecret }) => configApi.set(key, value, isSecret),
    onSuccess: () => {
      queryClient.invalidateQueries(['config']);
    },
    onError: (error) => {
      alert(`Failed to save configuration: ${error.response?.data?.message || error.message}`);
    },
  });

  const purgeMutation = useMutation({
    mutationFn: () => cacheApi.purge(),
    onSuccess: () => {
      queryClient.invalidateQueries(['cache']);
      queryClient.invalidateQueries(['cache-stats']);
      queryClient.invalidateQueries(['metrics']);
      alert('Cache purged successfully');
    },
    onError: (error) => {
      alert(`Failed to purge cache: ${error.response?.data?.message || error.message}`);
    },
  });

  // Initialize config values from data
  useEffect(() => {
    if (data?.configs) {
      const values = {};
      DEFAULT_CONFIGS.forEach((config) => {
        const found = data.configs.find((c) => c.config_key === config.key);
        values[config.key] = found?.config_value || '';
      });
      setConfigValues(values);
    }
  }, [data]);

  const handleSave = (key, value) => {
    setMutation.mutate({ key, value, isSecret: false });
  };

  const handlePurge = () => {
    if (
      confirm(
        'Are you sure you want to purge ALL cache entries? This cannot be undone.'
      )
    ) {
      purgeMutation.mutate();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-accent-100 dark:bg-accent-900/30">
          <Database className="w-5 h-5 text-accent-600 dark:text-accent-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text)]">Cache Configuration</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            Configure default cache behavior and source selection
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {DEFAULT_CONFIGS.map((_, i) => (
            <div key={i} className="h-20 skeleton rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {DEFAULT_CONFIGS.map((config) => {
            const currentValue = data?.configs?.find((c) => c.config_key === config.key)?.config_value || '';
            const value = configValues[config.key] !== undefined ? configValues[config.key] : currentValue;

            return (
              <div
                key={config.key}
                className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <label className="label">{config.label}</label>
                    {config.type === 'select' ? (
                      <select
                        value={value}
                        onChange={(e) => {
                          setConfigValues({ ...configValues, [config.key]: e.target.value });
                          handleSave(config.key, e.target.value);
                        }}
                        className="input mt-1"
                      >
                        {config.options?.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={config.type || 'text'}
                        value={value}
                        onChange={(e) => {
                          setConfigValues({ ...configValues, [config.key]: e.target.value });
                        }}
                        onBlur={() => handleSave(config.key, configValues[config.key] || value)}
                        className="input mt-1"
                        placeholder={config.placeholder}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => handleSave(config.key, configValues[config.key] || value)}
                    disabled={setMutation.isPending}
                    className="btn-primary flex items-center gap-2"
                  >
                    {setMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    <span>Save</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Purge All Button */}
      {isAdmin && (
        <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label className="label">Cache Management</label>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Permanently delete all cached entries. This action cannot be undone.
              </p>
            </div>
            <button
              onClick={handlePurge}
              disabled={purgeMutation.isPending}
              className="btn-danger flex items-center gap-2"
            >
              {purgeMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              <span>Purge All</span>
            </button>
          </div>
        </div>
      )}
      {!isAdmin && (
        <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <label className="label">Cache Management</label>
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                Permanently delete all cached entries. This action cannot be undone.
              </p>
            </div>
            <button
              disabled
              title="Admin role required to purge cache"
              className="btn-secondary flex items-center gap-2 opacity-50 cursor-not-allowed"
            >
              <Lock className="w-4 h-4" />
              <span>Purge All</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
