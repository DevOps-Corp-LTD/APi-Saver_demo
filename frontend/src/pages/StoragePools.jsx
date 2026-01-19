import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { storagePoolsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Database,
  Eye,
  Download,
  BarChart3,
  HardDrive,
  TrendingUp,
  Users,
  Activity,
  Zap,
  Trash,
  ExternalLink,
  Folder,
  Share2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

// Size visualization component
function SizeVisualization({ sizeBytes, maxSize, label }) {
  const percentage = maxSize > 0 ? (sizeBytes / maxSize) * 100 : 0;
  const sizeFormatted = formatBytes(sizeBytes);
  
  // Color coding based on size relative to max (no red colors)
  let colorClass = 'bg-blue-500';
  if (percentage > 80) colorClass = 'bg-orange-500';
  else if (percentage > 50) colorClass = 'bg-yellow-500';
  else if (percentage > 25) colorClass = 'bg-green-500';
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-[var(--color-text-muted)]">{label}</span>
        <span className="font-semibold text-[var(--color-text)]">{sizeFormatted}</span>
      </div>
      <div className="w-full bg-surface-100 dark:bg-surface-800 rounded-full h-2 overflow-hidden">
        <div
          className={`h-full ${colorClass} transition-all duration-300`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

// Pool card component
function PoolCard({ pool, isDedicated = false, maxSize = 0, onEdit, onDelete, onView, isAdmin, queryClient }) {
  const [isPurging, setIsPurging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const sizeBytes = pool.total_size_bytes || 0;
  const sizeFormatted = formatBytes(sizeBytes);
  const avgSizeFormatted = formatBytes(pool.average_size_bytes || 0);

  const handlePurge = async () => {
    if (!confirm(`Purge all cache entries in ${pool.name}? This action cannot be undone.`)) {
      return;
    }
    
    setIsPurging(true);
    try {
      // Dedicated pool uses special ID
      if (pool.id === '__dedicated__') {
        // For dedicated pool, we need to purge entries with storage_pool_id = NULL
        // This would require a special API endpoint or we skip it for now
        alert('Purging dedicated pool cache is not yet supported. Please use Cache Viewer to purge individual entries.');
        setIsPurging(false);
        return;
      }
      await storagePoolsApi.purgeCache(pool.id, {});
      queryClient.invalidateQueries(['storage-pools']);
      queryClient.invalidateQueries(['pool-stats', pool.id]);
      queryClient.invalidateQueries(['cache']);
      alert(`Cache purged successfully for ${pool.name}`);
    } catch (error) {
      alert(`Failed to purge cache: ${error.response?.data?.message || error.message}`);
    } finally {
      setIsPurging(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      // Dedicated pool uses special ID
      if (pool.id === '__dedicated__') {
        alert('Exporting dedicated pool cache is not yet supported. Please use Cache Viewer to export entries.');
        setIsExporting(false);
        return;
      }
      
      // First, get the first page to determine total count
      const firstPage = await storagePoolsApi.listCache(pool.id, { page: 1, limit: 100 });
      const total = firstPage.data?.pagination?.total || 0;
      const totalPages = firstPage.data?.pagination?.pages || 1;
      
      if (total === 0) {
        alert('No cache entries to export');
        setIsExporting(false);
        return;
      }
      
      // Collect all entries from all pages
      let allEntries = firstPage.data?.entries || [];
      
      // Fetch remaining pages if there are more
      if (totalPages > 1) {
        const remainingPages = [];
        for (let page = 2; page <= totalPages; page++) {
          remainingPages.push(
            storagePoolsApi.listCache(pool.id, { page, limit: 100 })
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
        source: entry.source_name,
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
    } catch (error) {
      alert(`Failed to export cache: ${error.response?.data?.message || error.message}`);
    } finally {
      setIsExporting(false);
    }
  };
  
  return (
    <div
      className={`p-6 rounded-lg border transition-all hover:shadow-lg ${
        isDedicated
          ? 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10'
          : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-surface-50 dark:hover:bg-surface-800/30'
      }`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          {isDedicated ? (
            <HardDrive className="w-6 h-6 text-blue-500" />
          ) : (
            <Share2 className="w-6 h-6 text-purple-500" />
          )}
          <div>
            <h3 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
              {pool.name}
              {isDedicated ? (
                <span className="badge badge-info text-xs">Dedicated</span>
              ) : (
                <span className="badge badge-warning text-xs">Shared</span>
              )}
            </h3>
            {pool.description && (
              <p className="text-sm text-[var(--color-text-muted)] mt-1">
                {pool.description}
              </p>
            )}
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            {!isDedicated && pool.id !== '__dedicated__' && (
              <button
                onClick={() => onEdit(pool)}
                className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg transition-colors"
                title="Edit pool"
              >
                <Pencil className="w-4 h-4 text-[var(--color-text-muted)]" />
              </button>
            )}
            {pool.id !== '__dedicated__' && (
              <button
                onClick={() => onDelete(pool)}
                className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                title="Delete pool"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Size Visualization */}
      <div className="mb-4">
        <SizeVisualization
          sizeBytes={sizeBytes}
          maxSize={maxSize}
          label="Storage Size"
        />
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <Database className="w-4 h-4" />
            <span>Entries</span>
          </div>
          <div className="text-lg font-semibold text-[var(--color-text)]">
            {pool.cache_entry_count || 0}
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            Avg: {avgSizeFormatted}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <Users className="w-4 h-4" />
            <span>Sources</span>
          </div>
          <div className="text-lg font-semibold text-[var(--color-text)]">
            {pool.source_count || 0}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <Zap className="w-4 h-4" />
            <span>Total Hits</span>
          </div>
          <div className="text-lg font-semibold text-[var(--color-text)]">
            {pool.total_hits || 0}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-1">
            <HardDrive className="w-4 h-4" />
            <span>Size</span>
          </div>
          <div className="text-lg font-semibold text-[var(--color-text)]">
            {sizeFormatted}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-2 pt-4 border-t border-[var(--color-border)]">
        {pool.id !== '__dedicated__' ? (
          <Link
            to={`/storage-pools/${pool.id}`}
            className="btn-secondary flex items-center gap-2 text-sm flex-1 justify-center"
          >
            <Eye className="w-4 h-4" />
            <span>View Details</span>
          </Link>
        ) : (
          <Link
            to="/cache"
            className="btn-secondary flex items-center gap-2 text-sm flex-1 justify-center"
            title="View dedicated pool entries in Cache Viewer"
          >
            <Eye className="w-4 h-4" />
            <span>View in Cache Viewer</span>
          </Link>
        )}
        {isAdmin && pool.id !== '__dedicated__' && (
          <>
            <button
              onClick={handlePurge}
              disabled={isPurging || isExporting}
              className="btn-secondary flex items-center gap-2 text-sm"
              title="Purge cache"
            >
              {isPurging ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={handleExport}
              disabled={isPurging || isExporting}
              className="btn-secondary flex items-center gap-2 text-sm"
              title="Export cache"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function StoragePools() {
  const [showModal, setShowModal] = useState(false);
  const [editingPool, setEditingPool] = useState(null);
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['storage-pools'],
    queryFn: () => storagePoolsApi.list().then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, purgeCache }) => storagePoolsApi.delete(id, { purge_cache: purgeCache }),
    onSuccess: () => {
      queryClient.invalidateQueries(['storage-pools']);
      // Success feedback handled by UI
    },
    onError: (error) => {
      alert(`Failed to delete storage pool: ${error.response?.data?.message || error.message}`);
    },
  });

  // Calculate max size for visualization
  const maxSize = useMemo(() => {
    if (!data) return 0;
    const pools = data.pools || [];
    const poolSizes = pools.map(p => p.total_size_bytes || 0);
    return Math.max(...poolSizes, 1); // At least 1 to avoid division by zero
  }, [data]);

  const handleEdit = (pool) => {
    setEditingPool(pool);
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingPool(null);
    setShowModal(true);
  };

  const handleDelete = async (pool) => {
    const purgeCache = confirm(
      'Delete this storage pool? This will also delete all cache entries in the pool. Continue?'
    );
    if (purgeCache) {
      deleteMutation.mutate({ id: pool.id, purgeCache: true });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="card p-6">
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 skeleton rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const pools = data?.pools || [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">Storage Pools</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Manage storage pools and view cache statistics
          </p>
        </div>
        {isAdmin && (
          <button onClick={handleCreate} className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" />
            <span>Create Pool</span>
          </button>
        )}
      </div>

      {/* Size Comparison Chart */}
      {pools.length > 0 ? (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Storage Size Comparison
          </h2>
          <div className="space-y-3">
            {pools.map((pool) => (
              <SizeVisualization
                key={pool.id}
                sizeBytes={pool.total_size_bytes || 0}
                maxSize={maxSize}
                label={pool.name}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Pools Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {pools.map((pool) => (
          <PoolCard
            key={pool.id}
            pool={pool}
            isDedicated={pool.is_dedicated || false}
            maxSize={maxSize}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onView={() => {}}
            isAdmin={isAdmin}
            queryClient={queryClient}
          />
        ))}
      </div>

      {/* Empty State */}
      {pools.length === 0 && (
        <div className="card p-12 text-center">
          <Database className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--color-text)]">
            No storage pools configured
          </h3>
          <p className="text-[var(--color-text-muted)] mt-1 mb-4">
            {isAdmin
              ? 'Create a storage pool to enable shared caching between sources'
              : 'Contact an administrator to configure storage pools'}
          </p>
          {isAdmin && (
            <button onClick={handleCreate} className="btn-primary">
              Create Pool
            </button>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && isAdmin && (
        <StoragePoolModal
          pool={editingPool}
          onClose={() => {
            setShowModal(false);
            setEditingPool(null);
          }}
        />
      )}
    </div>
  );
}

function StoragePoolModal({ pool, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    name: pool?.name || '',
    description: pool?.description || '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (data) =>
      pool ? storagePoolsApi.update(pool.id, data) : storagePoolsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['storage-pools']);
      onClose();
      // Success feedback handled by UI state change
    },
    onError: (err) => {
      const errorMessage = err.response?.data?.message || err.message || 'Failed to save storage pool';
      setError(errorMessage);
      // Clear error after 5 seconds
      setTimeout(() => setError(''), 5000);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg max-h-[90vh] overflow-auto animate-slide-up">
        <div className="p-6 border-b border-[var(--color-border)]">
          <h2 className="text-xl font-bold text-[var(--color-text)]">
            {pool ? 'Edit Storage Pool' : 'Create Storage Pool'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="label">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input"
              placeholder="My Storage Pool"
              required
            />
          </div>

          <div>
            <label className="label">Description (optional)</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input"
              placeholder="Describe the purpose of this storage pool"
              rows={3}
            />
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm rounded-lg">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{pool ? 'Save Changes' : 'Create Pool'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
