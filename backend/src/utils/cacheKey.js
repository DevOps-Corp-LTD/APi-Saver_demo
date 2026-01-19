import crypto from 'crypto';

/**
 * Generate a deterministic cache key from request parameters
 * @param {string} method - HTTP method
 * @param {string} url - Full URL
 * @param {object|string|null} body - Request body
 * @param {object} headers - Significant headers to include in key
 * @param {string} sourceId - Optional source ID for dedicated storage mode
 * @param {array} varyHeaders - Optional array of header names to include in cache key (from source config)
 * @returns {string} - SHA-256 hash as cache key
 */
export function generateCacheKey(method, url, body = null, headers = {}, sourceId = null, varyHeaders = null) {
  const normalized = {
    method: method.toUpperCase(),
    url: normalizeUrl(url),
    body: normalizeBody(body),
    headers: normalizeHeaders(headers, varyHeaders)
  };
  
  // Include sourceId in key for dedicated storage mode
  if (sourceId) {
    normalized.sourceId = sourceId;
  }
  
  const keyString = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(keyString).digest('hex');
}

/**
 * Generate a hash of the request body
 * @param {object|string|null} body - Request body
 * @returns {string|null} - SHA-256 hash or null if no body
 */
export function hashBody(body) {
  if (!body) return null;
  const normalized = normalizeBody(body);
  if (!normalized) return null;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Normalize URL for consistent caching
 * - Sorts query parameters
 * - Normalizes trailing slashes (removes trailing slash from path, except for root)
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    
    // Normalize pathname: remove trailing slashes except for root path
    // This ensures https://example.com/ and https://example.com generate the same cache key
    let normalizedPath = parsed.pathname;
    if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
      normalizedPath = normalizedPath.slice(0, -1);
    }
    parsed.pathname = normalizedPath;
    
    // Sort query params for consistency
    const params = new URLSearchParams(parsed.search);
    const sortedParams = new URLSearchParams([...params.entries()].sort());
    parsed.search = sortedParams.toString();
    
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Normalize body for consistent hashing
 */
function normalizeBody(body) {
  if (!body) return null;
  if (typeof body === 'string') {
    try {
      // Try to parse and re-stringify for consistent JSON formatting
      return JSON.stringify(JSON.parse(body));
    } catch {
      return body;
    }
  }
  return JSON.stringify(body);
}

/**
 * Normalize headers - only include significant headers
 * @param {object} headers - Request headers
 * @param {array|null} varyHeaders - Optional array of header names to include (from source config)
 * @returns {object|null} - Normalized headers object or null
 */
function normalizeHeaders(headers, varyHeaders = null) {
  // Use provided vary headers or default significant headers
  const significant = varyHeaders && Array.isArray(varyHeaders) && varyHeaders.length > 0
    ? varyHeaders.map(h => h.toLowerCase())
    : ['accept', 'content-type', 'x-api-version'];
  
  const normalized = {};
  
  for (const key of significant) {
    const value = headers[key] || headers[key.toLowerCase()];
    if (value) {
      normalized[key.toLowerCase()] = value;
    }
  }
  
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export default { generateCacheKey, hashBody };

