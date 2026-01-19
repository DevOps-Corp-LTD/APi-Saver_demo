import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { configApi, authApi, sourcesApi } from '../../lib/api';
import { Key, Power, AlertTriangle, Copy, Loader2 } from 'lucide-react';

export default function SecurityConfig() {
  const [rotatedKey, setRotatedKey] = useState(null);
  const queryClient = useQueryClient();

  const { data: killSwitchData, isLoading: killSwitchLoading } = useQuery({
    queryKey: ['kill-switch'],
    queryFn: () => configApi.getKillSwitch().then((r) => r.data),
  });

  const { data: sourcesData } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  const rotateMutation = useMutation({
    mutationFn: () => authApi.rotateKey(),
    onSuccess: (response) => {
      setRotatedKey(response.data.api_key);
    },
    onError: (error) => {
      alert(`Failed to rotate API key: ${error.response?.data?.message || error.message}`);
    },
  });

  const killSwitchMutation = useMutation({
    mutationFn: ({ enabled, sourceId }) => configApi.toggleKillSwitch(enabled, sourceId),
    onSuccess: () => {
      queryClient.invalidateQueries(['kill-switch']);
    },
    onError: (error) => {
      alert(`Failed to toggle kill switch: ${error.response?.data?.message || error.message}`);
    },
  });

  const handleCopyKey = () => {
    if (rotatedKey) {
      navigator.clipboard.writeText(rotatedKey);
      alert('API key copied to clipboard');
    }
  };

  return (
    <div className="space-y-6">
      {/* API Key Rotation */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
            <Key className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">API Key Management</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Rotate your API key for enhanced security
            </p>
          </div>
        </div>

        <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-medium text-[var(--color-text)]">Rotate API Key</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Generate a new API key. The old key will be invalidated.
              </p>
            </div>
            <button
              onClick={() => {
                if (confirm('Are you sure you want to rotate the API key? The current key will be invalidated.')) {
                  rotateMutation.mutate();
                }
              }}
              disabled={rotateMutation.isPending}
              className="btn-danger flex items-center gap-2"
            >
              {rotateMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Key className="w-4 h-4" />
              )}
              <span>Rotate Key</span>
            </button>
          </div>

          {rotatedKey && (
            <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-800">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="text-sm font-medium text-green-700 dark:text-green-300 mb-1">
                    New API Key Generated
                  </p>
                  <code className="text-xs font-mono bg-white dark:bg-surface-900 px-2 py-1 rounded break-all">
                    {rotatedKey}
                  </code>
                </div>
                <button
                  onClick={handleCopyKey}
                  className="ml-2 p-2 hover:bg-green-100 dark:hover:bg-green-900/30 rounded"
                  title="Copy key"
                >
                  <Copy className="w-4 h-4 text-green-600 dark:text-green-400" />
                </button>
              </div>
              <p className="text-xs text-green-700 dark:text-green-300 mt-2">
                ⚠️ Save this key now. You won't be able to see it again.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Kill Switch */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
            <Power className="w-5 h-5 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Kill Switch</h2>
            <p className="text-sm text-[var(--color-text-muted)]">
              Emergency stop for API requests - stops all or specific source requests
            </p>
          </div>
        </div>

        {killSwitchLoading ? (
          <div className="space-y-4">
            <div className="h-16 skeleton rounded-lg" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* App-level kill switch */}
            <div className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="font-medium text-[var(--color-text)]">App-Level Kill Switch</h3>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    When enabled, all API requests are blocked across all sources
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={killSwitchData?.enabled || false}
                    onChange={(e) => {
                      const newValue = e.target.checked;
                      if (
                        confirm(
                          newValue
                            ? 'Are you sure you want to enable the kill switch? This will block ALL API requests.'
                            : 'Are you sure you want to disable the kill switch? API requests will resume.'
                        )
                      ) {
                        killSwitchMutation.mutate({ enabled: newValue, sourceId: null });
                      }
                    }}
                    disabled={killSwitchMutation.isPending}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-red-600"></div>
                  <span className="ml-3 text-sm font-medium text-[var(--color-text)]">
                    {killSwitchData?.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </label>
              </div>
              {killSwitchData?.enabled && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                  <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm font-medium">Kill switch is ACTIVE</span>
                  </div>
                  <p className="text-xs text-red-700 dark:text-red-300 mt-1">
                    All API requests are currently blocked
                  </p>
                </div>
              )}
            </div>

            {/* Source-level kill switches */}
            {sourcesData?.sources && sourcesData.sources.length > 0 && (
              <div>
                <h3 className="font-medium text-[var(--color-text)] mb-3">Source-Level Kill Switches</h3>
                <div className="space-y-3">
                  {sourcesData.sources.map((source) => {
                    const sourceKillSwitch = killSwitchData?.sources?.find((s) => s.id === source.id);
                    const isEnabled = sourceKillSwitch?.enabled || false;
                    return (
                      <div
                        key={source.id}
                        className="p-4 rounded-lg bg-surface-50 dark:bg-surface-800/50 border border-[var(--color-border)]"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <p className="font-medium text-[var(--color-text)]">{source.name}</p>
                            <p className="text-sm text-[var(--color-text-muted)]">
                              {source.base_url}
                            </p>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={(e) => {
                                const newValue = e.target.checked;
                                if (
                                  confirm(
                                    newValue
                                      ? `Enable kill switch for ${source.name}? This will block all requests to this source.`
                                      : `Disable kill switch for ${source.name}? Requests to this source will resume.`
                                  )
                                ) {
                                  killSwitchMutation.mutate({
                                    enabled: newValue,
                                    sourceId: source.id,
                                  });
                                }
                              }}
                              disabled={killSwitchMutation.isPending}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary-300 dark:peer-focus:ring-primary-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-red-600"></div>
                            <span className="ml-3 text-sm font-medium text-[var(--color-text)]">
                              {isEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </label>
                        </div>
                        {isEnabled && (
                          <div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
                            <p className="text-xs text-red-700 dark:text-red-300">
                              Kill switch active for this source
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
