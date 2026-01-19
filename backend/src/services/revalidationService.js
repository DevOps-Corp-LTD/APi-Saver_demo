import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { cacheOrFetch } from './cacheService.js';
import { getSourceWithAuth } from './sourceService.js';

/**
 * Revalidate a cache entry (stale-while-revalidate pattern)
 * @param {string} appId - App ID
 * @param {string} cacheKey - Cache key to revalidate
 * @returns {object|null} - Updated cache entry or null
 */
export async function revalidateCacheEntry(appId, cacheKey) {
  // Get the cache entry
  const entryResult = await query(
    `SELECT * FROM cache_entries 
     WHERE app_id = $1 AND cache_key = $2 
     AND (expires_at > NOW() OR expires_at IS NULL)`,
    [appId, cacheKey]
  );
  
  if (entryResult.rows.length === 0) {
    return null;
  }
  
  const entry = entryResult.rows[0];
  
  // Get source to reconstruct request
  const source = await getSourceWithAuth(entry.source_id);
  if (!source) {
    return null;
  }
  
  // Reconstruct request from cache entry
  const request = {
    method: entry.request_method,
    url: entry.request_url,
    body: entry.request_body_hash ? null : null, // We don't store body, so we'll use the URL
    headers: {},
    force_refresh: true, // Force refresh to get new data
  };
  
  try {
    // Fetch fresh data
    const result = await cacheOrFetch(appId, request);
    
    // Update revalidate_at timestamp
    await query(
      `UPDATE cache_entries 
       SET revalidate_at = NOW(), updated_at = NOW()
       WHERE app_id = $1 AND cache_key = $2`,
      [appId, cacheKey]
    );
    
    return result;
  } catch (err) {
    logger.error({ cacheKey, err: err.message }, '[revalidationService] Revalidation failed');
    return null;
  }
}

/**
 * Revalidate expired cache entries in background
 * @param {string} appId - Optional app ID to limit revalidation
 * @param {number} limit - Maximum number of entries to revalidate
 * @returns {number} - Number of entries revalidated
 */
export async function revalidateExpiredEntries(appId = null, limit = 10) {
  let whereClause = 'WHERE (expires_at < NOW() OR expires_at IS NULL) AND (revalidate_at IS NULL OR revalidate_at < NOW() - INTERVAL \'1 hour\')';
  const params = [];
  
  if (appId) {
    whereClause += ' AND app_id = $1';
    params.push(appId);
  }
  
  params.push(limit);
  
  // Get entries that need revalidation
  const result = await query(
    `SELECT app_id, cache_key 
     FROM cache_entries 
     ${whereClause}
     ORDER BY expires_at ASC NULLS LAST
     LIMIT $${params.length}`,
    params
  );
  
  let revalidated = 0;
  
  for (const row of result.rows) {
    try {
      const revalidatedEntry = await revalidateCacheEntry(row.app_id, row.cache_key);
      if (revalidatedEntry) {
        revalidated++;
      }
    } catch (err) {
      logger.error({ cacheKey: row.cache_key, err: err.message }, '[revalidationService] Failed to revalidate');
    }
  }
  
  return revalidated;
}

/**
 * Get entries that need revalidation
 * @param {string} appId - App ID
 * @param {object} options - Query options
 * @returns {array} - Array of cache entries needing revalidation
 */
export async function getEntriesNeedingRevalidation(appId, options = {}) {
  const { limit = 100, stale_threshold_hours = 1 } = options;
  
  const result = await query(
    `SELECT ce.id, ce.cache_key, ce.request_url, ce.expires_at, ce.revalidate_at,
            ce.created_at, src.name as source_name
     FROM cache_entries ce
     LEFT JOIN app_sources src ON ce.source_id = src.id
     WHERE ce.app_id = $1
     AND (
       (expires_at < NOW() AND (revalidate_at IS NULL OR revalidate_at < NOW() - INTERVAL '${stale_threshold_hours} hours'))
       OR
       (expires_at IS NULL AND (revalidate_at IS NULL OR revalidate_at < NOW() - INTERVAL '${stale_threshold_hours} hours'))
     )
     ORDER BY expires_at ASC NULLS LAST, created_at ASC
     LIMIT $2`,
    [appId, limit]
  );
  
  return result.rows;
}

/**
 * Schedule revalidation for a cache entry
 * @param {string} appId - App ID
 * @param {string} cacheKey - Cache key
 * @param {Date} revalidateAt - When to revalidate
 */
export async function scheduleRevalidation(appId, cacheKey, revalidateAt) {
  await query(
    `UPDATE cache_entries 
     SET revalidate_at = $1, updated_at = NOW()
     WHERE app_id = $2 AND cache_key = $3`,
    [revalidateAt, appId, cacheKey]
  );
}

export default {
  revalidateCacheEntry,
  revalidateExpiredEntries,
  getEntriesNeedingRevalidation,
  scheduleRevalidation,
};
