import { CheckSquare, Square, SortAsc, SortDesc, Copy, Eye, Trash2, AlertTriangle } from 'lucide-react';

export default function CacheTable({
  entries,
  isAdmin,
  poolFilter,
  poolsData,
  sortField,
  sortOrder,
  selectedEntries,
  onSort,
  onSelectAll,
  onSelectEntry,
  onViewEntry,
  onInvalidate,
  onCopyUrl,
  invalidatePending,
}) {
  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? (
      <SortAsc className="w-4 h-4 inline ml-1" />
    ) : (
      <SortDesc className="w-4 h-4 inline ml-1" />
    );
  };

  return (
    <div className="card p-0 overflow-hidden">
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              {isAdmin && (
                <th className="w-12">
                  <button
                    onClick={onSelectAll}
                    className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                  >
                    {selectedEntries.size === entries.length ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
              )}
              <th>
                <button
                  onClick={() => onSort('method')}
                  className="flex items-center gap-1 hover:text-primary-500"
                >
                  Method
                  <SortIcon field="method" />
                </button>
              </th>
              <th>
                <button
                  onClick={() => onSort('url')}
                  className="flex items-center gap-1 hover:text-primary-500"
                >
                  URL
                  <SortIcon field="url" />
                </button>
              </th>
              <th>
                <button
                  onClick={() => onSort('status')}
                  className="flex items-center gap-1 hover:text-primary-500"
                >
                  Status
                  <SortIcon field="status" />
                </button>
              </th>
              <th>Content Type</th>
              {!poolFilter && <th>Pool</th>}
              <th>
                <button
                  onClick={() => onSort('hits')}
                  className="flex items-center gap-1 hover:text-primary-500"
                >
                  Hits
                  <SortIcon field="hits" />
                </button>
              </th>
              <th>
                <button
                  onClick={() => onSort('expires')}
                  className="flex items-center gap-1 hover:text-primary-500"
                >
                  Expires
                  <SortIcon field="expires" />
                </button>
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              // Check if entry never expires (expires_at is null or ttl_seconds is 0)
              const neverExpires = !entry.expires_at || entry.ttl_seconds === 0;
              const isExpired = !neverExpires && new Date(entry.expires_at) < new Date();
              const isSelected = selectedEntries.has(entry.id);
              return (
                <tr key={entry.id} className={isSelected ? 'bg-primary-50 dark:bg-primary-900/20' : ''}>
                  {isAdmin && (
                    <td>
                      <button
                        onClick={(e) => onSelectEntry(entry.id, e)}
                        className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-4 h-4 text-primary-500" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </td>
                  )}
                  <td>
                    <span
                      className={`badge ${
                        entry.request_method === 'GET'
                          ? 'badge-success'
                          : entry.request_method === 'POST'
                          ? 'badge-info'
                          : entry.request_method === 'DELETE'
                          ? 'badge-danger'
                          : 'badge-warning'
                      }`}
                    >
                      {entry.request_method}
                    </span>
                  </td>
                  <td>
                    <div className="max-w-xs truncate font-mono text-sm group relative">
                      <span>{entry.request_url}</span>
                      <button
                        onClick={() => onCopyUrl(entry.request_url)}
                        className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Copy URL"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        entry.response_status >= 200 && entry.response_status < 300
                          ? 'badge-success'
                          : entry.response_status >= 400
                          ? 'badge-danger'
                          : 'badge-warning'
                      }`}
                    >
                      {entry.response_status}
                    </span>
                  </td>
                  <td className="text-sm text-[var(--color-text-muted)]">
                    {entry.content_type?.split(';')[0] || 'N/A'}
                  </td>
                  {!poolFilter && (
                    <td>
                      {entry.storage_pool_id ? (
                        <span className="badge badge-warning">
                          {poolsData?.pools?.find(p => p.id === entry.storage_pool_id)?.name || 'Shared'}
                        </span>
                      ) : (
                        <span className="badge badge-info">Dedicated</span>
                      )}
                    </td>
                  )}
                  <td className="text-sm font-medium">{entry.hit_count || 0}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      {isExpired && (
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                      )}
                      <span
                        className={`text-sm ${
                          isExpired
                            ? 'text-amber-500'
                            : 'text-[var(--color-text-muted)]'
                        }`}
                      >
                        {neverExpires ? 'Never' : new Date(entry.expires_at).toLocaleString()}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => onViewEntry(entry)}
                        className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4 text-[var(--color-text-muted)]" />
                      </button>
                      {isAdmin && (
                        <button
                          onClick={() => onInvalidate(entry.cache_key)}
                          disabled={invalidatePending}
                          className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors text-red-500"
                          title="Invalidate cache"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
