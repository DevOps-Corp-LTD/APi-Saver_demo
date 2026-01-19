import { query } from '../db/pool.js';
import { generateCacheKey, hashBody } from '../utils/cacheKey.js';
import { getSourceWithAuth, getActiveSourcesByPriority } from './sourceService.js';
import { getCircuitBreaker } from '../utils/circuitBreaker.js';
import { getConfigValue } from './configService.js';
import { validateDataUrl } from '../utils/urlValidation.js';
import { getCachePolicy } from './cachePolicyService.js';
import { addBrowserHeaders, detectChallengePage, extractChallengeError } from '../utils/httpHeaders.js';
import axios from 'axios';
import config from '../config/index.js';
import logger from '../utils/logger.js';

// Import from split modules
import { getCacheEntry, storeCacheEntry, listCacheEntries, bulkUpdateCacheEntries } from './cacheEntryService.js';
import { invalidateCacheEntry, purgeCache, purgeExpiredEntries, invalidateCacheByPrefix, invalidateCacheByKeyPrefix, assignTagsToCacheEntries, removeTagsFromCacheEntries, invalidateCacheByTags, purgePoolCache, fixCacheEntryStoragePools } from './cacheInvalidationService.js';
import { getCacheStats, calculateCacheEntrySize, getPoolStorageSize, getDedicatedPoolStats, getPoolCacheStats } from './cacheStatsService.js';

// Re-export from cacheEntryService
export { getCacheEntry, storeCacheEntry, listCacheEntries, bulkUpdateCacheEntries } from './cacheEntryService.js';

// Re-export from cacheInvalidationService
export { invalidateCacheEntry, purgeCache, purgeExpiredEntries, invalidateCacheByPrefix, invalidateCacheByKeyPrefix, assignTagsToCacheEntries, removeTagsFromCacheEntries, invalidateCacheByTags, purgePoolCache, fixCacheEntryStoragePools } from './cacheInvalidationService.js';

// Re-export from cacheStatsService
export { getCacheStats, calculateCacheEntrySize, getPoolStorageSize, getDedicatedPoolStats, getPoolCacheStats } from './cacheStatsService.js';

// Keep cacheOrFetch and listCacheEntriesByPool here as they're complex and depend on multiple services

/**
 * Fetch from source API with circuit breaker
 * @param {object} source - Source config
 * @param {string} method - HTTP method
 * @param {string} path - Request path
 * @param {object} body - Request body
 * @param {object} headers - Request headers
 * @returns {object} - Response data
 */
async function fetchFromSource(source, method, path, body, headers, retryWithBrowserHeaders = false) {
  const sourceHeaders = source.headers || {};
  
  // Add auth headers based on auth_type
  if (source.auth_type === 'bearer' && source.auth_config?.token) {
    sourceHeaders['Authorization'] = `Bearer ${source.auth_config.token}`;
  } else if (source.auth_type === 'api_key' && source.auth_config) {
    const { header_name, key } = source.auth_config;
    sourceHeaders[header_name || 'X-API-Key'] = key;
  }
  
  // Normalize base_url (remove trailing slash) and path (ensure leading slash)
  const normalizedBaseUrl = source.base_url.replace(/\/+$/, ''); // Remove trailing slashes
  const normalizedPath = path.startsWith('/') ? path : `/${path}`; // Ensure leading slash
  const url = `${normalizedBaseUrl}${normalizedPath}`;
  
  // Prepare headers - ensure Content-Type is set for POST/PUT/PATCH with body
  // Add browser-like headers if bypass_bot_detection is enabled OR if retrying after challenge detection
  let requestHeaders = { ...sourceHeaders, ...headers };
  if ((source.bypass_bot_detection || retryWithBrowserHeaders) && 
      !requestHeaders['User-Agent'] && !requestHeaders['user-agent']) {
    requestHeaders = addBrowserHeaders(requestHeaders);
  }
  
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    // Always set Content-Type to application/json if not already set
    // This ensures APIs that require JSON content type will work correctly
    if (!requestHeaders['Content-Type'] && !requestHeaders['content-type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }
  }
  
  try {
    const response = await axios({
      method,
      url,
      data: body,
      headers: requestHeaders,
      timeout: source.timeout_ms,
      validateStatus: () => true,
    });
    
    // Check for challenge pages from various providers
    const contentType = response.headers['content-type'] || '';
    const challenge = detectChallengePage(response.data, contentType, response.status);
    
    // If challenge detected and bypass_bot_detection is enabled, retry with browser headers
    if (challenge.isChallenge && source.bypass_bot_detection && !retryWithBrowserHeaders) {
      // Retry once with browser headers
      return await fetchFromSource(source, method, path, body, headers, true);
    }
    
    // If still a challenge after retry, throw error
    if (challenge.isChallenge) {
      const errorMsg = extractChallengeError(challenge, response.data, source.bypass_bot_detection);
      throw new Error(errorMsg);
    }
    
    return {
      status: response.status,
      headers: response.headers,
      data: response.data,
      contentType: response.headers['content-type'],
    };
  } catch (err) {
    // Handle axios errors (timeout, network errors, etc.)
    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      throw new Error(`Request to ${url} timed out after ${source.timeout_ms}ms`);
    }
    if (err.response) {
      // Check for challenge in error response
      const contentType = err.response.headers['content-type'] || '';
      const challenge = detectChallengePage(err.response.data, contentType, err.response.status);
      
      if (challenge.isChallenge && source.bypass_bot_detection && !retryWithBrowserHeaders) {
        // Retry with browser headers
        return await fetchFromSource(source, method, path, body, headers, true);
      }
      
      if (challenge.isChallenge) {
        const errorMsg = extractChallengeError(challenge, err.response.data, source.bypass_bot_detection);
        throw new Error(errorMsg);
      }
      
      // HTTP error response
      return {
        status: err.response.status,
        headers: err.response.headers,
        data: err.response.data,
        contentType: err.response.headers['content-type'],
      };
    }
    // Network or other errors
    throw err;
  }
}

/**
 * Main cache-or-fetch logic
 * @param {string} appId - App ID
 * @param {object} request - Request parameters
 * @returns {object} - Response with cache info
 */
export async function cacheOrFetch(appId, request) {
  const { method, url, body = null, headers = {}, force_refresh = false, ttl = null } = request;
  
  // Validate URL to prevent SSRF attacks
  try {
    validateDataUrl(url);
  } catch (err) {
    throw new Error(`Invalid or blocked URL: ${err.message}`);
  }
  
  // Check app-level kill switch
  const killSwitchEnabled = await getConfigValue(appId, 'kill_switch_enabled');
  let bypassCache = killSwitchEnabled === 'true' || killSwitchEnabled === true;
  
  // Get active sources first
  const sources = await getActiveSourcesByPriority(appId);
  if (sources.length === 0) {
    throw new Error('No active sources configured');
  }
  
  // Parse URL to extract domain for source matching
  let parsedUrl;
  let requestDomain = null;
  try {
    parsedUrl = new URL(url);
    requestDomain = parsedUrl.hostname.toLowerCase();
  } catch {
    // Invalid URL, will use first source
  }
  
  // Try to find a source that matches the request domain first
  // This ensures requests go to the correct source's pool
  let matchedSourceRow = null;
  if (requestDomain) {
    for (const sourceRow of sources) {
      try {
        const sourceUrl = new URL(sourceRow.base_url);
        const sourceDomain = sourceUrl.hostname.toLowerCase();
        if (sourceDomain === requestDomain) {
          matchedSourceRow = sourceRow;
          break;
        }
      } catch {
        // Invalid base_url, skip
        continue;
      }
    }
  }
  
  // Use matched source if found, otherwise use first source
  const primarySourceRow = matchedSourceRow || sources[0];
  const primarySource = await getSourceWithAuth(primarySourceRow.id);
  if (!primarySource) {
    throw new Error('Source not found or inaccessible');
  }
  
  // Check source-level kill switch (overrides app-level)
  if (primarySource.kill_switch_enabled) {
    bypassCache = true;
  }
  
  const storageMode = primarySource.storage_mode || 'dedicated';
  const storagePoolId = primarySource.storage_pool_id || null;
  
  // Generate cache key (include sourceId for dedicated mode, use source vary headers)
  const varyHeaders = primarySource.vary_headers || null;
  const cacheKey = generateCacheKey(
    method, 
    url, 
    body, 
    headers,
    storageMode === 'dedicated' ? primarySource.id : null,
    varyHeaders
  );
  const bodyHash = hashBody(body);
  
  // Check cache first (unless force refresh or kill switch enabled)
  if (!force_refresh && !bypassCache) {
    const cached = await getCacheEntry(
      appId, 
      cacheKey, 
      storageMode === 'dedicated' ? primarySource.id : null,
      storageMode,
      storagePoolId
    );
    if (cached) {
      // Check if entry is stale and needs revalidation (stale-while-revalidate)
      const isStale = cached.expires_at && new Date(cached.expires_at) < new Date();
      const needsRevalidation = isStale && (!cached.revalidate_at || new Date(cached.revalidate_at) < new Date(Date.now() - 3600000)); // 1 hour threshold
      
      // Trigger background revalidation if stale
      if (needsRevalidation) {
        // Don't await - let it run in background
        const { revalidateCacheEntry } = await import('./revalidationService.js');
        revalidateCacheEntry(appId, cacheKey).catch(err => {
          logger.error({ cacheKey, err: err.message }, '[cacheOrFetch] Background revalidation failed');
        });
      }
      
      // Get source name if available
      let sourceName = null;
      if (cached.source_id) {
        try {
          const sourceResult = await query('SELECT name FROM app_sources WHERE id = $1', [cached.source_id]);
          sourceName = sourceResult.rows[0]?.name || null;
        } catch (err) {
          // Ignore error, source_name will be null
        }
      }
      
      return {
        cached: true,
        cache_key: cacheKey,
        response: {
          status: cached.response_status,
          headers: cached.response_headers,
          body: cached.response_body || cached.response_body_raw,
          content_type: cached.content_type,
        },
        meta: {
          source_id: cached.source_id,
          source_name: sourceName,
          hit_count: cached.hit_count,
          expires_at: cached.expires_at,
          created_at: cached.created_at,
          last_hit_at: cached.last_hit_at,
          stale: isStale,
          ttl_seconds: cached.ttl_seconds,
        },
      };
    }
  }
  
  // Get TTL from request, config, or default (0 = forever)
  let cacheTtl = ttl !== null 
    ? ttl 
    : parseInt(await getConfigValue(appId, 'cache_ttl') || config.defaultCacheTtl, 10);
  
  // Parse URL to extract path (parsedUrl already set above)
  let path;
  try {
    if (!parsedUrl) {
      parsedUrl = new URL(url);
    }
    path = parsedUrl.pathname + parsedUrl.search;
  } catch {
    path = url;
  }
  
  // Reorder sources: matched source first (if found), then others by priority
  const reorderedSources = [];
  if (matchedSourceRow) {
    reorderedSources.push(matchedSourceRow);
    for (const sourceRow of sources) {
      if (sourceRow.id !== matchedSourceRow.id) {
        reorderedSources.push(sourceRow);
      }
    }
  } else {
    // No match found, use original priority order
    reorderedSources.push(...sources);
  }
  
  // Try sources in reordered priority (matched source first)
  let lastError = null;
  
  for (let i = 0; i < reorderedSources.length; i++) {
    const sourceRow = reorderedSources[i];
    const source = await getSourceWithAuth(sourceRow.id);
    const isLastSource = i === reorderedSources.length - 1;
    
    // Check fallback mode - if mock mode, try to get mock response first
    if (source.fallback_mode === 'mock') {
      try {
        const { getMockResponse } = await import('./mockService.js');
        const mockResponse = await getMockResponse(appId, source.id, method, url, body);
        if (mockResponse) {
          return {
            cached: false,
            cache_key: cacheKey,
            response: {
              status: mockResponse.status,
              headers: mockResponse.headers,
              body: mockResponse.body,
              content_type: mockResponse.headers['content-type'] || 'application/json',
            },
            meta: {
              source_id: source.id,
              source_name: source.name,
              hit_count: 0,
              expires_at: null,
              created_at: new Date(),
              is_mock: true,
              mock_id: mockResponse.mock_id,
            },
          };
        }
      } catch (err) {
        logger.warn({ err: err.message }, '[cacheOrFetch] Failed to get mock response');
        // Continue to try real source
      }
    }
    
    // Create fetch function for circuit breaker
    const fetchFn = async () => fetchFromSource(source, method, path, body, headers);
    
    // Get or create circuit breaker for this source
    const breaker = getCircuitBreaker(source.id, fetchFn, {
      timeout: source.timeout_ms,
      volumeThreshold: source.circuit_breaker_threshold,
    });
    
    try {
      const response = await breaker.fire();
      
      // Log attempt for debugging
      logger.debug({ source: source.name, index: i + 1, total: sources.length, status: response.status, url: `${source.base_url}${path}` }, '[cacheOrFetch] Source response');
      
      // If we get a 404 error, try next source for failover (if not the last source)
      // This allows failover when a source doesn't have the requested resource
      // Other 4xx errors (401, 403, etc.) are returned immediately as they indicate
      // authentication/authorization issues, not missing resources
      if (response.status === 404 && !isLastSource) {
        logger.warn({ source: source.name, url: `${source.base_url}${path}`, remaining: sources.length - i - 1 }, '[cacheOrFetch] Source returned 404, trying next source for failover');
        lastError = new Error(`Source ${source.name} returned 404: Not Found`);
        continue;
      }
      
      // If last source also returns 404, log it
      if (response.status === 404 && isLastSource) {
        logger.warn({ source: source.name, url: `${source.base_url}${path}` }, '[cacheOrFetch] Last source returned 404 - no more sources to try');
      }
      
      // Check compliance before caching
      let complianceCheck = { allowed: true };
      try {
        const { checkCompliance } = await import('./complianceService.js');
        complianceCheck = await checkCompliance(appId, source.id, { method, url, body, headers, region: headers['x-region'] }, {
          status: response.status,
          headers: response.headers,
          body: response.data,
        });
        
        if (!complianceCheck.allowed) {
          logger.warn({ reason: complianceCheck.reason }, '[cacheOrFetch] Compliance check failed');
          // Return response but don't cache
          // Use cacheKey here since entryCacheKey hasn't been calculated yet
          return {
            cached: false,
            cache_key: cacheKey,
            response: {
              status: response.status,
              headers: response.headers,
              body: response.data,
              content_type: response.contentType,
            },
            meta: {
              source_id: source.id,
              source_name: source.name,
              hit_count: 0,
              expires_at: null,
              created_at: new Date(),
              compliance_blocked: true,
              compliance_reason: complianceCheck.reason,
            },
          };
        }
      } catch (err) {
        logger.warn({ err: err.message }, '[cacheOrFetch] Error checking compliance');
        // Continue without compliance check - use default behavior
      }
      
      // Apply cache policy limits if policy exists
      let cachePolicy = null;
      try {
        cachePolicy = await getCachePolicy(appId, source.id);
      } catch (err) {
        logger.warn({ sourceId: source.id, err: err.message }, '[cacheOrFetch] Error fetching cache policy');
        // Continue without policy - use default behavior
      }
      
      if (cachePolicy) {
        // If policy says no_cache, don't store but still return response
        if (cachePolicy.no_cache) {
          return {
            cached: false,
            cache_key: cacheKey,
            response: {
              status: response.status,
              headers: response.headers,
              body: response.data,
              content_type: response.contentType,
            },
            meta: {
              source_id: source.id,
              source_name: source.name,
              hit_count: 0,
              expires_at: null,
              created_at: new Date(),
            },
          };
        }
        
        // Apply max_ttl_seconds limit if policy has one
        if (cachePolicy.max_ttl_seconds !== null) {
          // If cacheTtl is 0 (forever) or exceeds policy limit, use policy limit
          if (cacheTtl === 0 || cacheTtl > cachePolicy.max_ttl_seconds) {
            cacheTtl = cachePolicy.max_ttl_seconds;
          }
        }
      }
      
      // Get source storage mode and pool ID
      const sourceStorageMode = source.storage_mode || 'dedicated';
      const sourceStoragePoolId = source.storage_pool_id || null;
      
      // For shared mode: use the same cache key and pool_id from the source that handled the request
      // For dedicated mode: each source has its own cache key and no pool_id
      const sourceVaryHeaders = source.vary_headers || null;
      const entryCacheKey = sourceStorageMode === 'shared' 
        ? cacheKey  // Use the same key for all sources in shared mode
        : generateCacheKey(
            method,
            url,
            body,
            headers,
            source.id,  // Include source_id for dedicated mode
            sourceVaryHeaders  // Use source-specific vary headers
          );
      
      // IMPORTANT: Use the pool_id from the source that actually handled the request,
      // not from the first source. This ensures cache entries are stored in the correct pool.
      // For dedicated mode, pool_id may be set for management/organization, but cache is still isolated per source
      const entryPoolId = sourceStoragePoolId;  // Use pool_id if available (for both shared and dedicated)
      
      // Log which source handled the request for debugging
      logger.debug({ method, url, source: source.name, sourceId: source.id, storageMode: sourceStorageMode, poolId: entryPoolId }, '[cacheOrFetch] Request handled by source');
      
      // Store in cache (unless kill switch is enabled)
      if (bypassCache) {
        // Kill switch enabled - return response without caching
        return {
          cached: false,
          cache_key: entryCacheKey,
          response: {
            status: response.status,
            headers: response.headers,
            body: response.data,
            content_type: response.contentType,
          },
          meta: {
            source_id: source.id,
            source_name: source.name,
            hit_count: 0,
            expires_at: null,
            created_at: new Date(),
            last_hit_at: null,
            ttl_seconds: cacheTtl,
            kill_switch: true,
          },
        };
      }
      
      const isJson = response.contentType?.includes('application/json');
      
      const entry = await storeCacheEntry({
        app_id: appId,
        source_id: source.id,
        cache_key: entryCacheKey,
        request_method: method.toUpperCase(),
        request_url: url,
        request_body_hash: bodyHash,
        response_status: response.status,
        response_headers: response.headers,
        response_body: isJson ? response.data : null,
        response_body_raw: isJson ? null : (typeof response.data === 'string' ? response.data : JSON.stringify(response.data)),
        content_type: response.contentType,
        ttl_seconds: cacheTtl,
        storage_pool_id: entryPoolId,
      });
      
      return {
        cached: false,
        cache_key: entryCacheKey,
        response: {
          status: response.status,
          headers: response.headers,
          body: response.data,
          content_type: response.contentType,
        },
        meta: {
          source_id: source.id,
          source_name: source.name,
          hit_count: 0,
          expires_at: entry.expires_at,
          created_at: entry.created_at,
          last_hit_at: entry.last_hit_at,
          ttl_seconds: entry.ttl_seconds,
        },
      };
    } catch (err) {
      lastError = err;
      logger.warn({ source: source.name, err: err.message, code: err.code, stack: err.stack?.substring(0, 200) }, 'Source failed');
      
      // If fallback mode is mock and this is the last source, try mock
      if (isLastSource && source.fallback_mode === 'mock') {
        try {
          const { getMockResponse } = await import('./mockService.js');
          const mockResponse = await getMockResponse(appId, source.id, method, url, body);
          if (mockResponse) {
            return {
              cached: false,
              cache_key: cacheKey,
              response: {
                status: mockResponse.status,
                headers: mockResponse.headers,
                body: mockResponse.body,
                content_type: mockResponse.headers['content-type'] || 'application/json',
              },
              meta: {
                source_id: source.id,
                source_name: source.name,
                hit_count: 0,
                expires_at: null,
                created_at: new Date(),
                is_mock: true,
                mock_id: mockResponse.mock_id,
                fallback: true,
              },
            };
          }
        } catch (mockErr) {
          logger.warn({ err: mockErr.message }, '[cacheOrFetch] Mock fallback also failed');
        }
      }
      
      // Continue to next source
    }
  }
  
  // All sources failed
  throw lastError || new Error('All sources failed');
}

/**
 * List cache entries by pool
 * @param {string} appId - App ID
 * @param {string} poolId - Storage pool ID
 * @param {object} options - Pagination and filter options
 * @returns {object} - Paginated results
 */
export async function listCacheEntriesByPool(appId, poolId, options = {}) {
  try {
    const { page = 1, limit = 20, expired = false, source_id = null } = options;
    const offset = (page - 1) * limit;
    
    // IMPORTANT: Join with app_sources to ensure cache entries only show if their source
    // is currently assigned to this pool. This prevents showing entries from sources
    // that were previously assigned but have since been unassigned.
    // The JOIN condition ensures: ce.source_id matches src.id AND src is assigned to this pool
    let whereClause = 'WHERE ce.app_id = $1 AND ce.storage_pool_id = $2';
    const params = [appId, poolId];
    let paramIndex = 3;
    
    if (!expired) {
      whereClause += ' AND (ce.expires_at > NOW() OR ce.expires_at IS NULL)';
    }
    
    if (source_id) {
      whereClause += ` AND ce.source_id = $${paramIndex}`;
      params.push(source_id);
      paramIndex++;
    }
    
    // Get total count - must join with app_sources to filter correctly
    const countResult = await query(
      `SELECT COUNT(*) as count 
       FROM cache_entries ce
       INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || 0, 10);
    
    // Get entries with source info - use INNER JOIN to ensure source is assigned to pool
    const limitParamIndex = paramIndex;
    const offsetParamIndex = paramIndex + 1;
    params.push(limit, offset);
    const result = await query(
      `SELECT ce.id, ce.app_id, ce.source_id, ce.cache_key, ce.request_method, ce.request_url,
              ce.response_status, ce.content_type, ce.ttl_seconds, ce.expires_at, ce.hit_count,
              ce.last_hit_at, ce.created_at, ce.updated_at, ce.storage_pool_id,
              src.name as source_name
       FROM cache_entries ce
       INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
       ${whereClause}
       ORDER BY ce.created_at DESC
       LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}`,
      params
    );
    
    return {
      entries: result.rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    logger.error({ err: error }, 'Error in listCacheEntriesByPool');
    throw error;
  }
}


export default {
  getCacheEntry,
  storeCacheEntry,
  invalidateCacheEntry,
  purgeCache,
  purgeExpiredEntries,
  invalidateCacheByPrefix,
  invalidateCacheByKeyPrefix,
  assignTagsToCacheEntries,
  removeTagsFromCacheEntries,
  invalidateCacheByTags,
  getCacheStats,
  listCacheEntries,
  cacheOrFetch,
  listCacheEntriesByPool,
  purgePoolCache,
  getPoolCacheStats,
  calculateCacheEntrySize,
  getPoolStorageSize,
  getDedicatedPoolStats,
  fixCacheEntryStoragePools,
};

