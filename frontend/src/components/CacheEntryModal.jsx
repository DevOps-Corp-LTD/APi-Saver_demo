import { X, Copy, Trash2 } from 'lucide-react';
import JsonViewer from './JsonViewer';

export default function CacheEntryModal({ entry, isAdmin, onClose, onInvalidate, onCopyUrl, onCopyCacheKey }) {
  if (!entry) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-4xl max-h-[90vh] overflow-auto animate-slide-up">
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between sticky top-0 bg-[var(--color-surface)] z-10">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">
            Cache Entry Details
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-100 dark:hover:bg-surface-700 rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Method</p>
              <p className="font-medium">{entry.request_method}</p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Status</p>
              <p className="font-medium">{entry.response_status}</p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Hit Count</p>
              <p className="font-medium">{entry.hit_count || 0}</p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">TTL</p>
              <p className="font-medium">{entry.ttl_seconds}s</p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Content Type</p>
              <p className="font-medium">{entry.content_type || 'N/A'}</p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Storage Mode</p>
              <p className="font-medium">
                {entry.storage_pool_id ? 'Shared' : 'Dedicated'}
              </p>
            </div>
          </div>

          {/* URL */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[var(--color-text-muted)] text-sm">URL</p>
              <button
                onClick={() => onCopyUrl(entry.request_url)}
                className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                title="Copy URL"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="font-mono text-sm break-all bg-surface-50 dark:bg-surface-800 p-2 rounded">
              {entry.request_url}
            </p>
          </div>

          {/* Cache Key */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[var(--color-text-muted)] text-sm">Cache Key</p>
              <button
                onClick={() => onCopyCacheKey(entry.cache_key)}
                className="p-1 hover:bg-surface-100 dark:hover:bg-surface-700 rounded"
                title="Copy Cache Key"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="font-mono text-xs break-all text-primary-500 bg-surface-50 dark:bg-surface-800 p-2 rounded">
              {entry.cache_key}
            </p>
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Created</p>
              <p className="font-medium">
                {new Date(entry.created_at).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-[var(--color-text-muted)] mb-1">Expires</p>
              <p className={`font-medium ${
                entry.expires_at && entry.ttl_seconds !== 0 && new Date(entry.expires_at) < new Date() ? 'text-amber-500' : ''
              }`}>
                {!entry.expires_at || entry.ttl_seconds === 0 ? 'Never' : new Date(entry.expires_at).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Response Headers */}
          {entry.response_headers && Object.keys(entry.response_headers).length > 0 && (
            <div>
              <p className="text-[var(--color-text-muted)] text-sm mb-2">Response Headers</p>
              <div className="bg-surface-50 dark:bg-surface-800 p-3 rounded max-h-40 overflow-auto border border-[var(--color-border)]">
                <JsonViewer data={entry.response_headers} />
              </div>
            </div>
          )}

          {/* Response Body */}
          <div>
            <p className="text-[var(--color-text-muted)] text-sm mb-2">Response Body</p>
            <div className="bg-surface-50 dark:bg-surface-800 p-3 rounded max-h-96 overflow-auto border border-[var(--color-border)]">
              {entry.response_body ? (
                <JsonViewer data={entry.response_body} className="whitespace-pre-wrap" />
              ) : entry.response_body_raw ? (
                <pre className="text-xs font-mono whitespace-pre-wrap text-[var(--color-text)]">
                  {entry.response_body_raw}
                </pre>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">No response body available</p>
              )}
            </div>
          </div>

          {/* Actions */}
          {isAdmin && (
            <div className="flex items-center gap-3 pt-4 border-t border-[var(--color-border)]">
              <button
                onClick={() => {
                  onInvalidate(entry.cache_key);
                  onClose();
                }}
                className="btn-danger flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>Invalidate Cache</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
