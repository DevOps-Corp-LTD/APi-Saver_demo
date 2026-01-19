import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cacheApi, storagePoolsApi, sourcesApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  Archive,
  Trash2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  AlertTriangle,
  Loader2,
  Eye,
  X,
  Filter,
  Download,
  CheckSquare,
  Square,
  SortAsc,
  SortDesc,
  Calendar,
  BarChart3,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Share2,
} from 'lucide-react';
import CacheTable from '../components/CacheTable';
import CacheFilters from '../components/CacheFilters';
import CacheAnalytics from '../components/CacheAnalytics';
import CacheEntryModal from '../components/CacheEntryModal';
import BulkActionToolbar from '../components/BulkActionToolbar';

export default function CacheViewer({ poolFilter }) {
  const [page, setPage] = useState(1);
  const [showExpired, setShowExpired] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState(poolFilter || '');
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [selectedEntries, setSelectedEntries] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const searchTimeoutRef = useRef(null);
  const [sortField, setSortField] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showStats, setShowStats] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState('24h');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({
    statusCode: '',
    method: [],
    contentType: '',
    dateRange: { start: '', end: '' },
    hitCountMin: '',
    hitCountMax: '',
  });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [lastRefreshTime, setLastRefreshTime] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showTtlModal, setShowTtlModal] = useState(false);
  const [ttlInput, setTtlInput] = useState('3600');
  const [showAutoRefreshDropdown, setShowAutoRefreshDropdown] = useState(false);
  const autoRefreshDropdownRef = useRef(null);
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  
  // Close auto-refresh dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (autoRefreshDropdownRef.current && !autoRefreshDropdownRef.current.contains(event.target)) {
        setShowAutoRefreshDropdown(false);
      }
    };
    
    if (showAutoRefreshDropdown && autoRefresh) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showAutoRefreshDropdown, autoRefresh]);

  // Auto-show dropdown when enabling auto-refresh, auto-hide when disabling
  useEffect(() => {
    if (autoRefresh) {
      setShowAutoRefreshDropdown(true);
    } else {
      setShowAutoRefreshDropdown(false);
    }
  }, [autoRefresh]);

  // Debounce search query
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setPage(1); // Reset to first page on search
    }, 300); // 300ms debounce
    
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Lock pool filter when poolFilter prop is provided
  useEffect(() => {
    if (poolFilter && selectedPoolId !== poolFilter) {
      setSelectedPoolId(poolFilter);
    }
  }, [poolFilter, selectedPoolId]);

  // When poolFilter is provided, always use it and don't allow changing
  const effectivePoolId = poolFilter || selectedPoolId;
  
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['cache', page, showExpired, effectivePoolId, selectedSourceId, JSON.stringify(advancedFilters), debouncedSearchQuery, sortField, sortOrder],
    queryFn: () => {
      const params = {
        page,
        limit: 50,
        expired: showExpired,
        source_id: selectedSourceId || undefined,
        search: debouncedSearchQuery || undefined,
        sort_field: sortField,
        sort_order: sortOrder,
        // Advanced filters
        status_code: advancedFilters.statusCode || undefined,
        method: advancedFilters.method.length > 0 ? advancedFilters.method.join(',') : undefined,
        content_type: advancedFilters.contentType || undefined,
        created_after: advancedFilters.dateRange.start || undefined,
        created_before: advancedFilters.dateRange.end || undefined,
        hit_count_min: advancedFilters.hitCountMin || undefined,
        hit_count_max: advancedFilters.hitCountMax || undefined,
      };
      // Handle storage_pool_id: UUID for pool, undefined for all
      if (effectivePoolId && effectivePoolId !== '') {
        // Only set if it's a valid pool ID (not empty string for "All")
        params.storage_pool_id = effectivePoolId;
      }
      // If effectivePoolId is empty string or undefined, don't set storage_pool_id (shows all)
      
      // Remove undefined values to prevent axios from serializing them
      const cleanParams = Object.fromEntries(
        Object.entries(params).filter(([_, v]) => v !== undefined && v !== null)
      );
      
      return cacheApi.list(cleanParams).then((r) => r.data);
    },
  });

  const { data: statsData } = useQuery({
    queryKey: ['cache-stats', effectivePoolId, selectedSourceId],
    queryFn: () => {
      const params = {};
      // Handle storage_pool_id: UUID for pool, undefined for all
      if (effectivePoolId && effectivePoolId !== '') {
        // Only set if it's a valid pool ID (not empty string for "All")
        params.storage_pool_id = effectivePoolId;
      }
      // If effectivePoolId is empty string or undefined, don't set storage_pool_id (shows all)
      if (selectedSourceId) {
        params.source_id = selectedSourceId;
      }
      return cacheApi.stats(params).then((r) => r.data);
    },
  });

  const { data: analyticsData, isLoading: analyticsLoading } = useQuery({
    queryKey: ['cache-analytics', analyticsTimeRange, effectivePoolId, selectedSourceId],
    queryFn: () => cacheApi.analytics({
      time_range: analyticsTimeRange,
      source_id: selectedSourceId || undefined,
      storage_pool_id: effectivePoolId && effectivePoolId !== '' ? effectivePoolId : undefined,
    }).then((r) => r.data),
    enabled: showAnalytics,
  });

  const { data: poolsData } = useQuery({
    queryKey: ['storage-pools'],
    queryFn: () => storagePoolsApi.list().then((r) => {
      const data = r.data || {};
      return {
        pools: Array.isArray(data.pools) ? data.pools : [],
      };
    }),
  });

  const { data: sourcesData } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  const invalidateMutation = useMutation({
    mutationFn: (cacheKey) => cacheApi.invalidate({ cache_key: cacheKey }),
    onSuccess: () => {
      queryClient.invalidateQueries(['cache']);
      queryClient.invalidateQueries(['cache-stats']);
      queryClient.invalidateQueries(['metrics']);
      setSelectedEntries(new Set());
    },
    onError: (error) => {
      alert(`Failed to invalidate cache entry: ${error.response?.data?.message || error.message}`);
    },
  });

  const bulkInvalidateMutation = useMutation({
    mutationFn: (cacheKeys) => {
      return Promise.all(cacheKeys.map(key => cacheApi.invalidate({ cache_key: key })));
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['cache']);
      queryClient.invalidateQueries(['cache-stats']);
      queryClient.invalidateQueries(['metrics']);
      setSelectedEntries(new Set());
    },
    onError: (error) => {
      alert(`Failed to invalidate cache entries: ${error.response?.data?.message || error.message}`);
    },
  });


  const bulkUpdateExpirationMutation = useMutation({
    mutationFn: ({ entryIds, ttlSeconds }) => cacheApi.bulkUpdate(entryIds, ttlSeconds),
    onSuccess: (response, variables) => {
      const count = response?.data?.entries_updated || variables.entryIds.length;
      queryClient.invalidateQueries(['cache']);
      queryClient.invalidateQueries(['cache-stats']);
      queryClient.invalidateQueries(['metrics']);
      setSelectedEntries(new Set());
      // Show success message
      alert(`Successfully updated TTL for ${count} ${count === 1 ? 'entry' : 'entries'}`);
    },
    onError: (error) => {
      alert(`Failed to update cache entries: ${error.response?.data?.message || error.message}`);
    },
  });

  // Use entries directly from server (server handles filtering and sorting)
  // Client-side filtering removed to avoid duplication and improve performance
  const filteredAndSortedEntries = data?.entries || [];

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleBulkInvalidate = useCallback(() => {
    if (selectedEntries.size === 0) return;
    const entryIds = Array.from(selectedEntries);
    const cacheKeys = filteredAndSortedEntries
      .filter(e => entryIds.includes(e.id))
      .map(e => e.cache_key);
    if (confirm(`Are you sure you want to invalidate ${selectedEntries.size} cache ${selectedEntries.size === 1 ? 'entry' : 'entries'}?`)) {
      bulkInvalidateMutation.mutate(cacheKeys);
    }
  }, [selectedEntries, filteredAndSortedEntries, bulkInvalidateMutation]);

  const handleSelectAll = useCallback(() => {
    if (selectedEntries.size === filteredAndSortedEntries.length) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(filteredAndSortedEntries.map(e => e.id)));
    }
  }, [selectedEntries, filteredAndSortedEntries]);

  const handleSelectEntry = useCallback((entryId, event = null) => {
    setSelectedEntries(prev => {
      const newSelected = new Set(prev);
      
      // Handle Shift+Click for range selection
      if (event && event.shiftKey && prev.size > 0) {
        const entryIds = filteredAndSortedEntries.map(e => e.id);
        const lastSelectedIndex = entryIds.findIndex(id => prev.has(id));
        const currentIndex = entryIds.indexOf(entryId);
        
        if (lastSelectedIndex !== -1 && currentIndex !== -1) {
          const start = Math.min(lastSelectedIndex, currentIndex);
          const end = Math.max(lastSelectedIndex, currentIndex);
          for (let i = start; i <= end; i++) {
            newSelected.add(entryIds[i]);
          }
        } else {
          // Fallback to toggle if range selection fails
          if (newSelected.has(entryId)) {
            newSelected.delete(entryId);
          } else {
            newSelected.add(entryId);
          }
        }
      } else {
        // Normal toggle
        if (newSelected.has(entryId)) {
          newSelected.delete(entryId);
        } else {
          newSelected.add(entryId);
        }
      }
      
      return newSelected;
    });
  }, [filteredAndSortedEntries]);
  
  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh || selectedEntry) return; // Don't auto-refresh when modal is open
    
    // Initial refresh when auto-refresh is enabled
    Promise.all([
      refetch(),
      queryClient.invalidateQueries(['cache-stats']),
    ]).then(() => {
      setLastRefreshTime(new Date());
    });
    
    const interval = setInterval(() => {
      // Refresh both cache entries and stats
      Promise.all([
        refetch(),
        queryClient.invalidateQueries(['cache-stats']),
      ]).then(() => {
        setLastRefreshTime(new Date());
      });
    }, refreshInterval * 1000);
    
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, selectedEntry, refetch, queryClient]);

  // Pause auto-refresh when page is not visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && autoRefresh) {
        // Page is hidden, auto-refresh will pause naturally
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [autoRefresh]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd+A to select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleSelectAll();
      }
      
      // Delete key to invalidate selected
      if (e.key === 'Delete' && selectedEntries.size > 0 && isAdmin && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        handleBulkInvalidate();
      }
      
      // Escape to clear selection
      if (e.key === 'Escape' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        setSelectedEntries(new Set());
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEntries, isAdmin, handleSelectAll, handleBulkInvalidate]);

  const handleBulkUpdateExpiration = () => {
    if (selectedEntries.size === 0) return;
    setTtlInput('3600');
    setShowTtlModal(true);
  };

  const handleTtlSubmit = () => {
    const ttlSeconds = parseInt(ttlInput, 10);
    if (isNaN(ttlSeconds) || ttlSeconds < 0) {
      alert('Invalid TTL. Please enter a number >= 0.');
      return;
    }
    const entryIds = Array.from(selectedEntries);
    bulkUpdateExpirationMutation.mutate(
      { entryIds, ttlSeconds },
      {
        onSuccess: () => {
          setShowTtlModal(false);
          setTtlInput('3600');
        },
      }
    );
  };

  const handleInvalidate = (cacheKey) => {
    if (confirm('Are you sure you want to invalidate this cache entry?')) {
      invalidateMutation.mutate(cacheKey);
    }
  };


  const handleCopyCacheKey = (cacheKey) => {
    navigator.clipboard.writeText(cacheKey);
  };

  const handleCopyUrl = (url) => {
    navigator.clipboard.writeText(url);
  };

  const handleExport = (format = 'json') => {
    if (!data?.entries) return;
    
    const exportData = filteredAndSortedEntries.map(entry => ({
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
      pool: entry.storage_pool_id ? 'Shared' : 'Dedicated',
    }));
    
    let blob, filename, mimeType;
    
    if (format === 'csv') {
      // Convert to CSV
      const headers = Object.keys(exportData[0] || {});
      const csvRows = [
        headers.join(','),
        ...exportData.map(row => 
          headers.map(header => {
            const value = row[header];
            // Escape commas and quotes in CSV
            if (value === null || value === undefined) return '';
            const stringValue = String(value);
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
              return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
          }).join(',')
        )
      ];
      const csvContent = csvRows.join('\n');
      blob = new Blob([csvContent], { type: 'text/csv' });
      filename = `cache-entries-${new Date().toISOString().split('T')[0]}.csv`;
      mimeType = 'text/csv';
    } else {
      // JSON format
      blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      filename = `cache-entries-${new Date().toISOString().split('T')[0]}.json`;
      mimeType = 'application/json';
    }
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };


  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">Cache Viewer</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Browse and manage cached API responses
            {effectivePoolId && (
              <span className="ml-2 text-xs">(Filtered by pool)</span>
            )}
            {selectedSourceId && (
              <span className="ml-2 text-xs">(Filtered by source)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowStats(!showStats)}
            className="btn-secondary flex items-center gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            <span>Stats</span>
          </button>
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            className="btn-secondary flex items-center gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            <span>Analytics</span>
          </button>
          <div className="relative group">
            <button
              onClick={() => handleExport('json')}
              disabled={!data?.entries?.length}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
            <div className="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[120px]">
              <button
                onClick={() => handleExport('json')}
                className="w-full text-left px-4 py-2 hover:bg-surface-100 dark:hover:bg-surface-700 text-sm rounded-t-lg"
              >
                Export as JSON
              </button>
              <button
                onClick={() => handleExport('csv')}
                className="w-full text-left px-4 py-2 hover:bg-surface-100 dark:hover:bg-surface-700 text-sm rounded-b-lg"
              >
                Export as CSV
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                setIsRefreshing(true);
                try {
                  await Promise.all([
                    refetch(),
                    queryClient.invalidateQueries(['cache-stats']),
                  ]);
                  setLastRefreshTime(new Date());
                } finally {
                  setIsRefreshing(false);
                }
              }}
              disabled={isRefreshing}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <div className="relative" ref={autoRefreshDropdownRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setAutoRefresh(!autoRefresh);
                }}
                className={`btn-secondary flex items-center gap-2 ${autoRefresh ? 'bg-primary-100 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700' : ''}`}
                title={autoRefresh ? 'Auto-refresh enabled' : 'Enable auto-refresh'}
              >
                <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Auto</span>
              </button>
              {autoRefresh && showAutoRefreshDropdown && (
                <div 
                  className="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg p-2 z-10 min-w-[200px]"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-[var(--color-text)]">Interval:</span>
                    <select
                      value={refreshInterval}
                      onChange={(e) => setRefreshInterval(Number(e.target.value))}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="input text-sm w-24"
                    >
                      <option value={5}>5s</option>
                      <option value={10}>10s</option>
                      <option value={30}>30s</option>
                      <option value={60}>1m</option>
                      <option value={300}>5m</option>
                    </select>
                  </div>
                  {lastRefreshTime && (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Last: {lastRefreshTime.toLocaleTimeString()}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          {isAdmin && (
            <>
              {selectedEntries.size > 0 && (
                <>
                  <button
                    onClick={handleBulkUpdateExpiration}
                    disabled={bulkUpdateExpirationMutation.isPending}
                    className="btn-secondary flex items-center gap-2"
                  >
                    {bulkUpdateExpirationMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Calendar className="w-4 h-4" />
                    )}
                    <span>Update TTL ({selectedEntries.size})</span>
                  </button>
                  <button
                    onClick={handleBulkInvalidate}
                    disabled={bulkInvalidateMutation.isPending}
                    className="btn-danger flex items-center gap-2"
                  >
                    {bulkInvalidateMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    <span>Delete Selected ({selectedEntries.size})</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Statistics Panel */}
      {showStats && statsData && (
        <div className="card p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-primary-500">{statsData.total_entries || 0}</p>
            <p className="text-sm text-[var(--color-text-muted)]">Total Entries</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-500">
              {statsData.hit_ratio ? `${(statsData.hit_ratio * 100).toFixed(1)}%` : '0%'}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Hit Ratio</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-500">{statsData.total_hits || 0}</p>
            <p className="text-sm text-[var(--color-text-muted)]">Total Hits</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-amber-500">
              {statsData.expired_entries || 0}
            </p>
            <p className="text-sm text-[var(--color-text-muted)]">Expired Entries</p>
          </div>
        </div>
      )}

      {/* Analytics Dashboard */}
      {showAnalytics && (
        <CacheAnalytics
          analyticsData={analyticsData}
          analyticsLoading={analyticsLoading}
          analyticsTimeRange={analyticsTimeRange}
          onTimeRangeChange={setAnalyticsTimeRange}
        />
      )}

      {/* Storage Pools Display - Only show when not filtered to a specific pool */}
      {!poolFilter && poolsData && Array.isArray(poolsData.pools) && poolsData.pools.length > 0 && (
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-[var(--color-text)] mb-4">Storage Pools</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {poolsData.pools.map((pool) => (
              <div
                key={pool.id}
                className={`p-4 bg-surface-50 dark:bg-surface-800 rounded-lg border border-[var(--color-border)] cursor-pointer transition-colors ${
                  selectedPoolId === pool.id ? 'ring-2 ring-primary-500' : 'hover:border-primary-300'
                }`}
                onClick={() => {
                  setSelectedPoolId(selectedPoolId === pool.id ? '' : pool.id);
                  setPage(1);
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {pool.is_dedicated ? (
                      <HardDrive className="w-4 h-4 text-blue-500" />
                    ) : (
                      <Share2 className="w-4 h-4 text-purple-500" />
                    )}
                    <span className="font-medium text-[var(--color-text)]">{pool.name}</span>
                  </div>
                  {pool.is_dedicated ? (
                    <span className="badge badge-info">Dedicated</span>
                  ) : (
                    <span className="badge badge-warning">Shared</span>
                  )}
                </div>
                <div className="space-y-1 text-sm text-[var(--color-text-muted)]">
                  <p>Sources: {pool.source_count || 0}</p>
                  <p>Cache Entries: {pool.cache_entry_count || 0}</p>
                  <p>Total Hits: {pool.total_hits || 0}</p>
                </div>
                {pool.description && (
                  <p className="text-xs text-[var(--color-text-muted)] mt-2">{pool.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <CacheFilters
        searchQuery={searchQuery}
        onSearchChange={(value) => {
          setSearchQuery(value);
        }}
        showExpired={showExpired}
        onExpiredChange={(checked) => {
          setShowExpired(checked);
          setPage(1);
        }}
        poolFilter={poolFilter}
        selectedPoolId={selectedPoolId}
        poolsData={poolsData}
        onPoolChange={(value) => {
          setSelectedPoolId(value);
          setPage(1);
        }}
        selectedSourceId={selectedSourceId}
        sourcesData={sourcesData}
        onSourceChange={(value) => {
          setSelectedSourceId(value);
          setPage(1);
        }}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={setAdvancedFilters}
        showAdvancedFilters={showAdvancedFilters}
        onToggleAdvancedFilters={() => setShowAdvancedFilters(!showAdvancedFilters)}
        onClearFilters={() => {
          setSearchQuery('');
          setDebouncedSearchQuery('');
          setSelectedSourceId('');
          if (!poolFilter) setSelectedPoolId('');
          setShowExpired(false);
          setAdvancedFilters({
            statusCode: '',
            method: [],
            contentType: '',
            dateRange: { start: '', end: '' },
            hitCountMin: '',
            hitCountMax: '',
          });
          setPage(1);
        }}
      />

      {/* Bulk Action Toolbar */}
      {isAdmin && selectedEntries.size > 0 && (
        <BulkActionToolbar
          selectedCount={selectedEntries.size}
          onInvalidate={handleBulkInvalidate}
          onUpdateTTL={(ttl) => {
            const entryIds = Array.from(selectedEntries);
            bulkUpdateExpirationMutation.mutate(
              { entryIds, ttlSeconds: ttl },
              {
                onError: (error) => {
                  alert(`Failed to update TTL: ${error.response?.data?.message || error.message}`);
                },
              }
            );
          }}
          onExport={() => {
            const exportData = filteredAndSortedEntries
              .filter(e => selectedEntries.has(e.id))
              .map(entry => ({
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
            a.download = `cache-entries-selected-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
          onClear={() => setSelectedEntries(new Set())}
          isProcessing={bulkInvalidateMutation.isPending || bulkUpdateExpirationMutation.isPending}
        />
      )}

      {/* Table */}
      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : filteredAndSortedEntries.length > 0 ? (
        <>
          <CacheTable
            entries={filteredAndSortedEntries}
            isAdmin={isAdmin}
            poolFilter={poolFilter}
            poolsData={poolsData}
            sortField={sortField}
            sortOrder={sortOrder}
            selectedEntries={selectedEntries}
            onSort={handleSort}
            onSelectAll={handleSelectAll}
            onSelectEntry={handleSelectEntry}
            onViewEntry={setSelectedEntry}
            onInvalidate={handleInvalidate}
            onCopyUrl={handleCopyUrl}
            invalidatePending={invalidateMutation.isPending}
          />

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--color-text-muted)]">
              Showing {filteredAndSortedEntries.length} of {data.pagination.total} entries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary p-2 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-[var(--color-text)]">
                Page {data.pagination.page} of {data.pagination.pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))}
                disabled={page >= data.pagination.pages}
                className="btn-secondary p-2 disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <Archive className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--color-text)]">No cache entries</h3>
          <p className="text-[var(--color-text-muted)] mt-1">
            {debouncedSearchQuery
              ? 'No entries match your search criteria'
              : 'Make some API requests to populate the cache'}
          </p>
        </div>
      )}

      {/* TTL Update Modal */}
      {showTtlModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md animate-slide-up">
            <div className="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
              <h2 className="text-xl font-semibold text-[var(--color-text)]">
                Update TTL for {selectedEntries.size} {selectedEntries.size === 1 ? 'Entry' : 'Entries'}
              </h2>
              <button
                onClick={() => {
                  setShowTtlModal(false);
                  setTtlInput('3600');
                }}
                className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">TTL (seconds)</label>
                <input
                  type="number"
                  value={ttlInput}
                  onChange={(e) => setTtlInput(e.target.value)}
                  className="input"
                  placeholder="3600"
                  min="0"
                  autoFocus
                />
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Enter TTL in seconds. Use 0 for forever (no expiration).
                </p>
                <div className="mt-2 space-y-1">
                  <button
                    type="button"
                    onClick={() => setTtlInput('3600')}
                    className="text-xs text-primary-500 hover:text-primary-600 mr-3"
                  >
                    1 hour
                  </button>
                  <button
                    type="button"
                    onClick={() => setTtlInput('86400')}
                    className="text-xs text-primary-500 hover:text-primary-600 mr-3"
                  >
                    1 day
                  </button>
                  <button
                    type="button"
                    onClick={() => setTtlInput('604800')}
                    className="text-xs text-primary-500 hover:text-primary-600 mr-3"
                  >
                    1 week
                  </button>
                  <button
                    type="button"
                    onClick={() => setTtlInput('0')}
                    className="text-xs text-primary-500 hover:text-primary-600"
                  >
                    Forever
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-border)]">
                <button
                  onClick={() => {
                    setShowTtlModal(false);
                    setTtlInput('3600');
                  }}
                  className="btn-secondary flex-1"
                  disabled={bulkUpdateExpirationMutation.isPending}
                >
                  Cancel
                </button>
                <button
                  onClick={handleTtlSubmit}
                  disabled={bulkUpdateExpirationMutation.isPending || !ttlInput}
                  className="btn-primary flex items-center gap-2 flex-1"
                >
                  {bulkUpdateExpirationMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Updating...</span>
                    </>
                  ) : (
                    <>
                      <Calendar className="w-4 h-4" />
                      <span>Update TTL</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Entry detail modal */}
      <CacheEntryModal
        entry={selectedEntry}
        isAdmin={isAdmin}
        onClose={() => setSelectedEntry(null)}
        onInvalidate={handleInvalidate}
        onCopyUrl={handleCopyUrl}
        onCopyCacheKey={handleCopyCacheKey}
      />
    </div>
  );
}
