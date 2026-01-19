import { query } from '../db/pool.js';
import logger from '../utils/logger.js';

/**
 * Invalidate a cache entry
 * @param {string} appId - App ID
 * @param {string} cacheKey - Cache key
 * @param {string} sourceId - Optional source ID for dedicated mode
 * @param {string} storageMode - Storage mode: 'dedicated' or 'shared'
 * @param {string} storagePoolId - Optional storage pool ID for shared mode
 * @returns {boolean} - True if invalidated
 */
export async function invalidateCacheEntry(appId, cacheKey, sourceId = null, storageMode = 'dedicated', storagePoolId = null) {
  let whereClause = 'app_id = $1 AND cache_key = $2';
  const params = [appId, cacheKey];
  
  if (storageMode === 'dedicated' && sourceId) {
    whereClause += ' AND source_id = $3 AND storage_pool_id IS NULL';
    params.push(sourceId);
  } else if (storageMode === 'shared' && storagePoolId) {
    whereClause += ' AND storage_pool_id = $3';
    params.push(storagePoolId);
  }
  
  // Get entry ID before deletion for lineage
  const entryResult = await query(
    `SELECT id FROM cache_entries WHERE ${whereClause}`,
    params
  );
  
  const result = await query(
    `DELETE FROM cache_entries WHERE ${whereClause}`,
    params
  );
  
  // Log lineage event for invalidation
  if (result.rowCount > 0 && entryResult.rows.length > 0) {
    try {
      const { logLineageEvent } = await import('./lineageService.js');
      await logLineageEvent({
        app_id: appId,
        cache_entry_id: entryResult.rows[0].id,
        event_type: 'invalidated',
        source_id: sourceId,
        action: 'invalidate',
        metadata: { cache_key },
      });
    } catch (err) {
      logger.error({ err: err.message }, '[invalidateCacheEntry] Failed to log lineage event');
    }
  }
  
  return result.rowCount > 0;
}

/**
 * Purge all cache entries for an app
 * @param {string} appId - App ID
 * @returns {number} - Number of entries purged
 */
export async function purgeCache(appId) {
  const result = await query(
    'DELETE FROM cache_entries WHERE app_id = $1',
    [appId]
  );
  return result.rowCount;
}

/**
 * Purge expired cache entries
 * @returns {number} - Number of entries purged
 */
export async function purgeExpiredEntries() {
  const result = await query(
    'DELETE FROM cache_entries WHERE expires_at < NOW()'
  );
  return result.rowCount;
}

/**
 * Invalidate cache entries by URL prefix
 * @param {string} appId - App ID
 * @param {string} urlPrefix - URL prefix pattern to match
 * @param {object} options - Additional options
 * @returns {number} - Number of entries invalidated
 */
export async function invalidateCacheByPrefix(appId, urlPrefix, options = {}) {
  const { source_id = null, storage_pool_id = null } = options;
  
  let whereClause = 'app_id = $1 AND request_url LIKE $2';
  const params = [appId, `${urlPrefix}%`];
  let paramIndex = 3;
  
  if (source_id) {
    whereClause += ` AND source_id = $${paramIndex}`;
    params.push(source_id);
    paramIndex++;
  }
  
  if (storage_pool_id !== null) {
    if (storage_pool_id === '') {
      whereClause += ' AND storage_pool_id IS NULL';
    } else {
      whereClause += ` AND storage_pool_id = $${paramIndex}`;
      params.push(storage_pool_id);
      paramIndex++;
    }
  }
  
  const result = await query(
    `DELETE FROM cache_entries WHERE ${whereClause}`,
    params
  );
  return result.rowCount;
}

/**
 * Invalidate cache entries by cache key prefix
 * @param {string} appId - App ID
 * @param {string} keyPrefix - Cache key prefix to match
 * @param {object} options - Additional options
 * @returns {number} - Number of entries invalidated
 */
export async function invalidateCacheByKeyPrefix(appId, keyPrefix, options = {}) {
  const { source_id = null, storage_pool_id = null } = options;
  
  let whereClause = 'app_id = $1 AND cache_key LIKE $2';
  const params = [appId, `${keyPrefix}%`];
  let paramIndex = 3;
  
  if (source_id) {
    whereClause += ` AND source_id = $${paramIndex}`;
    params.push(source_id);
    paramIndex++;
  }
  
  if (storage_pool_id !== null) {
    if (storage_pool_id === '') {
      whereClause += ' AND storage_pool_id IS NULL';
    } else {
      whereClause += ` AND storage_pool_id = $${paramIndex}`;
      params.push(storage_pool_id);
      paramIndex++;
    }
  }
  
  const result = await query(
    `DELETE FROM cache_entries WHERE ${whereClause}`,
    params
  );
  return result.rowCount;
}

/**
 * Assign tags to cache entries
 * @param {string} appId - App ID
 * @param {array} entryIds - Array of cache entry IDs
 * @param {array} tags - Array of tag strings to assign
 * @returns {number} - Number of entries updated
 */
export async function assignTagsToCacheEntries(appId, entryIds, tags) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return 0;
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    return 0;
  }
  
  const entryIdPlaceholders = entryIds.map((_, i) => `$${i + 2}`).join(', ');
  const appIdParamIndex = entryIds.length + 2;
  const tagsJson = JSON.stringify(tags);
  
  const result = await query(
    `UPDATE cache_entries 
     SET tags = (
       SELECT jsonb_agg(DISTINCT value)
       FROM jsonb_array_elements_text(
         COALESCE(tags, '[]'::jsonb) || $1::jsonb
       )
     ),
     updated_at = NOW()
     WHERE id IN (${entryIdPlaceholders})
     AND app_id = $${appIdParamIndex}
     RETURNING id`,
    [tagsJson, ...entryIds, appId]
  );
  
  return result.rowCount;
}

/**
 * Remove tags from cache entries
 * @param {string} appId - App ID
 * @param {array} entryIds - Array of cache entry IDs
 * @param {array} tags - Array of tag strings to remove
 * @returns {number} - Number of entries updated
 */
export async function removeTagsFromCacheEntries(appId, entryIds, tags) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return 0;
  }
  if (!Array.isArray(tags) || tags.length === 0) {
    return 0;
  }
  
  const entryIdPlaceholders = entryIds.map((_, i) => `$${i + 2}`).join(', ');
  const appIdParamIndex = entryIds.length + 2;
  const tagsJson = JSON.stringify(tags);
  
  const result = await query(
    `UPDATE cache_entries 
     SET tags = (
       SELECT jsonb_agg(value)
       FROM jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb))
       WHERE value != ALL($1::text[])
     ),
     updated_at = NOW()
     WHERE id IN (${entryIdPlaceholders})
     AND app_id = $${appIdParamIndex}
     RETURNING id`,
    [tagsJson, ...entryIds, appId]
  );
  
  return result.rowCount;
}

/**
 * Invalidate cache entries by tags
 * @param {string} appId - App ID
 * @param {array} tags - Array of tag strings
 * @param {object} options - Additional options
 * @returns {number} - Number of entries invalidated
 */
export async function invalidateCacheByTags(appId, tags, options = {}) {
  const { match_all = false, source_id = null, storage_pool_id = null } = options;
  
  if (!Array.isArray(tags) || tags.length === 0) {
    return 0;
  }
  
  let whereClause = 'app_id = $1';
  const params = [appId];
  let paramIndex = 2;
  
  // Build tag condition
  if (match_all) {
    // All tags must be present
    const tagConditions = tags.map((_, i) => {
      params.push(tags[i]);
      paramIndex++;
      return `tags @> $${paramIndex - 1}::jsonb`;
    });
    whereClause += ` AND (${tagConditions.join(' AND ')})`;
  } else {
    // Any tag matches - use JSONB overlap operator
    // Convert tags array to text array for JSONB ?| operator
    // Validate and normalize tags to ensure they're strings
    let tagsArray;
    if (Array.isArray(tags)) {
      tagsArray = tags.map(tag => String(tag)).filter(tag => tag.length > 0);
    } else if (typeof tags === 'string') {
      tagsArray = [tags];
    } else {
      // Invalid input - log warning and return 0
      logger.warn({ tagsType: typeof tags }, '[invalidateCacheByTags] Invalid tags parameter type. Expected array or string');
      return 0;
    }
    
    if (tagsArray.length === 0) {
      return 0;
    }
    
    params.push(tagsArray);
    whereClause += ` AND tags ?| $${paramIndex}::text[]`;
    paramIndex++;
  }
  
  if (source_id) {
    whereClause += ` AND source_id = $${paramIndex}`;
    params.push(source_id);
    paramIndex++;
  }
  
  if (storage_pool_id !== null) {
    if (storage_pool_id === '') {
      whereClause += ' AND storage_pool_id IS NULL';
    } else {
      whereClause += ` AND storage_pool_id = $${paramIndex}`;
      params.push(storage_pool_id);
      paramIndex++;
    }
  }
  
  const result = await query(
    `DELETE FROM cache_entries WHERE ${whereClause}`,
    params
  );
  
  return result.rowCount;
}

/**
 * Purge pool cache entries
 * @param {string} appId - App ID
 * @param {string} poolId - Pool ID
 * @param {object} options - Additional options
 * @returns {number} - Number of entries purged
 */
export async function purgePoolCache(appId, poolId, options = {}) {
  const { expired_only = false, source_id = null, url_pattern = null } = options;
  
  let whereClause = 'app_id = $1 AND storage_pool_id = $2';
  const params = [appId, poolId];
  let paramIndex = 3;
  
  if (expired_only) {
    whereClause += ' AND expires_at < NOW()';
  }
  
  if (source_id) {
    whereClause += ` AND source_id = $${paramIndex}`;
    params.push(source_id);
    paramIndex++;
  }
  
  if (url_pattern) {
    whereClause += ` AND request_url LIKE $${paramIndex}`;
    params.push(`%${url_pattern}%`);
    paramIndex++;
  }
  
  const result = await query(
    `DELETE FROM cache_entries WHERE ${whereClause}`,
    params
  );
  
  return result.rowCount;
}

/**
 * Fix cache entry storage pools (migration utility)
 * @param {string} appId - App ID
 * @returns {object} - Migration results
 */
export async function fixCacheEntryStoragePools(appId) {
  // Get all sources with their storage mode and pool
  const sourcesResult = await query(
    `SELECT id, storage_mode, storage_pool_id FROM app_sources WHERE app_id = $1`,
    [appId]
  );
  
  let fixed = 0;
  let errors = 0;
  
  for (const source of sourcesResult.rows) {
    try {
      if (source.storage_mode === 'dedicated') {
        // Dedicated mode: ensure storage_pool_id is NULL
        const result = await query(
          `UPDATE cache_entries 
           SET storage_pool_id = NULL
           WHERE app_id = $1 AND source_id = $2 AND storage_pool_id IS NOT NULL`,
          [appId, source.id]
        );
        fixed += result.rowCount;
      } else if (source.storage_mode === 'shared' && source.storage_pool_id) {
        // Shared mode: ensure storage_pool_id matches source's pool
        const result = await query(
          `UPDATE cache_entries 
           SET storage_pool_id = $3
           WHERE app_id = $1 AND source_id = $2 AND (storage_pool_id IS NULL OR storage_pool_id != $3)`,
          [appId, source.id, source.storage_pool_id]
        );
        fixed += result.rowCount;
      }
    } catch (err) {
      logger.error({ sourceId: source.id, err: err.message }, '[fixCacheEntryStoragePools] Error fixing source');
      errors++;
    }
  }
  
  return { fixed, errors };
}
