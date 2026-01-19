import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sourcesApi, storagePoolsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { validateUrl } from '../utils/validation';
import {
  Plus,
  Pencil,
  Trash2,
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Globe,
  Key,
  Clock,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  Server,
} from 'lucide-react';

// Helper function to extract canonical name from source name
function extractCanonicalName(sourceName) {
  const dashIndex = sourceName.indexOf(' - ');
  const spaceIndex = sourceName.indexOf(' ');
  
  if (dashIndex > 0) {
    return sourceName.substring(0, dashIndex);
  } else if (spaceIndex > 0 && !sourceName.match(/^[A-Z][a-z]+ [A-Z]/)) {
    return sourceName.split(' ')[0];
  }
  return sourceName;
}

// Helper function to group sources by canonical name
function groupSourcesByCanonicalName(sources) {
  const groups = new Map();
  
  sources.forEach(source => {
    const canonicalName = extractCanonicalName(source.name);
    if (!groups.has(canonicalName)) {
      groups.set(canonicalName, []);
    }
    groups.get(canonicalName).push(source);
  });
  
  // Sort sources within each group by priority
  groups.forEach((sources, canonicalName) => {
    sources.sort((a, b) => a.priority - b.priority);
  });
  
  return Array.from(groups.entries()).map(([canonicalName, sources]) => ({
    canonicalName,
    sources,
    isMultiSource: sources.length > 1,
  }));
}

export default function Sources() {
  const [showModal, setShowModal] = useState(false);
  const [editingSource, setEditingSource] = useState(null);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => sourcesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries(['sources']),
  });

  const testMutation = useMutation({
    mutationFn: (id) => sourcesApi.test(id),
  });

  const handleEdit = (source) => {
    setEditingSource(source);
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingSource(null);
    setShowModal(true);
  };

  const handleTest = async (id) => {
    testMutation.mutate(id);
  };

  const toggleGroupExpanded = (canonicalName) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(canonicalName)) {
      newExpanded.delete(canonicalName);
    } else {
      newExpanded.add(canonicalName);
    }
    setExpandedGroups(newExpanded);
  };

  const handleDeleteGroup = (group) => {
    if (confirm(`Are you sure you want to delete all ${group.sources.length} source(s) in "${group.canonicalName}"?`)) {
      group.sources.forEach(source => {
        deleteMutation.mutate(source.id);
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 skeleton" />
        <div className="card p-6">
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-20 skeleton rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const sourcesCount = data?.sources?.length || 0;
  const isDemoLimitReached = sourcesCount >= 2;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Demo Limitation Banner */}
      {isDemoLimitReached && (
        <div className="card bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 mt-0.5">
                <XCircle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-1">
                  Demo Version - 2 Sources Maximum
                </h3>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  You have reached the demo version limit of 2 API sources. To purchase the full version please contact{' '}
                  <a href="mailto:services@devops-corp.com" className="underline font-medium">
                    services@devops-corp.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">API Sources</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Manage your external API sources
            {isDemoLimitReached && (
              <span className="ml-2 text-amber-600 dark:text-amber-400 font-medium">
                (Demo Limit: 2 sources max)
              </span>
            )}
          </p>
        </div>
        {isAdmin && (
          <button 
            onClick={handleCreate} 
            disabled={isDemoLimitReached}
            className={`flex items-center gap-2 ${
              isDemoLimitReached 
                ? 'btn-secondary opacity-50 cursor-not-allowed' 
                : 'btn-primary'
            }`}
            title={isDemoLimitReached ? 'Demo version is limited to 2 sources. To purchase the full version please contact services@devops-corp.com' : 'Add Source'}
          >
            <Plus className="w-5 h-5" />
            <span>Add Source</span>
          </button>
        )}
      </div>

      {/* Sources list */}
      <div className="card">
        {data?.sources?.length > 0 ? (
          <div className="divide-y divide-[var(--color-border)]">
            {groupSourcesByCanonicalName(data.sources).map((group) => {
              const primarySource = group.sources[0];
              const isExpanded = expandedGroups.has(group.canonicalName);
              const allActive = group.sources.every(s => s.is_active);
              const anyActive = group.sources.some(s => s.is_active);
              
              return (
                <div
                  key={group.canonicalName}
                  className="p-6 hover:bg-surface-50 dark:hover:bg-surface-800/30 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        {group.isMultiSource && (
                          <button
                            onClick={() => toggleGroupExpanded(group.canonicalName)}
                            className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)]" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
                            )}
                          </button>
                        )}
                        <h3 className="text-lg font-semibold text-[var(--color-text)]">
                          {group.canonicalName}
                        </h3>
                        <span
                          className={`badge ${
                            allActive ? 'badge-success' : anyActive ? 'badge-warning' : 'badge-danger'
                          }`}
                        >
                          {allActive ? 'Active' : anyActive ? 'Partially Active' : 'Inactive'}
                        </span>
                        {group.isMultiSource && (
                          <span className="badge badge-info">
                            {group.sources.length} URL{group.sources.length > 1 ? 's' : ''}
                          </span>
                        )}
                        {primarySource.storage_mode && (
                          <span className={`badge ${
                            primarySource.storage_mode === 'dedicated' ? 'badge-info' : 'badge-warning'
                          }`}>
                            {primarySource.storage_mode === 'dedicated' ? 'Dedicated' : 'Shared'}
                          </span>
                        )}
                      </div>
                      
                      {/* Primary source info (always visible) */}
                      <div className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                        <Globe className="w-4 h-4" />
                        <span className="font-mono">{primarySource.base_url}</span>
                        <span className="badge badge-info text-xs">Priority: {primarySource.priority}</span>
                      </div>
                      
                      {/* Shared config info */}
                      <div className="mt-3 flex items-center gap-4 text-sm text-[var(--color-text-muted)]">
                        <div className="flex items-center gap-1">
                          <Key className="w-4 h-4" />
                          <span>Auth: {primarySource.auth_type}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span>Timeout: {primarySource.timeout_ms}ms</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <RefreshCw className="w-4 h-4" />
                          <span>Retries: {primarySource.retry_count}</span>
                        </div>
                        {primarySource.cost_per_request !== null && primarySource.cost_per_request !== undefined && (
                          <div className="flex items-center gap-1">
                            <span className="font-semibold">$</span>
                            <span>Cost: ${parseFloat(primarySource.cost_per_request).toFixed(4)}/req</span>
                          </div>
                        )}
                      </div>
                      
                      {/* Test result for single-source groups */}
                      {!group.isMultiSource && testMutation.isSuccess && testMutation.variables === primarySource.id && (
                        <div
                          className={`mt-3 p-2 rounded text-xs ${
                            testMutation.data?.data?.success
                              ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                          }`}
                        >
                          Status: {testMutation.data?.data?.status || 'N/A'} | Latency:{' '}
                          {testMutation.data?.data?.latency_ms}ms
                        </div>
                      )}
                      
                      {/* Expanded view: show all URLs */}
                      {isExpanded && group.isMultiSource && (
                        <div className="mt-4 space-y-3 pt-4 border-t border-[var(--color-border)]">
                          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                            <Server className="w-4 h-4" />
                            <span>All URLs ({group.sources.length})</span>
                          </div>
                          {group.sources.map((source, idx) => (
                            <div
                              key={source.id}
                              className="p-3 bg-surface-50 dark:bg-surface-800/50 rounded-lg border border-[var(--color-border)]"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="badge badge-info">Priority: {source.priority}</span>
                                    <span
                                      className={`badge text-xs ${
                                        source.is_active ? 'badge-success' : 'badge-danger'
                                      }`}
                                    >
                                      {source.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
                                    <Globe className="w-3 h-3" />
                                    <span className="font-mono">{source.base_url}</span>
                                  </div>
                                  <div className="mt-2 flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                                    <span>Auth: {source.auth_type}</span>
                                    <span>Timeout: {source.timeout_ms}ms</span>
                                    <span>Retries: {source.retry_count}</span>
                                  </div>
                                </div>
                                {isAdmin && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleTest(source.id)}
                                      disabled={testMutation.isPending}
                                      className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                                      title="Test this URL"
                                    >
                                      {testMutation.isPending && testMutation.variables === source.id ? (
                                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <PlayCircle className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (confirm(`Are you sure you want to delete "${source.base_url}"?`)) {
                                          deleteMutation.mutate(source.id);
                                        }
                                      }}
                                      className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                                      title="Delete this URL"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                                    </button>
                                  </div>
                                )}
                              </div>
                              {testMutation.isSuccess && testMutation.variables === source.id && (
                                <div
                                  className={`mt-2 p-2 rounded text-xs ${
                                    testMutation.data?.data?.success
                                      ? 'bg-accent-50 dark:bg-accent-900/20 text-accent-700 dark:text-accent-400'
                                      : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                                  }`}
                                >
                                  Status: {testMutation.data?.data?.status || 'N/A'} | Latency:{' '}
                                  {testMutation.data?.data?.latency_ms}ms
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {isAdmin && (
                      <div className="flex items-center gap-2">
                        {!group.isMultiSource && (
                          <button
                            onClick={() => handleTest(primarySource.id)}
                            disabled={testMutation.isPending}
                            className="p-2 hover:bg-surface-100 dark:hover:bg-surface-700 rounded-lg transition-colors"
                            title="Test this URL"
                          >
                            {testMutation.isPending && testMutation.variables === primarySource.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <PlayCircle className="w-4 h-4" />
                            )}
                          </button>
                        )}
                        <button
                          onClick={() => handleEdit(primarySource)}
                          className="btn-secondary flex items-center gap-2 text-sm"
                        >
                          <Pencil className="w-4 h-4" />
                          <span>Edit</span>
                        </button>
                        {group.isMultiSource && (
                          <button
                            onClick={() => handleDeleteGroup(group)}
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="Delete all URLs in this group"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        )}
                        {!group.isMultiSource && (
                          <button
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this source?')) {
                                deleteMutation.mutate(primarySource.id);
                              }
                            }}
                            className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center">
            <Globe className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[var(--color-text)]">
              No sources configured
            </h3>
            <p className="text-[var(--color-text-muted)] mt-1 mb-4">
              {isAdmin
                ? 'Add your first API source to start caching'
                : 'Contact an administrator to configure sources'}
            </p>
            {isAdmin && (
              <button onClick={handleCreate} className="btn-primary">
                Add Source
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && isAdmin && (
        <SourceModal
          source={editingSource}
          onClose={() => {
            setShowModal(false);
            setEditingSource(null);
          }}
        />
      )}
    </div>
  );
}

// Helper function to extract hostname from URL for display
function extractHostname(url) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    if (urlObj.port && 
        !((urlObj.protocol === 'http:' && urlObj.port === '80') ||
          (urlObj.protocol === 'https:' && urlObj.port === '443'))) {
      hostname = `${hostname}:${urlObj.port}`;
    }
    return hostname;
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0];
  }
}

function SourceModal({ source, onClose }) {
  const queryClient = useQueryClient();
  
  // Check if editing and load related sources
  const { data: allSources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.list().then((r) => r.data),
  });

  // Determine if this is a multi-source group
  const isMultiSource = source && allSources?.sources?.some(s => {
    if (s.id === source.id) return false;
    const canonicalName = extractCanonicalName(source.name);
    return extractCanonicalName(s.name) === canonicalName;
  });

  // Load related sources if editing a multi-source group
  const relatedSources = source && isMultiSource && allSources?.sources
    ? allSources.sources.filter(s => extractCanonicalName(s.name) === extractCanonicalName(source.name)).sort((a, b) => a.priority - b.priority)
    : source ? [source] : [];

  // Initialize form data
  const [formData, setFormData] = useState(() => {
    if (source && isMultiSource && relatedSources.length > 0) {
      // Multi-source: extract shared config and create url_entries
      const firstSource = relatedSources[0];
      const canonicalName = extractCanonicalName(firstSource.name);
      return {
        name: canonicalName,
        storage_mode: firstSource.storage_mode || 'dedicated',
        storage_pool_id: firstSource.storage_pool_id || null,
        bypass_bot_detection: firstSource.bypass_bot_detection ?? false,
        cost_per_request: firstSource.cost_per_request || null,
        is_active: firstSource.is_active ?? true,
        url_entries: relatedSources.map(s => ({
          base_url: s.base_url,
          auth_type: s.auth_type || 'none',
          auth_config: s.auth_config || {},
          priority: s.priority || 0,
          timeout_ms: s.timeout_ms || 30000,
          retry_count: s.retry_count || 3,
          circuit_breaker_threshold: s.circuit_breaker_threshold || 5,
          fallback_mode: s.fallback_mode || 'none',
        })),
      };
    } else if (source) {
      // Single source: convert to new format
      return {
        name: source.name,
        storage_mode: source.storage_mode || 'dedicated',
        storage_pool_id: source.storage_pool_id || null,
        bypass_bot_detection: source.bypass_bot_detection ?? false,
        cost_per_request: source.cost_per_request || null,
        is_active: source.is_active ?? true,
        url_entries: [{
          base_url: source.base_url,
          auth_type: source.auth_type || 'none',
          auth_config: source.auth_config || {},
          priority: source.priority || 0,
          timeout_ms: source.timeout_ms || 30000,
          retry_count: source.retry_count || 3,
          circuit_breaker_threshold: source.circuit_breaker_threshold || 5,
          fallback_mode: source.fallback_mode || 'none',
        }],
      };
    } else {
      // New source: default single entry
      return {
        name: '',
        storage_mode: 'dedicated',
        storage_pool_id: null,
        bypass_bot_detection: false,
        cost_per_request: null,
        is_active: true,
        url_entries: [{
          base_url: '',
          auth_type: 'none',
          auth_config: {},
          priority: 0,
          timeout_ms: 30000,
          retry_count: 3,
          circuit_breaker_threshold: 5,
          fallback_mode: 'none',
        }],
      };
    }
  });

  const [error, setError] = useState('');
  const [urlErrors, setUrlErrors] = useState({});
  const [expandedEntries, setExpandedEntries] = useState(new Set([0])); // First entry expanded by default

  // Update form data when sources load (for edit mode multi-source detection)
  useEffect(() => {
    if (source && allSources?.sources && !isMultiSource) {
      // Check again if this became a multi-source group
      const related = allSources.sources.filter(s => {
        if (s.id === source.id) return true;
        const canonicalName = extractCanonicalName(source.name);
        return extractCanonicalName(s.name) === canonicalName;
      });
      
      if (related.length > 1) {
        // It's a multi-source group, update form data
        const firstSource = related[0];
        const canonicalName = extractCanonicalName(firstSource.name);
        setFormData({
          name: canonicalName,
          storage_mode: firstSource.storage_mode || 'dedicated',
          storage_pool_id: firstSource.storage_pool_id || null,
          bypass_bot_detection: firstSource.bypass_bot_detection ?? false,
          cost_per_request: firstSource.cost_per_request || null,
          is_active: firstSource.is_active ?? true,
          url_entries: related.sort((a, b) => a.priority - b.priority).map(s => ({
            base_url: s.base_url,
            auth_type: s.auth_type || 'none',
            auth_config: s.auth_config || {},
            priority: s.priority || 0,
            timeout_ms: s.timeout_ms || 30000,
            retry_count: s.retry_count || 3,
            circuit_breaker_threshold: s.circuit_breaker_threshold || 5,
            fallback_mode: s.fallback_mode || 'none',
          })),
        });
        setExpandedEntries(new Set(related.map((_, i) => i)));
      }
    }
  }, [source, allSources, isMultiSource]);

  // Fetch storage pools for shared mode
  const { data: poolsData } = useQuery({
    queryKey: ['storage-pools'],
    queryFn: () => storagePoolsApi.list().then((r) => r.data),
    enabled: formData.storage_mode === 'shared',
  });

  const mutation = useMutation({
    mutationFn: async (data) => {
      if (source && isMultiSource) {
        // For multi-source updates, we need to update each source individually
        // This is a limitation - we'll update all related sources
        const updates = [];
        for (let i = 0; i < data.url_entries.length && i < relatedSources.length; i++) {
          const entry = data.url_entries[i];
          const sourceId = relatedSources[i].id;
          updates.push(sourcesApi.update(sourceId, {
            ...entry,
            name: data.url_entries.length === 1 ? data.name : `${data.name} - ${extractHostname(entry.base_url)}`,
            storage_mode: data.storage_mode,
            storage_pool_id: data.storage_pool_id,
            bypass_bot_detection: data.bypass_bot_detection,
            cost_per_request: data.cost_per_request,
            is_active: data.is_active,
          }));
        }
        // Handle new entries (if added) - create as new multi-source group
        if (data.url_entries.length > relatedSources.length) {
          const newEntries = data.url_entries.slice(relatedSources.length);
          const createResult = await sourcesApi.create({
            ...data,
            url_entries: newEntries,
          });
          updates.push(createResult);
        }
        const results = await Promise.all(updates);
        return { sources: results.flatMap(r => r.data?.sources || [r.data] || [r]) };
      } else if (source) {
        // Single source update
        return sourcesApi.update(source.id, {
          ...data.url_entries[0],
          name: data.name,
          storage_mode: data.storage_mode,
          storage_pool_id: data.storage_pool_id,
          bypass_bot_detection: data.bypass_bot_detection,
          cost_per_request: data.cost_per_request,
          is_active: data.is_active,
        });
      } else {
        // Create new source(s)
        return sourcesApi.create(data);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['sources']);
      onClose();
    },
    onError: (err) => {
      // Handle demo limit exceeded error (403)
      if (err.response?.status === 403) {
        setError(err.response?.data?.message || 'Demo version is limited to 2 API sources. To purchase the full version please contact services@devops-corp.com');
      } else {
        setError(err.response?.data?.message || 'Failed to save source');
      }
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Validate: multi-URL sources must use shared storage
    if (formData.url_entries.length > 1 && formData.storage_mode === 'dedicated') {
      setError('Shared storage is required when using multiple URLs. Please select a storage pool.');
      return;
    }
    
    // Validate: shared mode requires a pool
    if (formData.storage_mode === 'shared' && !formData.storage_pool_id) {
      setError('Please select a storage pool when using shared storage mode.');
      return;
    }
    
    // Validate all URLs
    const errors = {};
    const urlSet = new Set();
    
    formData.url_entries.forEach((entry, index) => {
      if (!entry.base_url) {
        errors[index] = 'URL is required';
        return;
      }
      
      if (urlSet.has(entry.base_url)) {
        errors[index] = 'Duplicate URL';
        return;
      }
      urlSet.add(entry.base_url);
      
      const urlValidation = validateUrl(entry.base_url);
      if (!urlValidation.valid) {
        errors[index] = urlValidation.error || 'Invalid URL';
      }
    });
    
    if (Object.keys(errors).length > 0) {
      setUrlErrors(errors);
      return;
    }
    
    setUrlErrors({});
    setError('');
    
    // Prepare data for submission
    const submitData = {
      name: formData.name,
      storage_mode: formData.storage_mode,
      storage_pool_id: formData.storage_pool_id,
      bypass_bot_detection: formData.bypass_bot_detection,
      cost_per_request: formData.cost_per_request,
      is_active: formData.is_active,
      url_entries: formData.url_entries,
    };
    
    mutation.mutate(submitData);
  };

  const handleUrlBlur = (index) => {
    const entry = formData.url_entries[index];
    if (entry.base_url) {
      const urlValidation = validateUrl(entry.base_url);
      if (!urlValidation.valid) {
        setUrlErrors({ ...urlErrors, [index]: urlValidation.error || 'Invalid URL' });
      } else {
        const newErrors = { ...urlErrors };
        delete newErrors[index];
        setUrlErrors(newErrors);
      }
    }
  };

  const addUrlEntry = () => {
    const newEntries = [
      ...formData.url_entries,
      {
        base_url: '',
        auth_type: 'none',
        auth_config: {},
        priority: formData.url_entries.length,
        timeout_ms: 30000,
        retry_count: 3,
        circuit_breaker_threshold: 5,
        fallback_mode: 'none',
      },
    ];
    
    // If adding second URL, automatically switch to shared mode
    const newStorageMode = newEntries.length > 1 ? 'shared' : formData.storage_mode;
    
    setFormData({
      ...formData,
      url_entries: newEntries,
      storage_mode: newStorageMode,
    });
    setExpandedEntries(new Set([...expandedEntries, formData.url_entries.length]));
  };

  const removeUrlEntry = (index) => {
    if (formData.url_entries.length === 1) return; // Don't allow removing the last entry
    
    const newEntries = formData.url_entries.filter((_, i) => i !== index);
    
    // If removing down to single URL, allow dedicated mode again
    const newStorageMode = newEntries.length === 1 ? 'dedicated' : 'shared';
    const newStoragePoolId = newEntries.length === 1 ? null : formData.storage_pool_id;
    
    setFormData({ 
      ...formData, 
      url_entries: newEntries,
      storage_mode: newStorageMode,
      storage_pool_id: newStoragePoolId,
    });
    
    const newExpanded = new Set(expandedEntries);
    newExpanded.delete(index);
    // Adjust indices
    const adjustedExpanded = new Set();
    expandedEntries.forEach(i => {
      if (i < index) adjustedExpanded.add(i);
      else if (i > index) adjustedExpanded.add(i - 1);
    });
    setExpandedEntries(adjustedExpanded);
    
    // Clear errors for removed entry
    const newErrors = { ...urlErrors };
    delete newErrors[index];
    const adjustedErrors = {};
    Object.keys(newErrors).forEach(key => {
      const idx = parseInt(key);
      if (idx < index) adjustedErrors[idx] = newErrors[key];
      else if (idx > index) adjustedErrors[idx - 1] = newErrors[key];
    });
    setUrlErrors(adjustedErrors);
  };

  const updateUrlEntry = (index, updates) => {
    const newEntries = [...formData.url_entries];
    newEntries[index] = { ...newEntries[index], ...updates };
    setFormData({ ...formData, url_entries: newEntries });
    
    // Clear error for this entry if URL changed
    if (updates.base_url && urlErrors[index]) {
      const newErrors = { ...urlErrors };
      delete newErrors[index];
      setUrlErrors(newErrors);
    }
  };

  const toggleEntryExpanded = (index) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedEntries(newExpanded);
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-4xl max-h-[90vh] overflow-auto animate-slide-up">
        <div className="p-6 border-b border-[var(--color-border)]">
          <h2 className="text-xl font-bold text-[var(--color-text)]">
            {source ? (isMultiSource ? 'Edit Multi-URL Source' : 'Edit Source') : 'Add Source'}
          </h2>
          {isMultiSource && (
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Editing {relatedSources.length} URL{relatedSources.length > 1 ? 's' : ''} for {extractCanonicalName(source.name)}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Shared Configuration Section */}
          <div className="space-y-4 border-b border-[var(--color-border)] pb-6">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Shared Configuration</h3>
            
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input"
                placeholder="My API Source"
                required
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                This name will be used as the canonical name for proxy routing
              </p>
            </div>

            <div>
              <label className="label">Storage Mode</label>
              <select
                value={formData.storage_mode}
                onChange={(e) => {
                  const newMode = e.target.value;
                  setFormData({
                    ...formData,
                    storage_mode: newMode,
                    storage_pool_id: newMode === 'dedicated' ? null : formData.storage_pool_id,
                  });
                }}
                className="input"
                disabled={formData.url_entries.length > 1}
              >
                <option value="dedicated">Dedicated (isolated cache per source group)</option>
                <option value="shared">Shared (cache shared via storage pool)</option>
              </select>
              {formData.url_entries.length > 1 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  ⚠️ Shared storage is required when using multiple URLs. All URLs in a multi-URL source must share the same cache pool.
                </p>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  {formData.storage_mode === 'dedicated'
                    ? 'A dedicated storage pool will be automatically created for this source'
                    : 'Multiple sources share cache entries via a storage pool'}
                </p>
              )}
            </div>

            {formData.storage_mode === 'shared' && (
              <div>
                <label className="label">
                  Storage Pool {formData.url_entries.length > 1 && <span className="text-red-500">*</span>}
                </label>
                <select
                  value={formData.storage_pool_id || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, storage_pool_id: e.target.value || null })
                  }
                  className="input"
                  required
                >
                  <option value="">Select a storage pool</option>
                  {poolsData?.pools
                    ?.filter((pool) => !pool.is_dedicated)
                    ?.map((pool) => (
                      <option key={pool.id} value={pool.id}>
                        {pool.name} {pool.description && `- ${pool.description}`}
                      </option>
                    ))}
                </select>
                {formData.url_entries.length > 1 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                    Required for multi-URL sources. All URLs will share this cache pool.
                  </p>
                )}
                {!poolsData?.pools?.filter((pool) => !pool.is_dedicated)?.length && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                    No shared pools available. Create one first.
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="label">Cost Per Request (USD)</label>
              <input
                type="number"
                step="0.0001"
                min="0"
                max="9999.9999"
                value={formData.cost_per_request || ''}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    cost_per_request: e.target.value ? parseFloat(e.target.value) : null,
                  })
                }
                className="input"
                placeholder="0.0000"
              />
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                Cost per API request for this source (used in cost savings calculations)
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) =>
                    setFormData({ ...formData, is_active: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-[var(--color-border)] text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="is_active" className="text-sm text-[var(--color-text)]">
                  Active
                </label>
              </div>
              
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id="bypass_bot_detection"
                  checked={formData.bypass_bot_detection}
                  onChange={(e) =>
                    setFormData({ ...formData, bypass_bot_detection: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-[var(--color-border)] text-primary-600 focus:ring-primary-500 mt-0.5"
                />
                <div className="flex-1">
                  <label htmlFor="bypass_bot_detection" className="text-sm text-[var(--color-text)] cursor-pointer">
                    Bypass Bot Detection
                  </label>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    Automatically retry with browser headers when challenge pages (Cloudflare, AWS WAF, Akamai, etc.) are detected
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* URL Entries Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--color-text)]">
                URL Entries ({formData.url_entries.length})
              </h3>
              <button
                type="button"
                onClick={addUrlEntry}
                className="btn-secondary flex items-center gap-2 text-sm"
              >
                <Plus className="w-4 h-4" />
                Add URL
              </button>
            </div>

            {formData.url_entries.map((entry, index) => (
              <div
                key={index}
                className="border border-[var(--color-border)] rounded-lg p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleEntryExpanded(index)}
                      className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                    >
                      {expandedEntries.has(index) ? (
                        <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)]" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
                      )}
                    </button>
                    <span className="badge badge-info">Priority: {entry.priority}</span>
                    {entry.base_url && (
                      <span className="text-sm text-[var(--color-text-muted)] font-mono">
                        {extractHostname(entry.base_url)}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeUrlEntry(index)}
                    disabled={formData.url_entries.length === 1}
                    className="p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {expandedEntries.has(index) && (
                  <div className="space-y-4 pt-2">
                    <div>
                      <label className="label">Base URL</label>
                      <input
                        type="url"
                        value={entry.base_url}
                        onChange={(e) => updateUrlEntry(index, { base_url: e.target.value })}
                        onBlur={() => handleUrlBlur(index)}
                        className={`input font-mono ${urlErrors[index] ? 'border-red-500' : ''}`}
                        placeholder="https://api.example.com"
                        required
                      />
                      {urlErrors[index] && (
                        <p className="text-sm text-red-500 mt-1">{urlErrors[index]}</p>
                      )}
                    </div>

                    <div>
                      <label className="label">Authentication Type</label>
                      <select
                        value={entry.auth_type}
                        onChange={(e) => updateUrlEntry(index, { auth_type: e.target.value, auth_config: {} })}
                        className="input"
                      >
                        <option value="none">None</option>
                        <option value="bearer">Bearer Token</option>
                        <option value="api_key">API Key Header</option>
                        <option value="basic">Basic Auth</option>
                      </select>
                    </div>

                    {entry.auth_type === 'bearer' && (
                      <div>
                        <label className="label">Bearer Token</label>
                        <input
                          type="password"
                          value={entry.auth_config?.token || ''}
                          onChange={(e) =>
                            updateUrlEntry(index, {
                              auth_config: { ...entry.auth_config, token: e.target.value },
                            })
                          }
                          className="input input-secret"
                          placeholder="Your bearer token"
                        />
                      </div>
                    )}

                    {entry.auth_type === 'api_key' && (
                      <>
                        <div>
                          <label className="label">Header Name</label>
                          <input
                            type="text"
                            value={entry.auth_config?.header_name || ''}
                            onChange={(e) =>
                              updateUrlEntry(index, {
                                auth_config: { ...entry.auth_config, header_name: e.target.value },
                              })
                            }
                            className="input"
                            placeholder="X-API-Key"
                          />
                        </div>
                        <div>
                          <label className="label">API Key</label>
                          <input
                            type="password"
                            value={entry.auth_config?.key || ''}
                            onChange={(e) =>
                              updateUrlEntry(index, {
                                auth_config: { ...entry.auth_config, key: e.target.value },
                              })
                            }
                            className="input input-secret"
                            placeholder="Your API key"
                          />
                        </div>
                      </>
                    )}

                    {entry.auth_type === 'basic' && (
                      <>
                        <div>
                          <label className="label">Username</label>
                          <input
                            type="text"
                            value={entry.auth_config?.username || ''}
                            onChange={(e) =>
                              updateUrlEntry(index, {
                                auth_config: { ...entry.auth_config, username: e.target.value },
                              })
                            }
                            className="input"
                            placeholder="Username"
                          />
                        </div>
                        <div>
                          <label className="label">Password</label>
                          <input
                            type="password"
                            value={entry.auth_config?.password || ''}
                            onChange={(e) =>
                              updateUrlEntry(index, {
                                auth_config: { ...entry.auth_config, password: e.target.value },
                              })
                            }
                            className="input input-secret"
                            placeholder="Password"
                          />
                        </div>
                      </>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">Priority</label>
                        <input
                          type="number"
                          value={entry.priority}
                          onChange={(e) =>
                            updateUrlEntry(index, { priority: parseInt(e.target.value) || 0 })
                          }
                          className="input"
                          min="0"
                        />
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                          Lower numbers = higher priority (for failover)
                        </p>
                      </div>
                      <div>
                        <label className="label">Timeout (ms)</label>
                        <input
                          type="number"
                          value={entry.timeout_ms}
                          onChange={(e) =>
                            updateUrlEntry(index, { timeout_ms: parseInt(e.target.value) || 30000 })
                          }
                          className="input"
                          min="1000"
                          max="300000"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">Retry Count</label>
                        <input
                          type="number"
                          value={entry.retry_count}
                          onChange={(e) =>
                            updateUrlEntry(index, { retry_count: parseInt(e.target.value) || 3 })
                          }
                          className="input"
                          min="0"
                          max="10"
                        />
                      </div>
                      <div>
                        <label className="label">Circuit Breaker Threshold</label>
                        <input
                          type="number"
                          value={entry.circuit_breaker_threshold}
                          onChange={(e) =>
                            updateUrlEntry(index, {
                              circuit_breaker_threshold: parseInt(e.target.value) || 5,
                            })
                          }
                          className="input"
                          min="1"
                          max="100"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {error && (
            <div className={`p-4 rounded-lg ${
              error.includes('Demo version is limited') || error.includes('services@devops-corp.com')
                ? 'bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800'
                : 'bg-red-50 dark:bg-red-900/20'
            }`}>
              <div className={`text-sm ${
                error.includes('Demo version is limited') || error.includes('services@devops-corp.com')
                  ? 'text-amber-800 dark:text-amber-200'
                  : 'text-red-600 dark:text-red-400'
              }`}>
                {error.includes('services@devops-corp.com') ? (
                  <div>
                    <div className="font-semibold mb-2">Demo Limit Reached</div>
                    <div>{error.split('services@devops-corp.com')[0]}
                      <a href="mailto:services@devops-corp.com" className="underline font-medium mx-1">
                        services@devops-corp.com
                      </a>
                      {error.split('services@devops-corp.com')[1]}
                    </div>
                  </div>
                ) : (
                  error
                )}
              </div>
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
              <span>{source ? 'Save Changes' : 'Create Source'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
