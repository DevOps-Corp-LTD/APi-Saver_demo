import { query } from '../db/pool.js';
import { getSourceWithAuth } from '../services/sourceService.js';
import { generateCacheKey, hashBody } from '../utils/cacheKey.js';
import { getCacheEntry, storeCacheEntry } from '../services/cacheService.js';
import { getConfigValue } from '../services/configService.js';
import { getCachePolicy } from '../services/cachePolicyService.js';
import { getCircuitBreaker } from '../utils/circuitBreaker.js';
import { logAudit } from '../services/auditService.js';
import { validateUrl } from '../utils/urlValidation.js';
import { addBrowserHeaders, detectChallengePage, extractChallengeError } from '../utils/httpHeaders.js';
import config from '../config/index.js';
import axios from 'axios';
import { handleNotFoundError, handleValidationError, createErrorResponse } from '../utils/errorHandler.js';

// Round-robin counter map: key = `${appId}:${sourceName}`, value = current index
const roundRobinCounters = new Map();

/**
 * Transparent proxy routes - allows clients to use APi-Saver as a drop-in replacement
 * for their external APIs with automatic caching.
 * 
 * Usage: /proxy/:sourceName/any/path/here
 * Example: /proxy/JSONPlaceholder/posts/1
 * 
 * Supports multiple sources with the same canonical name:
 * - Sources named "JSONPlaceholder - Primary", "JSONPlaceholder - Backup" can be accessed via /proxy/JSONPlaceholder/*
 * - Uses priority-based failover or round-robin based on SOURCE_SELECTION_MODE config
 */
export default async function proxyRoutes(fastify) {
  // Handle all HTTP methods for proxy
  fastify.all('/proxy/:sourceName/*', {
    preHandler: [fastify.authenticateApiKey],
  }, async (request, reply) => {
    // Decode URL-encoded source name
    const sourceName = decodeURIComponent(request.params.sourceName);
    const path = '/' + (request.params['*'] || '');
    const method = request.method;
    
    // Get all sources matching the canonical name (for priority-based failover or round-robin)
    // Match sources where name starts with the canonical name (e.g., "JSONPlaceholder" matches "JSONPlaceholder - Primary")
    // First try exact match, then try prefix match
    const sourceResult = await query(
      `SELECT * FROM app_sources 
       WHERE app_id = $1 
       AND is_active = true
       AND (
         LOWER(name) = LOWER($2) 
         OR LOWER(name) LIKE LOWER($2 || ' - %')
         OR LOWER(name) LIKE LOWER($2 || ' %')
       )
       ORDER BY priority ASC`,
      [request.appId, sourceName]
    );
    
    if (!sourceResult.rows || sourceResult.rows.length === 0) {
      const { statusCode, response } = handleNotFoundError(`Source "${sourceName}"`);
      return reply.status(statusCode).send(response);
    }
    
    const sourceRows = sourceResult.rows;
    
    // Get source selection mode (priority or round-robin)
    const selectionMode = config.sourceSelectionMode || 'priority';
    
    let selectedSources;
    
    if (selectionMode === 'round-robin') {
      // Round-robin: select one source in rotation
      const roundRobinKey = `${request.appId}:${sourceName}`;
      const currentIndex = roundRobinCounters.get(roundRobinKey) || 0;
      const selectedIndex = currentIndex % sourceRows.length;
      selectedSources = [sourceRows[selectedIndex]];
      
      fastify.log.debug({ 
        sourceName, 
        selectedIndex, 
        totalSources: sourceRows.length,
        selectedSource: sourceRows[selectedIndex].name 
      }, 'Round-robin source selection');
    } else {
      // Priority mode: try sources in priority order (failover)
      selectedSources = sourceRows;
      fastify.log.debug({ 
        sourceName, 
        totalSources: sourceRows.length,
        sources: sourceRows.map(s => ({ name: s.name, priority: s.priority }))
      }, 'Priority-based source selection');
    }
    
    // Try sources (single source for round-robin, multiple for priority failover)
    let lastError = null;
    
    for (let i = 0; i < selectedSources.length; i++) {
      const sourceRow = selectedSources[i];
      const isLastSource = i === selectedSources.length - 1;
      
      try {
        const source = await getSourceWithAuth(sourceRow.id);
        
        // Get storage mode and pool ID for cache lookup (required for proper cache isolation)
        const storageMode = source.storage_mode || 'dedicated';
        const storagePoolId = source.storage_pool_id || null;
        
        // Normalize base_url (remove trailing slash) and path (ensure leading slash)
        const normalizedBaseUrl = source.base_url.replace(/\/+$/, ''); // Remove trailing slashes
        const normalizedPath = path.startsWith('/') ? path : `/${path}`; // Ensure leading slash
        
        // Build full URL
        const fullUrl = `${normalizedBaseUrl}${normalizedPath}`;
        
        // Get query string
        const queryString = request.url.includes('?') 
          ? request.url.substring(request.url.indexOf('?'))
          : '';
        const urlWithQuery = fullUrl + queryString;
        
        // Validate URL to prevent SSRF attacks
        try {
          validateUrl(urlWithQuery, source.base_url);
        } catch (err) {
          fastify.log.warn({ url: urlWithQuery, source: source.name, error: err.message }, 'SSRF attempt blocked');
          const { statusCode, response } = handleValidationError('Invalid or blocked URL');
          return reply.status(statusCode).send(response);
        }
        
        // Get request body
        const body = request.body;
        
        // Get headers to forward (exclude internal headers)
        const forwardHeaders = {};
        const excludeHeaders = ['host', 'x-api-key', 'authorization', 'content-length', 'connection'];
        for (const [key, value] of Object.entries(request.headers)) {
          if (!excludeHeaders.includes(key.toLowerCase())) {
            forwardHeaders[key] = value;
          }
        }
        
        // Check for force refresh header
        const forceRefresh = request.headers['x-cache-refresh'] === 'true';
        
        // Check for custom TTL header
        const customTtl = request.headers['x-cache-ttl'] 
          ? parseInt(request.headers['x-cache-ttl'], 10) 
          : null;
        
        // Generate cache key (include sourceId for dedicated mode, use source vary headers)
        const varyHeaders = source.vary_headers || null;
        const cacheKey = generateCacheKey(
          method, 
          urlWithQuery, 
          body, 
          forwardHeaders,
          storageMode === 'dedicated' ? source.id : null,
          varyHeaders
        );
        const bodyHash = hashBody(body);
        
        // Check cache policy FIRST to see if caching is disabled for this source
        // This ensures no_cache policy is respected even if entries exist in cache
        let cachePolicy = null;
        let policyNoCache = false;
        try {
          cachePolicy = await getCachePolicy(request.appId, source.id);
          // Verify the policy is for this specific source (safety check)
          if (cachePolicy && cachePolicy.source_id !== source.id) {
            fastify.log.warn({ 
              policySourceId: cachePolicy.source_id, 
              currentSourceId: source.id 
            }, 'Cache policy source_id mismatch, ignoring policy');
            cachePolicy = null;
          } else if (cachePolicy && cachePolicy.no_cache) {
            policyNoCache = true;
          }
        } catch (err) {
          fastify.log.warn({ err, source: source.id }, 'Error fetching cache policy');
          // Continue without policy - use default behavior
        }
        
        // Check cache first (unless force refresh, non-cacheable method, or no_cache policy)
        // Cache GET, HEAD, OPTIONS by default, and POST/PUT/PATCH if explicitly requested
        // Note: POST requests are cached by default to support APIs like Google Translate
        const cacheableMethods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH'];
        const isCacheable = cacheableMethods.includes(method.toUpperCase());
        
        if (!forceRefresh && isCacheable && !policyNoCache) {
          // Pass sourceId, storageMode, and storagePoolId for proper cache isolation
          const cached = await getCacheEntry(
            request.appId, 
            cacheKey, 
            storageMode === 'dedicated' ? source.id : null,
            storageMode,
            storagePoolId
          );
          if (cached) {
            // Set cache headers
            reply.header('X-Cache', 'HIT');
            reply.header('X-Cache-Key', cacheKey);
            reply.header('X-Cache-Hits', cached.hit_count + 1);
            reply.header('X-Cache-Expires', cached.expires_at);
            reply.header('X-Source', source.name);
            
            // Set original response headers
            if (cached.response_headers) {
              const safeHeaders = ['content-type', 'cache-control', 'etag', 'last-modified'];
              for (const [key, value] of Object.entries(cached.response_headers)) {
                if (safeHeaders.includes(key.toLowerCase())) {
                  reply.header(key, value);
                }
              }
            }
            
            reply.status(cached.response_status);
            
            // Increment round-robin counter for successful cache hit in round-robin mode
            if (selectionMode === 'round-robin') {
              const roundRobinKey = `${request.appId}:${sourceName}`;
              const currentIndex = roundRobinCounters.get(roundRobinKey) || 0;
              roundRobinCounters.set(roundRobinKey, currentIndex + 1);
            }
            
            return cached.response_body || cached.response_body_raw;
          }
        }
        
        // Prepare source headers (auth)
        let sourceHeaders = { ...forwardHeaders };
        if (source.headers) {
          Object.assign(sourceHeaders, source.headers);
        }
        
        // Add auth headers based on auth_type
        if (source.auth_type === 'bearer' && source.auth_config?.token) {
          sourceHeaders['Authorization'] = `Bearer ${source.auth_config.token}`;
        } else if (source.auth_type === 'api_key' && source.auth_config) {
          const { header_name, key } = source.auth_config;
          sourceHeaders[header_name || 'X-API-Key'] = key;
        } else if (source.auth_type === 'basic' && source.auth_config) {
          const { username, password } = source.auth_config;
          const encoded = Buffer.from(`${username}:${password}`).toString('base64');
          sourceHeaders['Authorization'] = `Basic ${encoded}`;
        }
        
        // Create fetch function for circuit breaker with auto-retry on challenge detection
        const fetchFn = async () => {
          // Internal retry function
          const makeRequest = async (retryWithBrowserHeaders = false) => {
            // Add browser headers if bypass_bot_detection is enabled OR if retrying
            let requestHeaders = { ...sourceHeaders };
            if ((source.bypass_bot_detection || retryWithBrowserHeaders) && 
                !requestHeaders['User-Agent'] && !requestHeaders['user-agent']) {
              requestHeaders = addBrowserHeaders(requestHeaders);
            }
            
            const response = await axios({
              method,
              url: urlWithQuery,
              data: body,
              headers: requestHeaders,
              timeout: source.timeout_ms || 30000,
              validateStatus: () => true, // Accept all status codes
              responseType: 'text', // Get raw response
              transformResponse: [(data) => data], // Don't transform
            });
            
            // Check for challenge pages from various providers
            const contentType = response.headers['content-type'] || '';
            const challenge = detectChallengePage(response.data, contentType, response.status);
            
            // If challenge detected and bypass_bot_detection is enabled, retry with browser headers
            if (challenge.isChallenge && source.bypass_bot_detection && !retryWithBrowserHeaders) {
              // Retry once with browser headers
              return await makeRequest(true);
            }
            
            // If still a challenge after retry, throw error
            if (challenge.isChallenge) {
              const errorMsg = extractChallengeError(challenge, response.data, source.bypass_bot_detection);
              throw new Error(errorMsg);
            }
            
            // Try to parse as JSON
            let parsedBody = response.data;
            let isJson = false;
            
            if (contentType.includes('application/json')) {
              try {
                parsedBody = JSON.parse(response.data);
                isJson = true;
              } catch {
                // Keep as string
              }
            }
            
            return {
              status: response.status,
              headers: response.headers,
              body: parsedBody,
              rawBody: response.data,
              isJson,
              contentType,
            };
          };
          
          return await makeRequest();
        };
        
        // Get circuit breaker
        const breaker = getCircuitBreaker(source.id, fetchFn, {
          timeout: source.timeout_ms,
          volumeThreshold: source.circuit_breaker_threshold,
        });
        
        try {
          const response = await breaker.fire();
          
          // If we get a 404 error and not the last source, try next source for failover
          if (response.status === 404 && !isLastSource && selectionMode === 'priority') {
            fastify.log.warn({ 
              source: source.name, 
              url: urlWithQuery, 
              remainingSources: selectedSources.length - i - 1 
            }, 'Source returned 404, trying next source for failover');
            lastError = new Error(`Source ${source.name} returned 404: Not Found`);
            continue;
          }
          
          // Get TTL from custom header, config, or default (0 = forever)
          let cacheTtl = customTtl !== null 
            ? customTtl 
            : parseInt(await getConfigValue(request.appId, 'cache_ttl') || config.defaultCacheTtl, 10);
          
          // Use the cache policy we already fetched (or fetch it if we didn't check earlier)
          if (!cachePolicy) {
            try {
              cachePolicy = await getCachePolicy(request.appId, source.id);
              // Verify the policy is for this specific source (safety check)
              if (cachePolicy && cachePolicy.source_id !== source.id) {
                fastify.log.warn({ 
                  policySourceId: cachePolicy.source_id, 
                  currentSourceId: source.id 
                }, 'Cache policy source_id mismatch, ignoring policy');
                cachePolicy = null;
              }
            } catch (err) {
              fastify.log.warn({ err, source: source.id }, 'Error fetching cache policy');
              // Continue without policy - use default behavior
            }
          }
          
          if (cachePolicy) {
            // If policy says no_cache, don't store but still return response
            // This only affects THIS source, other sources in failover will still be tried
            if (cachePolicy.no_cache) {
              reply.header('X-Cache', 'MISS');
              reply.header('X-Cache-Policy', 'no-cache');
              reply.header('X-Cache-Key', cacheKey);
              reply.header('X-Source', source.name);
              
              // Forward safe response headers
              const safeHeaders = ['content-type', 'cache-control', 'etag', 'last-modified', 
                                  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
              for (const [key, value] of Object.entries(response.headers)) {
                if (safeHeaders.includes(key.toLowerCase())) {
                  reply.header(key, value);
                }
              }
              
              reply.status(response.status);
              
              // Increment round-robin counter for successful response (no-cache policy) in round-robin mode
              if (selectionMode === 'round-robin') {
                const roundRobinKey = `${request.appId}:${sourceName}`;
                const currentIndex = roundRobinCounters.get(roundRobinKey) || 0;
                roundRobinCounters.set(roundRobinKey, currentIndex + 1);
              }
              
              return response.body;
            }
            
            // Apply max_ttl_seconds limit if policy has one
            if (cachePolicy.max_ttl_seconds !== null) {
              // If cacheTtl is 0 (forever) or exceeds policy limit, use policy limit
              if (cacheTtl === 0 || cacheTtl > cachePolicy.max_ttl_seconds) {
                cacheTtl = cachePolicy.max_ttl_seconds;
              }
            }
          }
          
          // Store in cache (for cacheable methods or if explicitly requested)
          if (isCacheable && response.status >= 200 && response.status < 400) {
            await storeCacheEntry({
              app_id: request.appId,
              source_id: source.id,
              cache_key: cacheKey,
              request_method: method.toUpperCase(),
              request_url: urlWithQuery,
              request_body_hash: bodyHash,
              response_status: response.status,
              response_headers: response.headers,
              response_body: response.isJson ? response.body : null,
              response_body_raw: response.isJson ? null : response.rawBody,
              content_type: response.contentType,
              ttl_seconds: cacheTtl,
              storage_pool_id: storagePoolId,
            });
          }
          
          // Set response headers
          reply.header('X-Cache', 'MISS');
          reply.header('X-Cache-Key', cacheKey);
          reply.header('X-Source', source.name);
          
          // Forward safe response headers
          const safeHeaders = ['content-type', 'cache-control', 'etag', 'last-modified', 
                              'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'];
          for (const [key, value] of Object.entries(response.headers)) {
            if (safeHeaders.includes(key.toLowerCase())) {
              reply.header(key, value);
            }
          }
          
          reply.status(response.status);
          
          // Increment round-robin counter only after successful request in round-robin mode
          if (selectionMode === 'round-robin') {
            const roundRobinKey = `${request.appId}:${sourceName}`;
            const currentIndex = roundRobinCounters.get(roundRobinKey) || 0;
            roundRobinCounters.set(roundRobinKey, currentIndex + 1);
          }
          
          return response.body;
          
        } catch (err) {
          fastify.log.error({ err, source: source.name, url: urlWithQuery }, 'Proxy request failed');
          
          // Log audit for failures
          await logAudit({
            app_id: request.appId,
            action: 'proxy_error',
            resource_type: 'source',
            resource_id: source.id,
            new_value: { error: err.message, url: urlWithQuery },
            ip_address: request.ip,
          });
          
          // If not the last source and in priority mode, try next source
          if (!isLastSource && selectionMode === 'priority') {
            fastify.log.warn({ 
              source: source.name, 
              error: err.message,
              remainingSources: selectedSources.length - i - 1 
            }, 'Source failed, trying next source for failover');
            lastError = err;
            continue;
          }
          
          // Last source failed or round-robin mode - return error
          const { statusCode, response } = createErrorResponse(err, {
            statusCode: 502,
            code: 'BadGateway',
            details: config.nodeEnv === 'development' ? `Failed to reach ${source.name}: ${err.message}` : undefined,
          });
          // Override message for production
          if (config.nodeEnv !== 'development') {
            response.message = `Failed to reach ${source.name}. Please try again later.`;
          }
          return reply.status(statusCode).send(response);
        }
      } catch (err) {
        // Error getting source with auth
        lastError = err;
        if (!isLastSource && selectionMode === 'priority') {
          fastify.log.warn({ 
            sourceRow: sourceRow.name, 
            error: err.message,
            remainingSources: selectedSources.length - i - 1 
          }, 'Failed to get source, trying next source for failover');
          continue;
        }
        // Last source or round-robin - return error
        const { statusCode, response } = createErrorResponse(err, {
          statusCode: 500,
          code: 'InternalServerError',
          details: config.nodeEnv === 'development' ? err.message : undefined,
        });
        return reply.status(statusCode).send(response);
      }
    }
    
    // All sources failed (should not reach here in round-robin mode)
    if (lastError) {
      const { statusCode, response } = createErrorResponse(lastError, {
        statusCode: 502,
        code: 'BadGateway',
        details: config.nodeEnv === 'development' ? `All sources failed: ${lastError.message}` : undefined,
      });
      if (config.nodeEnv !== 'development') {
        response.message = 'All sources failed. Please try again later.';
      }
      return reply.status(statusCode).send(response);
    }
  });
  
  // List available proxy endpoints
  fastify.get('/proxy', {
    preHandler: [fastify.authenticateApiKey],
  }, async (request, reply) => {
    const sources = await query(
      `SELECT name, base_url, is_active, priority FROM app_sources 
       WHERE app_id = $1 AND is_active = true ORDER BY priority`,
      [request.appId]
    );
    
    // Group sources by canonical name (extract base name before " - " or " ")
    const canonicalGroups = new Map();
    
    for (const source of sources.rows) {
      // Extract canonical name (everything before " - " or first word)
      let canonicalName = source.name;
      const dashIndex = source.name.indexOf(' - ');
      const spaceIndex = source.name.indexOf(' ');
      
      if (dashIndex > 0) {
        canonicalName = source.name.substring(0, dashIndex);
      } else if (spaceIndex > 0 && !source.name.match(/^[A-Z][a-z]+ [A-Z]/)) {
        // Only use first word if it's not a proper name (like "JSONPlaceholder API")
        canonicalName = source.name.split(' ')[0];
      }
      
      if (!canonicalGroups.has(canonicalName)) {
        canonicalGroups.set(canonicalName, []);
      }
      canonicalGroups.get(canonicalName).push({
        name: source.name,
        base_url: source.base_url,
        priority: source.priority,
        active: source.is_active,
      });
    }
    
    // Build endpoints list
    const endpoints = Array.from(canonicalGroups.entries()).map(([canonicalName, sources]) => ({
      canonical_name: canonicalName,
      endpoint: `/proxy/${encodeURIComponent(canonicalName)}`,
      sources: sources.map(s => ({
        name: s.name,
        base_url: s.base_url,
        priority: s.priority,
        active: s.active,
      })),
      selection_mode: config.sourceSelectionMode || 'priority',
      description: sources.length > 1 
        ? `Multiple sources available (${sources.length}). Uses ${config.sourceSelectionMode || 'priority'}-based selection.`
        : 'Single source',
    }));
    
    return {
      message: 'Available proxy endpoints',
      usage: 'Replace your API base URL with the proxy endpoint',
      example: {
        before: 'https://api.example.com/v1/endpoint',
        after: `${request.protocol}://${request.hostname}/proxy/JSONPlaceholder/v1/endpoint`,
      },
      note: 'Sources with the same canonical name (e.g., "JSONPlaceholder - Primary", "JSONPlaceholder - Backup") can be accessed via /proxy/JSONPlaceholder/*',
      selection_mode: config.sourceSelectionMode || 'priority',
      endpoints,
    };
  });
}

