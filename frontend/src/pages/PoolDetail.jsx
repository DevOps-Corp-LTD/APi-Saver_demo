import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { storagePoolsApi, cacheApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft,
  Database,
  BarChart3,
  List,
  Users,
  Settings,
  Loader2,
  Trash2,
  Download,
  RefreshCw,
  HardDrive,
  Save,
  AlertTriangle,
} from 'lucide-react';
import CacheViewer from './CacheViewer';
import SourceAssignment from '../components/SourceAssignment';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function PoolDetail() {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('overview');
  const [settingsFormData, setSettingsFormData] = useState({ name: '', description: '' });
  const [settingsError, setSettingsError] = useState('');
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  
  // Get pool data to check if it's dedicated
  const { data: poolData } = useQuery({
    queryKey: ['storage-pool', id],
    queryFn: () => storagePoolsApi.get(id).then((r) => r.data),
    enabled: !!id,
  });
  
  const isDedicated = poolData?.is_dedicated || false;

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['pool-stats', id],
    queryFn: () => storagePoolsApi.getStats(id).then((r) => r.data),
    enabled: !!id,
  });

  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['pool-sources', id],
    queryFn: () => storagePoolsApi.getSources(id).then((r) => r.data),
    enabled: !!id,
  });

  // Update settings form when pool data loads
  useEffect(() => {
    if (poolData && activeTab === 'settings') {
      setSettingsFormData({
        name: poolData.name || '',
        description: poolData.description || '',
      });
      setSettingsError('');
    }
  }, [poolData, activeTab]);

  const updatePoolMutation = useMutation({
    mutationFn: (data) => storagePoolsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['pool', id]);
      queryClient.invalidateQueries(['pool-stats', id]);
      queryClient.invalidateQueries(['storage-pools']);
      setSettingsError('');
      alert('Pool settings updated successfully');
    },
    onError: (error) => {
      setSettingsError(error.response?.data?.message || 'Failed to update pool settings');
    },
  });

  if (statsLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      </div>
    );
  }

  if (!statsData) {
    return (
      <div className="space-y-6">
        <Link to="/storage-pools" className="btn-secondary inline-flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Pools
        </Link>
        <div className="card p-12 text-center">
          <Database className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--color-text)]">Pool not found</h3>
        </div>
      </div>
    );
  }

  const pool = statsData?.pool || poolData || { id: id, name: 'Loading...', description: '' };
  const stats = statsData;

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart3 },
    { id: 'cache', label: 'Cache Entries', icon: List },
    { id: 'sources', label: 'Sources', icon: Users },
    ...(isAdmin && !isDedicated ? [{ id: 'settings', label: 'Settings', icon: Settings }] : []),
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/storage-pools" className="btn-secondary inline-flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-[var(--color-text)] flex items-center gap-2">
              {isDedicated ? <HardDrive className="w-8 h-8 text-blue-500" /> : <Database className="w-8 h-8" />}
              {pool.name}
            </h1>
            {pool.description && (
              <p className="text-[var(--color-text-muted)] mt-1">{pool.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => queryClient.invalidateQueries(['pool-stats', id])}
            className="btn-secondary flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {isAdmin && (
            <>
              <button
                onClick={async () => {
                  if (confirm(`Purge all cache entries from ${pool.name}?`)) {
                    try {
                      await storagePoolsApi.purgeCache(id, {});
                      queryClient.invalidateQueries(['pool-stats', id]);
                      queryClient.invalidateQueries(['cache']);
                    } catch (err) {
                      alert('Failed to purge cache: ' + (err.response?.data?.message || err.message));
                    }
                  }
                }}
                className="btn-secondary flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Purge Cache
              </button>
              <button
                onClick={async () => {
                  try {
                    // First, get the first page to determine total count
                    const firstPage = await storagePoolsApi.listCache(id, { page: 1, limit: 100 });
                    const total = firstPage.data?.pagination?.total || 0;
                    const totalPages = firstPage.data?.pagination?.pages || 1;
                    
                    if (total === 0) {
                      alert('No cache entries to export');
                      return;
                    }
                    
                    // Collect all entries from all pages
                    let allEntries = firstPage.data?.entries || [];
                    
                    // Fetch remaining pages if there are more
                    if (totalPages > 1) {
                      const remainingPages = [];
                      for (let page = 2; page <= totalPages; page++) {
                        remainingPages.push(
                          storagePoolsApi.listCache(id, { page, limit: 100 })
                        );
                      }
                      
                      const remainingResults = await Promise.all(remainingPages);
                      for (const result of remainingResults) {
                        allEntries = allEntries.concat(result.data?.entries || []);
                      }
                    }
                    
                    const exportData = allEntries.map(entry => ({
                      method: entry.request_method,
                      url: entry.request_url,
                      status: entry.response_status,
                      contentType: entry.content_type,
                      hits: entry.hit_count,
                      expiresAt: entry.expires_at,
                      createdAt: entry.created_at,
                      cacheKey: entry.cache_key,
                      ttl: entry.ttl_seconds,
                    }));
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `pool-${pool.name}-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    alert(`Exported ${allEntries.length} cache entries`);
                  } catch (err) {
                    alert('Failed to export: ' + (err.response?.data?.message || err.message));
                  }
                }}
                className="btn-secondary flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--color-border)]">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 flex items-center gap-2 border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-500'
                    : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="card p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[var(--color-text-muted)]">Total Entries</span>
                  <Database className="w-5 h-5 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-3xl font-bold text-[var(--color-text)]">
                  {parseInt(stats.total_entries || 0, 10)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {parseInt(stats.active_entries || 0, 10)} active
                </p>
              </div>

              <div className="card p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[var(--color-text-muted)]">Storage Size</span>
                  <HardDrive className="w-5 h-5 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-3xl font-bold text-[var(--color-text)]">
                  {formatBytes(stats.total_size_bytes || 0)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Avg: {formatBytes(stats.average_size_bytes || 0)}
                </p>
              </div>

              <div className="card p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[var(--color-text-muted)]">Total Hits</span>
                  <BarChart3 className="w-5 h-5 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-3xl font-bold text-[var(--color-text)]">
                  {parseInt(stats.total_hits || 0, 10)}
                </p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Avg: {parseFloat(stats.avg_hits_per_entry || 0).toFixed(1)} per entry
                </p>
              </div>

              <div className="card p-6">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-[var(--color-text-muted)]">Sources</span>
                  <Users className="w-5 h-5 text-[var(--color-text-muted)]" />
                </div>
                <p className="text-3xl font-bold text-[var(--color-text)]">
                  {parseInt(stats.source_count || 0, 10)}
                </p>
              </div>
            </div>

            {/* Source Breakdown */}
            {stats.source_breakdown && stats.source_breakdown.length > 0 && (
              <div className="card p-6">
                <h2 className="text-xl font-semibold text-[var(--color-text)] mb-4">Source Breakdown</h2>
                <div className="space-y-3">
                  {stats.source_breakdown.map((source) => (
                    <div
                      key={source.source_id}
                      className="flex items-center justify-between p-3 bg-surface-50 dark:bg-surface-800 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-[var(--color-text)]">{source.source_name || 'Unknown'}</p>
                        <p className="text-sm text-[var(--color-text-muted)]">
                          {parseInt(source.entry_count || 0, 10)} entries
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-[var(--color-text)]">
                          {parseInt(source.total_hits || 0, 10)} hits
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Status Breakdown */}
            {stats.status_breakdown && stats.status_breakdown.length > 0 && (
              <div className="card p-6">
                <h2 className="text-xl font-semibold text-[var(--color-text)] mb-4">Status Code Distribution</h2>
                <div className="space-y-2">
                  {stats.status_breakdown.map((status) => (
                    <div key={status.response_status} className="flex items-center justify-between">
                      <span className="text-sm text-[var(--color-text)]">
                        {status.response_status}
                      </span>
                      <div className="flex items-center gap-2 flex-1 mx-4">
                        <div className="flex-1 bg-surface-100 dark:bg-surface-800 rounded-full h-2">
                          <div
                            className="bg-primary-500 h-2 rounded-full"
                            style={{
                              width: `${(parseInt(status.count || 0, 10) / parseInt(stats.total_entries || 1, 10)) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-sm font-medium text-[var(--color-text)] w-16 text-right">
                        {parseInt(status.count || 0, 10)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top URLs */}
            {stats.top_urls && stats.top_urls.length > 0 && (
              <div className="card p-6">
                <h2 className="text-xl font-semibold text-[var(--color-text)] mb-4">Top URLs by Hits</h2>
                <div className="space-y-2">
                  {stats.top_urls.map((url, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-2 hover:bg-surface-50 dark:hover:bg-surface-800 rounded"
                    >
                      <code className="text-sm text-[var(--color-text-muted)] flex-1 truncate">
                        {url.request_url}
                      </code>
                      <div className="flex items-center gap-4 ml-4">
                        <span className="text-sm text-[var(--color-text-muted)]">
                          {parseInt(url.entry_count || 0, 10)} entries
                        </span>
                        <span className="text-sm font-semibold text-[var(--color-text)]">
                          {parseInt(url.total_hits || 0, 10)} hits
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'cache' && (
          <div className="space-y-4">
            {/* Info banner */}
            <div className="card p-4 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                <div>
                  <p className="text-sm font-medium text-primary-900 dark:text-primary-100">
                    Showing cache entries from {pool.name}
                  </p>
                  <p className="text-xs text-primary-700 dark:text-primary-300 mt-0.5">
                    {parseInt(stats.total_entries || 0, 10)} total entries • {formatBytes(stats.total_size_bytes || 0)} total size
                  </p>
                </div>
              </div>
            </div>
            
            {/* Embedded cache viewer filtered to this pool */}
            <CacheViewer poolFilter={id} />
          </div>
        )}

        {activeTab === 'sources' && (
          <SourceAssignment poolId={id} isDedicated={isDedicated} />
        )}

        {activeTab === 'settings' && !isDedicated && (
          <div className="card p-6">
            <h2 className="text-xl font-semibold text-[var(--color-text)] mb-6">Pool Settings</h2>
            
            {settingsError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg border border-red-200 dark:border-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                {settingsError}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!settingsFormData.name.trim()) {
                  setSettingsError('Pool name is required');
                  return;
                }
                updatePoolMutation.mutate({
                  name: settingsFormData.name.trim(),
                  description: settingsFormData.description.trim() || null,
                });
              }}
              className="space-y-6"
            >
              <div>
                <label className="label">Pool Name *</label>
                <input
                  type="text"
                  value={settingsFormData.name}
                  onChange={(e) => {
                    setSettingsFormData({ ...settingsFormData, name: e.target.value });
                    setSettingsError('');
                  }}
                  className="input"
                  placeholder="My Storage Pool"
                  required
                  disabled={updatePoolMutation.isPending}
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  A unique name to identify this storage pool
                </p>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  value={settingsFormData.description}
                  onChange={(e) => {
                    setSettingsFormData({ ...settingsFormData, description: e.target.value });
                    setSettingsError('');
                  }}
                  className="input"
                  placeholder="Describe the purpose of this storage pool"
                  rows={4}
                  disabled={updatePoolMutation.isPending}
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Optional description to help identify the pool's purpose
                </p>
              </div>

              <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-border)]">
                <button
                  type="submit"
                  disabled={updatePoolMutation.isPending || !settingsFormData.name.trim()}
                  className="btn-primary flex items-center gap-2"
                >
                  {updatePoolMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>Save Changes</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (poolData) {
                      setSettingsFormData({
                        name: poolData.name || '',
                        description: poolData.description || '',
                      });
                      setSettingsError('');
                    }
                  }}
                  disabled={updatePoolMutation.isPending}
                  className="btn-secondary"
                >
                  Reset
                </button>
              </div>
            </form>

            {/* Pool Information */}
            <div className="mt-8 pt-6 border-t border-[var(--color-border)]">
              <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">Pool Information</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-[var(--color-text-muted)]">Pool ID</p>
                  <p className="font-mono text-[var(--color-text)] mt-1">{id}</p>
                </div>
                {poolData?.created_at && (
                  <div>
                    <p className="text-[var(--color-text-muted)]">Created</p>
                    <p className="text-[var(--color-text)] mt-1">
                      {new Date(poolData.created_at).toLocaleString()}
                    </p>
                  </div>
                )}
                {poolData?.updated_at && (
                  <div>
                    <p className="text-[var(--color-text-muted)]">Last Updated</p>
                    <p className="text-[var(--color-text)] mt-1">
                      {new Date(poolData.updated_at).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

