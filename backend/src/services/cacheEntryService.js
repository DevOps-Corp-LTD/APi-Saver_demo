import { query } from '../db/pool.js';
import logger from '../utils/logger.js';

/**
 * Get cached entry by key
 * @param {string} appId - App ID
 * @param {string} cacheKey - Cache key
 * @param {string} sourceId - Optional source ID for dedicated mode
 * @param {string} storageMode - Storage mode: 'dedicated' or 'shared'
 * @param {string} storagePoolId - Optional storage pool ID for shared mode
 * @returns {object|null} - Cache entry or null
 */
export async function getCacheEntry(appId, cacheKey, sourceId = null, storageMode = 'dedicated', storagePoolId = null) {
  let whereClause = 'app_id = $1 AND cache_key = $2 AND (expires_at > NOW() OR expires_at IS NULL)';
  const params = [appId, cacheKey];
  
  if (storageMode === 'dedicated' && sourceId) {
    // Dedicated mode: cache is isolated per source (use source_id for lookup)
    // Pool_id may be set for management/organization, but cache isolation is by source_id
    whereClause += ' AND source_id = $3';
    params.push(sourceId);
  } else if (storageMode === 'shared' && storagePoolId) {
    // Shared mode: cache is shared across sources in the pool (use pool_id for lookup)
    whereClause += ' AND storage_pool_id = $3';
    params.push(storagePoolId);
  } else if (storageMode === 'shared') {
    // Shared mode REQUIRES storage_pool_id - cannot lookup without it
    // Log warning to help diagnose misconfiguration
    logger.warn({ appId, cacheKey }, '[getCacheEntry] Shared storage mode requires storagePoolId but none provided');
    return null;
  }
  
  const result = await query(
    `SELECT * FROM cache_entries WHERE ${whereClause}`,
    params
  );
  
  if (result.rows[0]) {
    // Update hit count and return updated row
    const updateResult = await query(
      `UPDATE cache_entries SET hit_count = hit_count + 1, last_hit_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [result.rows[0].id]
    );
    const entry = updateResult.rows[0] || null;
    
    // Log lineage event for access
    if (entry) {
      try {
        const { logLineageEvent } = await import('./lineageService.js');
        await logLineageEvent({
          app_id: appId,
          cache_entry_id: entry.id,
          event_type: 'accessed',
          source_id: entry.source_id,
          metadata: {
            hit_count: entry.hit_count,
          },
        });
      } catch (err) {
        logger.error({ err: err.message }, '[getCacheEntry] Failed to log lineage event');
      }
    }
    
    return entry;
  }
  
  return null;
}

/**
 * Store a cache entry
 * @param {object} entry - Cache entry data
 * @returns {object} - Stored entry
 */
export async function storeCacheEntry(entry) {
  const {
    app_id,
    source_id,
    cache_key,
    request_method,
    request_url,
    request_body_hash,
    response_status,
    response_headers,
    response_body,
    response_body_raw,
    content_type,
    ttl_seconds,
    storage_pool_id = null,
  } = entry;
  
  // TTL = 0 means forever (expires_at = NULL)
  const expiresAt = (ttl_seconds === 0 || ttl_seconds === null) 
    ? null 
    : new Date(Date.now() + ttl_seconds * 1000);
  
  // Use appropriate conflict resolution based on storage mode
  // Check source's storage_mode to determine the correct lookup strategy
  let whereClause;
  let checkParams;
  
  if (source_id) {
    // Check source's storage mode from database
    const sourceResult = await query(
      'SELECT storage_mode FROM app_sources WHERE id = $1',
      [source_id]
    );
    const sourceStorageMode = sourceResult.rows[0]?.storage_mode || 'dedicated';
    
    if (sourceStorageMode === 'dedicated') {
      // Dedicated mode: use source_id for cache isolation (pool_id may be set for management)
      // Cache entries are isolated per source, so we match by source_id
      whereClause = 'app_id = $1 AND cache_key = $2 AND source_id = $3';
      checkParams = [app_id, cache_key, source_id];
    } else {
      // Shared mode: use pool_id for cache sharing
      whereClause = 'app_id = $1 AND cache_key = $2 AND storage_pool_id = $3';
      checkParams = [app_id, cache_key, storage_pool_id];
    }
  } else if (storage_pool_id) {
    // Shared mode: match idx_cache_entries_shared
    whereClause = 'app_id = $1 AND cache_key = $2 AND storage_pool_id = $3';
    checkParams = [app_id, cache_key, storage_pool_id];
  } else {
    // Fallback: dedicated mode without pool (legacy)
    whereClause = 'app_id = $1 AND cache_key = $2 AND source_id = $3 AND storage_pool_id IS NULL';
    checkParams = [app_id, cache_key, source_id];
  }
  
  // Check if entry exists
  const existing = await query(
    `SELECT * FROM cache_entries WHERE ${whereClause}`,
    checkParams
  );
  
  if (existing.rows.length > 0) {
    // Update existing entry
    let updateWhereClause;
    let updateParams;
    if (storage_pool_id) {
      updateWhereClause = 'app_id = $1 AND cache_key = $2 AND storage_pool_id = $3';
      updateParams = [
        app_id, cache_key, storage_pool_id,
        source_id, response_status, response_headers, response_body, response_body_raw,
        content_type, ttl_seconds, expiresAt, storage_pool_id
      ];
    } else {
      updateWhereClause = 'app_id = $1 AND cache_key = $2 AND source_id = $3 AND storage_pool_id IS NULL';
      updateParams = [
        app_id, cache_key, source_id,
        source_id, response_status, response_headers, response_body, response_body_raw,
        content_type, ttl_seconds, expiresAt, storage_pool_id
      ];
    }
    
    const updateResult = await query(
      `UPDATE cache_entries SET
        source_id = $4,
        response_status = $5,
        response_headers = $6,
        response_body = $7,
        response_body_raw = $8,
        content_type = $9,
        ttl_seconds = $10,
        expires_at = $11,
        storage_pool_id = $12,
        hit_count = 0,
        updated_at = NOW()
      WHERE ${updateWhereClause}
      RETURNING *`,
      updateParams
    );
    return updateResult.rows[0];
  } else {
    // Insert new entry
    const insertResult = await query(
      `INSERT INTO cache_entries 
       (app_id, source_id, cache_key, request_method, request_url, request_body_hash,
        response_status, response_headers, response_body, response_body_raw, content_type,
        ttl_seconds, expires_at, storage_pool_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [app_id, source_id, cache_key, request_method, request_url, request_body_hash,
       response_status, response_headers, response_body, response_body_raw, content_type,
       ttl_seconds, expiresAt, storage_pool_id]
    );
    const inserted = insertResult.rows[0];
    
    // Log lineage event for creation
    try {
      const { logLineageEvent } = await import('./lineageService.js');
      await logLineageEvent({
        app_id: app_id,
        cache_entry_id: inserted.id,
        event_type: 'created',
        source_id: source_id,
        metadata: {
          cache_key,
          request_url,
          ttl_seconds,
          expires_at: expiresAt,
        },
      });
    } catch (err) {
      logger.error({ err: err.message }, '[storeCacheEntry] Failed to log lineage event');
    }
    
    return inserted;
  }
}

/**
 * List cache entries with filtering and pagination
 * @param {string} appId - App ID
 * @param {object} options - Query options
 * @returns {object} - Paginated cache entries
 */
export async function listCacheEntries(appId, options = {}) {
  const {
    page = 1,
    limit = 20,
    expired = false,
    source_id = null,
    storage_pool_id = null,
    search = null,
    sort_field = 'created_at',
    sort_order = 'desc',
    status_code = null,
    method = null,
    content_type = null,
    hit_count_min = null,
    hit_count_max = null,
    start_date = null,
    end_date = null,
    created_after = null,
    created_before = null,
  } = options;
  
  // Debug logging for dedicated filter
  if (storage_pool_id === '' || storage_pool_id === '__dedicated__') {
    logger.debug({ storagePoolId: storage_pool_id }, '[listCacheEntries] Filtering for dedicated mode');
  }
  
  // Support both naming conventions
  const startDate = start_date || created_after;
  const endDate = end_date || created_before;
  
  const offset = (page - 1) * limit;
  
  // Build WHERE clause (use ce. prefix for when JOIN is used)
  let whereConditions = ['ce.app_id = $1'];
  const params = [appId];
  let paramIndex = 2;
  
  if (!expired) {
    whereConditions.push('(ce.expires_at > NOW() OR ce.expires_at IS NULL)');
  }
  
  if (source_id) {
    whereConditions.push(`ce.source_id = $${paramIndex}`);
    params.push(source_id);
    paramIndex++;
  }
  
  if (storage_pool_id !== null && storage_pool_id !== undefined) {
    if (storage_pool_id === '' || storage_pool_id === '__dedicated__') {
      // Dedicated mode: entries with NULL storage_pool_id AND source must be in dedicated mode
      // CRITICAL: This MUST filter out entries with any pool_id set
      whereConditions.push('ce.storage_pool_id IS NULL');
    } else {
      // Shared pool mode: filter by specific pool_id
      whereConditions.push(`ce.storage_pool_id = $${paramIndex}`);
      params.push(storage_pool_id);
      paramIndex++;
    }
  }
  
  if (search) {
    whereConditions.push(`(
      ce.request_url ILIKE $${paramIndex} OR
      ce.request_method ILIKE $${paramIndex} OR
      ce.cache_key ILIKE $${paramIndex} OR
      ce.content_type ILIKE $${paramIndex} OR
      ce.response_status::text LIKE $${paramIndex}
    )`);
    params.push(`%${search}%`);
    paramIndex++;
  }
  
  if (status_code) {
    if (status_code.includes('-')) {
      const [min, max] = status_code.split('-').map(s => parseInt(s.trim(), 10));
      if (!isNaN(min) && !isNaN(max)) {
        whereConditions.push(`ce.response_status >= $${paramIndex} AND ce.response_status <= $${paramIndex + 1}`);
        params.push(min, max);
        paramIndex += 2;
      }
    } else {
      const status = parseInt(status_code, 10);
      if (!isNaN(status)) {
        whereConditions.push(`ce.response_status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }
    }
  }
  
  if (method) {
    if (Array.isArray(method) && method.length > 0) {
      const methodPlaceholders = method.map((_, i) => `$${paramIndex + i}`).join(', ');
      whereConditions.push(`ce.request_method IN (${methodPlaceholders})`);
      params.push(...method);
      paramIndex += method.length;
    } else if (typeof method === 'string') {
      whereConditions.push(`ce.request_method = $${paramIndex}`);
      params.push(method);
      paramIndex++;
    }
  }
  
  if (content_type) {
    whereConditions.push(`ce.content_type ILIKE $${paramIndex}`);
    params.push(`%${content_type}%`);
    paramIndex++;
  }
  
  if (hit_count_min !== null) {
    whereConditions.push(`ce.hit_count >= $${paramIndex}`);
    params.push(hit_count_min);
    paramIndex++;
  }
  
  if (hit_count_max !== null) {
    whereConditions.push(`ce.hit_count <= $${paramIndex}`);
    params.push(hit_count_max);
    paramIndex++;
  }
  
  if (startDate) {
    whereConditions.push(`ce.created_at >= $${paramIndex}`);
    params.push(startDate);
    paramIndex++;
  }
  
  if (endDate) {
    whereConditions.push(`ce.created_at <= $${paramIndex}`);
    params.push(endDate);
    paramIndex++;
  }
  
  const whereClause = whereConditions.join(' AND ');
  
  // Validate sort field
  const allowedSortFields = ['created_at', 'updated_at', 'expires_at', 'hit_count', 'request_method', 'request_url', 'response_status'];
  const safeSortField = allowedSortFields.includes(sort_field) ? sort_field : 'created_at';
  const safeSortOrder = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  
  // When filtering for dedicated (storage_pool_id IS NULL), also ensure source is in dedicated mode for accuracy
  let joinCondition = 'LEFT JOIN app_sources s ON s.id = ce.source_id';
  
  if (storage_pool_id !== null && storage_pool_id !== undefined && (storage_pool_id === '' || storage_pool_id === '__dedicated__')) {
    // For dedicated mode, ensure source is also in dedicated mode (prevents showing entries from sources that were moved to shared pools)
    // Use INNER JOIN to ensure we only get entries where source matches dedicated criteria
    // Note: s.app_id = $1 uses the same parameter as ce.app_id = $1 in WHERE clause, which is correct
    joinCondition = 'INNER JOIN app_sources s ON s.id = ce.source_id AND s.app_id = $1 AND (s.storage_mode = \'dedicated\' OR s.storage_pool_id IS NULL)';
  }
  
  // Get total count (use same JOIN condition as entries query for consistency)
  const countResult = await query(
    `SELECT COUNT(*) as total FROM cache_entries ce ${joinCondition} WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);
  
  // Get entries
  // Debug: Log the query when filtering for dedicated
  const querySql = `SELECT 
      ce.*,
      s.name as source_name
     FROM cache_entries ce
     ${joinCondition}
     WHERE ${whereClause}
     ORDER BY ce.${safeSortField} ${safeSortOrder}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  
  if (storage_pool_id === '' || storage_pool_id === '__dedicated__') {
    logger.debug({ querySql, params: [...params, limit, offset], whereClause, joinCondition }, '[listCacheEntries] Dedicated filter details');
  }
  
  const entriesResult = await query(querySql, [...params, limit, offset]);
  
  // Debug: Check if any returned entries have a pool_id (they shouldn't when filtering for dedicated)
  if (storage_pool_id === '' || storage_pool_id === '__dedicated__') {
    const entriesWithPool = entriesResult.rows.filter(e => e.storage_pool_id !== null && e.storage_pool_id !== undefined);
    if (entriesWithPool.length > 0) {
      logger.error({ entriesWithPool: entriesWithPool.map(e => ({ id: e.id, url: e.request_url, pool_id: e.storage_pool_id })), whereClause, joinCondition, params }, '[listCacheEntries] ERROR: Found entries with pool_id when filtering for dedicated');
    } else {
      logger.debug('[listCacheEntries] SUCCESS: All entries have NULL pool_id (dedicated filter working correctly)');
    }
  }
  
  return {
    entries: entriesResult.rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Bulk update cache entries TTL
 * @param {string} appId - App ID
 * @param {array} entryIds - Array of entry IDs
 * @param {number} ttlSeconds - New TTL in seconds
 * @returns {number} - Number of entries updated
 */
export async function bulkUpdateCacheEntries(appId, entryIds, ttlSeconds) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return 0;
  }
  
  const expiresAt = (ttlSeconds === 0 || ttlSeconds === null) 
    ? null 
    : new Date(Date.now() + ttlSeconds * 1000);
  
  const placeholders = entryIds.map((_, i) => `$${i + 2}`).join(', ');
  
  const result = await query(
    `UPDATE cache_entries 
     SET ttl_seconds = $1,
         expires_at = $${entryIds.length + 2},
         updated_at = NOW()
     WHERE id IN (${placeholders})
     AND app_id = $${entryIds.length + 3}`,
    [ttlSeconds, ...entryIds, expiresAt, appId]
  );
  
  return result.rowCount;
}
