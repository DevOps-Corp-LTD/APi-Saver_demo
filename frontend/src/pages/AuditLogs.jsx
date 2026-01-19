import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../lib/api';
import JsonViewer from '../components/JsonViewer';
import {
  FileText,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Edit,
  Trash2,
  Plus,
} from 'lucide-react';

export default function AuditLogs() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    action: '',
    resource_type: '',
    from: '',
    to: '',
  });
  const [showFilters, setShowFilters] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, filters],
    queryFn: () => {
      // Remove empty string values from filters
      const cleanFilters = Object.fromEntries(
        Object.entries({ page, limit: 20, ...filters }).filter(([_, v]) => v !== '' && v !== null && v !== undefined)
      );
      return auditApi.list(cleanFilters).then((r) => r.data);
    },
  });

  const { data: filterOptions } = useQuery({
    queryKey: ['audit-filters'],
    queryFn: () => auditApi.filters().then((r) => r.data),
  });

  const handleExport = async (format = 'csv') => {
    try {
      const response = await auditApi.export({ ...filters, format });
      
      let blob, mimeType;
      if (format === 'csv') {
        blob = new Blob([response.data], { type: 'text/csv' });
        mimeType = 'text/csv';
      } else {
        // For JSON, ensure we have proper JSON data
        const jsonData = typeof response.data === 'string' 
          ? JSON.parse(response.data) 
          : response.data;
        blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
        mimeType = 'application/json';
      }
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      alert(`Failed to export audit logs: ${error.response?.data?.message || error.message || 'Unknown error'}`);
    }
  };

  const getActionIcon = (action) => {
    if (action.includes('create') || action.includes('login')) {
      return <Plus className="w-4 h-4" />;
    }
    if (action.includes('update') || action.includes('upsert')) {
      return <Edit className="w-4 h-4" />;
    }
    if (action.includes('delete')) {
      return <Trash2 className="w-4 h-4" />;
    }
    return <AlertCircle className="w-4 h-4" />;
  };

  const getActionColor = (action) => {
    if (action.includes('create') || action.includes('login')) {
      return 'badge-success';
    }
    if (action.includes('update') || action.includes('upsert')) {
      return 'badge-info';
    }
    if (action.includes('delete')) {
      return 'badge-danger';
    }
    return 'badge-warning';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">Audit Logs</h1>
          <p className="text-[var(--color-text-muted)] mt-1">
            Track all system activities and changes
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary flex items-center gap-2"
          >
            <Filter className="w-4 h-4" />
            <span>Filters</span>
          </button>
          <div className="relative group">
            <button
              onClick={() => handleExport('csv')}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
            <div className="absolute right-0 top-full mt-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[120px]">
              <button
                onClick={() => handleExport('csv')}
                className="w-full text-left px-4 py-2 hover:bg-surface-100 dark:hover:bg-surface-700 text-sm rounded-t-lg"
              >
                Export as CSV
              </button>
              <button
                onClick={() => handleExport('json')}
                className="w-full text-left px-4 py-2 hover:bg-surface-100 dark:hover:bg-surface-700 text-sm rounded-b-lg"
              >
                Export as JSON
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="card p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="label">Action</label>
              <select
                value={filters.action}
                onChange={(e) => {
                  setFilters({ ...filters, action: e.target.value });
                  setPage(1);
                }}
                className="input"
              >
                <option value="">All Actions</option>
                {filterOptions?.actions?.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Resource Type</label>
              <select
                value={filters.resource_type}
                onChange={(e) => {
                  setFilters({ ...filters, resource_type: e.target.value });
                  setPage(1);
                }}
                className="input"
              >
                <option value="">All Types</option>
                {filterOptions?.resource_types?.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">From Date</label>
              <input
                type="datetime-local"
                value={filters.from}
                onChange={(e) => {
                  setFilters({ ...filters, from: e.target.value });
                  setPage(1);
                }}
                className="input"
              />
            </div>
            <div>
              <label className="label">To Date</label>
              <input
                type="datetime-local"
                value={filters.to}
                onChange={(e) => {
                  setFilters({ ...filters, to: e.target.value });
                  setPage(1);
                }}
                className="input"
              />
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setFilters({ action: '', resource_type: '', from: '', to: '' });
                setPage(1);
              }}
              className="btn-secondary"
            >
              Clear Filters
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="card p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : data?.logs?.length > 0 ? (
        <>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>IP Address</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((log) => (
                  <tr key={log.id}>
                    <td className="text-sm text-[var(--color-text-muted)]">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                    <td>
                      <div className="text-sm font-medium text-[var(--color-text)]">
                        {log.user_email || 'System'}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${getActionColor(log.action)} flex items-center gap-1 w-fit`}>
                        {getActionIcon(log.action)}
                        {log.action}
                      </span>
                    </td>
                    <td>
                      <div className="text-sm">
                        <span className="font-medium text-[var(--color-text)]">
                          {log.resource_type}
                        </span>
                        {log.resource_id && (
                          <span className="text-[var(--color-text-muted)] ml-1 font-mono text-xs">
                            ({log.resource_id.slice(0, 8)}...)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-sm font-mono text-[var(--color-text-muted)]">
                      {log.ip_address || 'N/A'}
                    </td>
                    <td>
                      {log.new_value || log.old_value ? (
                        <details className="text-sm">
                          <summary className="cursor-pointer text-primary-500 hover:text-primary-600">
                            View Details
                          </summary>
                          <div className="mt-2 p-3 bg-surface-50 dark:bg-surface-800 rounded border border-[var(--color-border)] max-h-64 overflow-auto">
                            {log.new_value && (
                              <div className="mb-3">
                                <span className="text-accent-500 font-medium text-xs">New:</span>
                                <div className="mt-1">
                                  <JsonViewer data={log.new_value} />
                                </div>
                              </div>
                            )}
                            {log.old_value && (
                              <div>
                                <span className="text-amber-500 font-medium text-xs">Old:</span>
                                <div className="mt-1">
                                  <JsonViewer data={log.old_value} />
                                </div>
                              </div>
                            )}
                          </div>
                        </details>
                      ) : (
                        <span className="text-sm text-[var(--color-text-muted)]">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--color-text-muted)]">
              Page {data.pagination?.page || 1} of {data.pagination?.pages || 1} (
              {data.pagination?.total || 0} entries)
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary p-2 disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= (data.pagination?.pages || 1)}
                className="btn-secondary p-2 disabled:opacity-50"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--color-text)]">No audit logs</h3>
          <p className="text-[var(--color-text-muted)] mt-1">
            Audit logs will appear here as activities occur
          </p>
        </div>
      )}
    </div>
  );
}

