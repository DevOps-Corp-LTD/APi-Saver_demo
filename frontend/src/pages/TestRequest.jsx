import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { cacheApi } from '../lib/api';
import JsonViewer from '../components/JsonViewer';
import {
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Database,
  ArrowDown,
  Copy,
  Check,
  Info,
  AlertTriangle,
  FileText,
  Globe,
} from 'lucide-react';

export default function TestRequest() {
  const [formData, setFormData] = useState({
    method: 'GET',
    url: '',
    body: '',
    headers: '{}',
    force_refresh: false,
    ttl: '',
  });
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        method: data.method,
        url: data.url,
        force_refresh: data.force_refresh,
      };
      
      if (data.body) {
        try {
          payload.body = JSON.parse(data.body);
        } catch {
          payload.body = data.body;
        }
      }
      
      if (data.headers) {
        try {
          payload.headers = JSON.parse(data.headers);
        } catch {
          // ignore
        }
      }
      
      if (data.ttl) {
        payload.ttl = parseInt(data.ttl);
      }
      
      return cacheApi.fetch(payload);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.url) return;
    mutation.mutate(formData);
  };

  const copyResponse = () => {
    // Get the same result object that's used for display
    const result = mutation.data?.data?.data;
    
    if (!result) {
      alert('No response data to copy');
      return;
    }
    
    try {
      const lines = [];
      
      // Header
      lines.push('=== API RESPONSE ===');
      lines.push('');
      
      // Status Information
      lines.push('STATUS:');
      lines.push(`  Cache: ${result.cached ? 'HIT' : 'MISS'}`);
      lines.push(`  HTTP Status: ${result.response?.status || 'N/A'}`);
      if (result.meta?.source_name) {
        lines.push(`  Source: ${result.meta.source_name}`);
      }
      if (result.meta?.stale) {
        lines.push(`  Stale: Yes`);
      }
      if (result.meta?.kill_switch) {
        lines.push(`  Kill Switch: Enabled`);
      }
      if (result.meta?.is_mock) {
        lines.push(`  Mock Response: Yes`);
      }
      if (result.meta?.fallback) {
        lines.push(`  Fallback: Yes`);
      }
      lines.push('');
      
      // Request Details
      lines.push('REQUEST DETAILS:');
      lines.push(`  Method: ${formData.method}`);
      lines.push(`  URL: ${formData.url}`);
      lines.push('');
      
      // Cache Metadata
      lines.push('CACHE METADATA:');
      lines.push(`  Hits: ${result.meta?.hit_count || 0}`);
      lines.push(`  TTL: ${result.meta?.ttl_seconds !== null && result.meta?.ttl_seconds !== undefined ? `${result.meta.ttl_seconds}s` : 'Forever'}`);
      if (result.meta?.created_at) {
        lines.push(`  Created: ${new Date(result.meta.created_at).toLocaleString()}`);
      } else {
        lines.push(`  Created: N/A`);
      }
      if (result.meta?.expires_at && result.meta?.ttl_seconds !== 0) {
        lines.push(`  Expires: ${new Date(result.meta.expires_at).toLocaleString()}`);
      } else {
        lines.push(`  Expires: Never`);
      }
      if (result.meta?.last_hit_at) {
        lines.push(`  Last Hit: ${new Date(result.meta.last_hit_at).toLocaleString()}`);
      }
      if (result.meta?.source_id) {
        lines.push(`  Source ID: ${result.meta.source_id}`);
      }
      if (result.meta?.mock_id) {
        lines.push(`  Mock ID: ${result.meta.mock_id}`);
      }
      lines.push('');
      
      // Response Headers
      if (result.response?.headers && Object.keys(result.response.headers).length > 0) {
        lines.push('RESPONSE HEADERS:');
        Object.entries(result.response.headers).forEach(([key, value]) => {
          lines.push(`  ${key}: ${String(value)}`);
        });
        lines.push('');
      }
      
      // Content Type
      if (result.response?.content_type) {
        lines.push('CONTENT TYPE:');
        lines.push(`  ${result.response.content_type}`);
        lines.push('');
      }
      
      // Response Body
      lines.push('RESPONSE BODY:');
      const responseBody = result.response?.body;
      if (responseBody === null) {
        lines.push('  (null)');
      } else if (responseBody === undefined) {
        lines.push('  (undefined)');
      } else {
        let bodyText;
        if (typeof responseBody === 'string') {
          try {
            const parsed = JSON.parse(responseBody);
            bodyText = JSON.stringify(parsed, null, 2);
          } catch {
            bodyText = responseBody;
          }
        } else if (Array.isArray(responseBody) || typeof responseBody === 'object') {
          bodyText = JSON.stringify(responseBody, null, 2);
        } else {
          bodyText = String(responseBody);
        }
        // Indent the body content
        const indentedBody = bodyText.split('\n').map(line => `  ${line}`).join('\n');
        lines.push(indentedBody);
      }
      lines.push('');
      
      // Cache Key
      if (result.cache_key) {
        lines.push('CACHE KEY:');
        lines.push(`  ${result.cache_key}`);
      }
      
      const textToCopy = lines.join('\n');
      
      navigator.clipboard.writeText(textToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch((err) => {
        console.error('Failed to copy response:', err);
        alert('Failed to copy response to clipboard: ' + err.message);
      });
    } catch (err) {
      console.error('Failed to format response:', err);
      alert('Failed to copy response: ' + err.message);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-[var(--color-text)]">Test Request</h1>
        <p className="text-[var(--color-text-muted)] mt-1">
          Test the cache-or-fetch pipeline
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Request form */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Request
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2">
              <select
                value={formData.method}
                onChange={(e) => setFormData({ ...formData, method: e.target.value })}
                className="input w-32"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
              <input
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="input flex-1 font-mono"
                placeholder="https://api.example.com/endpoint"
                required
              />
            </div>

            <div>
              <label className="label">Request Body (JSON)</label>
              <textarea
                value={formData.body}
                onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                className="input font-mono h-32 resize-none"
                placeholder='{"key": "value"}'
              />
            </div>

            <div>
              <label className="label">Headers (JSON)</label>
              <textarea
                value={formData.headers}
                onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                className="input font-mono h-20 resize-none"
                placeholder='{"Content-Type": "application/json"}'
              />
            </div>

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="force_refresh"
                  checked={formData.force_refresh}
                  onChange={(e) =>
                    setFormData({ ...formData, force_refresh: e.target.checked })
                  }
                  className="w-4 h-4 rounded border-[var(--color-border)] text-primary-600 focus:ring-primary-500"
                />
                <label htmlFor="force_refresh" className="text-sm text-[var(--color-text)]">
                  Force refresh (bypass cache)
                </label>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-sm text-[var(--color-text)]">TTL:</label>
                <input
                  type="number"
                  value={formData.ttl}
                  onChange={(e) => setFormData({ ...formData, ttl: e.target.value })}
                  className="input w-24"
                  placeholder="3600"
                  min="1"
                />
                <span className="text-sm text-[var(--color-text-muted)]">sec</span>
              </div>
            </div>

            <button
              type="submit"
              disabled={mutation.isPending || !formData.url}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {mutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
              <span>Send Request</span>
            </button>
          </form>
        </div>

        {/* Response */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">Response</h2>
            {mutation.isSuccess && mutation.data?.data?.data?.response?.body !== null && mutation.data?.data?.data?.response?.body !== undefined && (
              <button
                onClick={copyResponse}
                className="btn-secondary flex items-center gap-2 text-sm py-1.5"
                title="Copy response body to clipboard"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-accent-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            )}
          </div>

          {mutation.isPending && (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
          )}

          {mutation.isError && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-2">
                <XCircle className="w-5 h-5" />
                <span className="font-medium">Error</span>
              </div>
              <p className="text-sm text-red-600 dark:text-red-400">
                {mutation.error?.response?.data?.message || mutation.error?.message}
              </p>
            </div>
          )}

          {mutation.isSuccess && (() => {
            // Extract result from nested structure: mutation.data (axios) -> .data (backend { data: result }) -> .data (result)
            const result = mutation.data?.data?.data;
            
            // Store result in a ref or make it accessible to copy function
            // For now, we'll access it directly in copyResponse
            
            return (
            <div className="space-y-4">
              {/* Status badges */}
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`badge ${
                    result?.cached ? 'badge-success' : 'badge-info'
                  }`}
                >
                  <Database className="w-3 h-3 mr-1" />
                  {result?.cached ? 'Cache HIT' : 'Cache MISS'}
                </span>
                <span
                  className={`badge ${
                    result?.response?.status >= 200 &&
                    result?.response?.status < 300
                      ? 'badge-success'
                      : result?.response?.status >= 400
                      ? 'badge-danger'
                      : 'badge-warning'
                  }`}
                >
                  HTTP {result?.response?.status}
                </span>
                {result?.meta?.source_name && (
                  <span className="badge badge-info">
                    <Globe className="w-3 h-3 mr-1" />
                    {result.meta.source_name}
                  </span>
                )}
                {result?.meta?.stale && (
                  <span className="badge badge-warning">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Stale
                  </span>
                )}
                {result?.meta?.kill_switch && (
                  <span className="badge badge-danger">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Kill Switch
                  </span>
                )}
                {result?.meta?.is_mock && (
                  <span className="badge badge-info">
                    <FileText className="w-3 h-3 mr-1" />
                    Mock Response
                  </span>
                )}
                {result?.meta?.fallback && (
                  <span className="badge badge-warning">
                    <AlertTriangle className="w-3 h-3 mr-1" />
                    Fallback
                  </span>
                )}
              </div>

              {/* Request Details */}
              <div className="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 border border-[var(--color-border)]">
                <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
                  Request Details
                </div>
                <div className="space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--color-text-muted)] w-16">Method:</span>
                    <code className="font-mono text-primary-500">{formData.method}</code>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[var(--color-text-muted)] w-16 flex-shrink-0">URL:</span>
                    <code className="font-mono text-xs text-primary-500 break-all">{formData.url}</code>
                  </div>
                </div>
              </div>

              {/* Cache Metadata */}
              <div className="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 border border-[var(--color-border)]">
                <div className="text-xs font-semibold text-[var(--color-text-muted)] mb-2 uppercase tracking-wide">
                  Cache Metadata
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-[var(--color-text-muted)]" />
                    <span className="text-[var(--color-text-muted)]">Hits:</span>
                    <span className="font-medium text-[var(--color-text)]">
                      {result?.meta?.hit_count || 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[var(--color-text-muted)]" />
                    <span className="text-[var(--color-text-muted)]">TTL:</span>
                    <span className="font-medium text-[var(--color-text)]">
                      {result?.meta?.ttl_seconds !== null && result?.meta?.ttl_seconds !== undefined
                        ? `${result.meta.ttl_seconds}s`
                        : 'Forever'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[var(--color-text-muted)]" />
                    <span className="text-[var(--color-text-muted)]">Created:</span>
                    <span className="font-medium text-[var(--color-text)] text-xs">
                      {result?.meta?.created_at
                        ? new Date(result.meta.created_at).toLocaleString()
                        : 'N/A'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-[var(--color-text-muted)]" />
                    <span className="text-[var(--color-text-muted)]">Expires:</span>
                    <span className="font-medium text-[var(--color-text)] text-xs">
                      {result?.meta?.expires_at && result?.meta?.ttl_seconds !== 0
                        ? new Date(result.meta.expires_at).toLocaleString()
                        : 'Never'}
                    </span>
                  </div>
                  {result?.meta?.last_hit_at && (
                    <div className="flex items-center gap-2 col-span-2">
                      <Clock className="w-4 h-4 text-[var(--color-text-muted)]" />
                      <span className="text-[var(--color-text-muted)]">Last Hit:</span>
                      <span className="font-medium text-[var(--color-text)] text-xs">
                        {new Date(result.meta.last_hit_at).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {result?.meta?.source_id && (
                    <div className="flex items-center gap-2 col-span-2">
                      <Info className="w-4 h-4 text-[var(--color-text-muted)]" />
                      <span className="text-[var(--color-text-muted)]">Source ID:</span>
                      <code className="font-mono text-xs text-primary-500">
                        {result.meta.source_id}
                      </code>
                    </div>
                  )}
                  {result?.meta?.mock_id && (
                    <div className="flex items-center gap-2 col-span-2">
                      <FileText className="w-4 h-4 text-[var(--color-text-muted)]" />
                      <span className="text-[var(--color-text-muted)]">Mock ID:</span>
                      <code className="font-mono text-xs text-primary-500">
                        {result.meta.mock_id}
                      </code>
                    </div>
                  )}
                </div>
              </div>

              {/* Response Headers */}
              <div>
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-2">
                  <FileText className="w-4 h-4" />
                  <span>Response Headers</span>
                </div>
                <div className="bg-surface-50 dark:bg-surface-800 rounded-lg p-3 border border-[var(--color-border)] max-h-48 overflow-auto">
                  {result?.response?.headers && Object.keys(result.response.headers).length > 0 ? (
                    <div className="space-y-1 text-xs font-mono">
                      {Object.entries(result.response.headers).map(([key, value]) => (
                        <div key={key} className="flex gap-2">
                          <span className="text-[var(--color-text-muted)] flex-shrink-0 font-semibold">{key}:</span>
                          <span className="text-[var(--color-text)] break-all">{String(value)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--color-text-muted)]">No response headers available</p>
                  )}
                </div>
              </div>

              {/* Content Type */}
              {result?.response?.content_type && (
                <div className="text-sm">
                  <span className="text-[var(--color-text-muted)]">Content Type: </span>
                  <code className="font-mono text-xs text-primary-500">
                    {result.response.content_type}
                  </code>
                </div>
              )}

              {/* Response body */}
              <div>
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] mb-2">
                  <ArrowDown className="w-4 h-4" />
                  <span>Response Body</span>
                  {process.env.NODE_ENV === 'development' && (
                    <span className="text-xs text-[var(--color-text-muted)] ml-auto">
                      Type: {typeof result?.response?.body}
                    </span>
                  )}
                </div>
                <div className="bg-surface-50 dark:bg-surface-800 rounded-lg p-4 overflow-auto max-h-96 border border-[var(--color-border)]">
                  {(() => {
                    const responseBody = result?.response?.body;
                    
                    // Debug: log to console in development
                    if (process.env.NODE_ENV === 'development') {
                      console.log('[Display] Response body:', responseBody);
                      console.log('[Display] Response body type:', typeof responseBody);
                      console.log('[Display] Is array?', Array.isArray(responseBody));
                      console.log('[Display] Object keys:', typeof responseBody === 'object' && responseBody !== null ? Object.keys(responseBody) : 'N/A');
                      console.log('[Display] Full response:', result?.response);
                    }
                    
                    // Check if body exists
                    if (responseBody === null) {
                      return <p className="text-xs text-[var(--color-text-muted)]">Response body is null</p>;
                    }
                    
                    if (responseBody === undefined) {
                      return <p className="text-xs text-[var(--color-text-muted)]">Response body is undefined</p>;
                    }
                    
                    // Handle empty string
                    if (typeof responseBody === 'string' && responseBody.trim() === '') {
                      return <p className="text-xs text-[var(--color-text-muted)]">Response body is empty</p>;
                    }
                    
                    // Handle empty array
                    if (Array.isArray(responseBody) && responseBody.length === 0) {
                      return <JsonViewer data={responseBody} />;
                    }
                    
                    // Render the body
                    return <JsonViewer data={responseBody} />;
                  })()}
                </div>
              </div>

              {/* Cache key */}
              <div className="text-sm">
                <span className="text-[var(--color-text-muted)]">Cache Key: </span>
                <code className="font-mono text-xs text-primary-500 break-all">
                  {result?.cache_key}
                </code>
              </div>
            </div>
            );
          })()}

          {!mutation.isPending && !mutation.isError && !mutation.isSuccess && (
            <div className="flex flex-col items-center justify-center h-64 text-[var(--color-text-muted)]">
              <Send className="w-12 h-12 mb-4 opacity-30" />
              <p>Send a request to see the response</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

