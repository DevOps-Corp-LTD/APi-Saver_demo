import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { listCacheEntriesByPool, purgePoolCache, getPoolCacheStats, getPoolStorageSize } from './cacheService.js';

/**
 * Create a new storage pool
 * @param {string} appId - App ID
 * @param {object} poolData - Pool data
 * @returns {object} - Created pool
 */
export async function createStoragePool(appId, poolData) {
  const { name, description = null } = poolData;
  
  const result = await query(
    `INSERT INTO storage_pools (app_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [appId, name, description]
  );
  
  return result.rows[0];
}

/**
 * Get all storage pools for an app
 * @param {string} appId - App ID
 * @returns {object} - Object with pools array and dedicated stats
 */
export async function getStoragePools(appId) {
  const result = await query(
    `SELECT 
       sp.*,
       COUNT(DISTINCT src.id) as source_count,
       COUNT(DISTINCT ce.id) as cache_entry_count,
       COALESCE(SUM(ce.hit_count), 0) as total_hits,
       -- Determine if pool is dedicated (all sources using it are in dedicated mode)
       -- or shared (at least one source is in shared mode)
       -- If no sources, check pool name pattern (pools created for dedicated sources have "(Dedicated)" in name)
       CASE 
         WHEN COUNT(DISTINCT CASE WHEN src.storage_mode = 'shared' THEN src.id END) > 0 THEN 'shared'
         WHEN COUNT(DISTINCT CASE WHEN src.storage_mode = 'dedicated' THEN src.id END) > 0 THEN 'dedicated'
         WHEN sp.name LIKE '%(Dedicated)%' THEN 'dedicated'
         ELSE 'shared'
       END as pool_type
     FROM storage_pools sp
     LEFT JOIN app_sources src ON src.storage_pool_id = sp.id AND src.app_id = sp.app_id
     LEFT JOIN cache_entries ce ON ce.storage_pool_id = sp.id AND ce.app_id = sp.app_id
     WHERE sp.app_id = $1
     GROUP BY sp.id
     ORDER BY sp.created_at DESC`,
    [appId]
  );
  
  // Get size for each pool
  const poolsWithSize = await Promise.all(
    result.rows.map(async (pool) => {
      try {
        const sizeStats = await getPoolStorageSize(appId, pool.id);
        return {
          ...pool,
          total_size_bytes: sizeStats.total_size_bytes || 0,
          average_size_bytes: sizeStats.average_size_bytes || 0,
          is_dedicated: pool.pool_type === 'dedicated',
        };
      } catch (err) {
        logger.error({ poolId: pool.id, err }, 'Error getting size for pool');
        return {
          ...pool,
          total_size_bytes: 0,
          average_size_bytes: 0,
          is_dedicated: pool.pool_type === 'dedicated',
        };
      }
    })
  );
  
  // Note: Legacy "Dedicated Sources" virtual pool has been removed.
  // All dedicated sources now have their own pools (created automatically).
  
  return {
    pools: poolsWithSize,
  };
}

/**
 * Get storage pool by ID
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @returns {object|null} - Pool or null
 */
export async function getStoragePoolById(poolId, appId) {
  const result = await query(
    `SELECT 
       sp.*,
       -- Determine if pool is dedicated (all sources using it are in dedicated mode)
       CASE 
         WHEN COUNT(DISTINCT CASE WHEN src.storage_mode = 'shared' THEN src.id END) > 0 THEN false
         WHEN COUNT(DISTINCT CASE WHEN src.storage_mode = 'dedicated' THEN src.id END) > 0 THEN true
         WHEN sp.name LIKE '%(Dedicated)%' THEN true
         ELSE false
       END as is_dedicated
     FROM storage_pools sp
     LEFT JOIN app_sources src ON src.storage_pool_id = sp.id AND src.app_id = sp.app_id
     WHERE sp.id = $1 AND sp.app_id = $2
     GROUP BY sp.id`,
    [poolId, appId]
  );
  
  return result.rows[0] || null;
}

/**
 * Update storage pool
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @param {object} updates - Fields to update
 * @returns {object|null} - Updated pool or null
 */
export async function updateStoragePool(poolId, appId, updates) {
  const allowedFields = ['name', 'description'];
  const setClauses = [];
  const values = [];
  let paramIndex = 1;
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }
  
  if (setClauses.length === 0) {
    return getStoragePoolById(poolId, appId);
  }
  
  setClauses.push('updated_at = NOW()');
  values.push(poolId, appId);
  
  const result = await query(
    `UPDATE storage_pools SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND app_id = $${paramIndex + 1}
     RETURNING *`,
    values
  );
  
  return result.rows[0] || null;
}

/**
 * Delete storage pool
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @param {object} options - Delete options
 * @returns {boolean} - True if deleted
 */
export async function deleteStoragePool(poolId, appId, options = {}) {
  const { purge_cache = false } = options;
  
  // Get pool info to check if it's a dedicated pool
  const poolResult = await query(
    'SELECT name FROM storage_pools WHERE id = $1 AND app_id = $2',
    [poolId, appId]
  );
  
  if (poolResult.rows.length === 0) {
    throw new Error('Pool not found');
  }
  
  const pool = poolResult.rows[0];
  const isDedicatedPool = pool.name.includes('(Dedicated)');
  
  // Check if any sources are using this pool
  const sourcesResult = await query(
    'SELECT COUNT(*) FROM app_sources WHERE storage_pool_id = $1 AND app_id = $2',
    [poolId, appId]
  );
  
  const sourceCount = parseInt(sourcesResult.rows[0].count, 10);
  
  // For dedicated pools, allow deletion if no sources are using it (orphaned pools)
  // For shared pools, always require no sources
  if (sourceCount > 0) {
    throw new Error('Cannot delete pool: sources are still using it');
  }
  
  // Optionally purge cache entries
  if (purge_cache) {
    await purgePoolCache(appId, poolId);
  }
  
  const result = await query(
    'DELETE FROM storage_pools WHERE id = $1 AND app_id = $2 RETURNING id',
    [poolId, appId]
  );
  
  return result.rowCount > 0;
}

/**
 * Get comprehensive pool statistics
 * @param {string} poolId - Pool ID (or '__dedicated__' for dedicated pool)
 * @param {string} appId - App ID (for security)
 * @returns {object} - Pool statistics
 */
export async function getPoolStatistics(poolId, appId) {
  try {
    // Handle dedicated pool - no longer supported, all dedicated sources have their own pools
    if (poolId === '__dedicated__' || poolId === null) {
      throw new Error('Dedicated pool no longer exists. Each dedicated source has its own pool.');
    }
  
  // Handle regular pool
  const pool = await getStoragePoolById(poolId, appId);
  if (!pool) {
    throw new Error('Pool not found');
  }
  
  const stats = await getPoolCacheStats(appId, poolId);
  
  // Get sources using the pool
  const sourcesResult = await query(
    `SELECT 
       src.id, src.name, src.base_url, src.is_active,
       COUNT(ce.id) as entry_count,
       COALESCE(SUM(ce.hit_count), 0) as total_hits
     FROM app_sources src
     LEFT JOIN cache_entries ce ON ce.source_id = src.id AND ce.storage_pool_id = $1
     WHERE src.storage_pool_id = $1 AND src.app_id = $2
     GROUP BY src.id, src.name, src.base_url, src.is_active
     ORDER BY entry_count DESC`,
    [poolId, appId]
  );
  
  // Get oldest and newest entries - JOIN to ensure source is assigned to pool
  const ageResult = await query(
    `SELECT 
       MIN(ce.created_at) as oldest_entry,
       MAX(ce.created_at) as newest_entry,
       MIN(ce.expires_at) as earliest_expiration,
       MAX(ce.expires_at) as latest_expiration
     FROM cache_entries ce
     INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
     WHERE ce.app_id = $1 AND ce.storage_pool_id = $2`,
    [appId, poolId]
  );
  
  // Get top URLs by hit count - JOIN to ensure source is assigned to pool
  const topUrlsResult = await query(
    `SELECT 
       ce.request_url,
       COALESCE(SUM(ce.hit_count), 0) as total_hits,
       COUNT(*) as entry_count
     FROM cache_entries ce
     INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
     WHERE ce.app_id = $1 AND ce.storage_pool_id = $2
     GROUP BY ce.request_url
     ORDER BY total_hits DESC
     LIMIT 10`,
    [appId, poolId]
  );
  
    return {
      pool,
      ...stats,
      sources: sourcesResult.rows || [],
      age_info: ageResult.rows[0] || {},
      top_urls: topUrlsResult.rows || [],
    };
  } catch (err) {
    logger.error({ err }, 'Error in getPoolStatistics');
    throw err;
  }
}

/**
 * Get sources assigned to pool
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @returns {array} - List of sources with stats
 */
export async function getPoolSources(poolId, appId) {
  const result = await query(
    `SELECT 
       src.*,
       COUNT(ce.id) as cache_entry_count,
       COALESCE(SUM(ce.hit_count), 0) as total_hits
     FROM app_sources src
     LEFT JOIN cache_entries ce ON ce.source_id = src.id AND ce.storage_pool_id = $1
     WHERE src.storage_pool_id = $1 AND src.app_id = $2
     GROUP BY src.id
     ORDER BY src.name`,
    [poolId, appId]
  );
  
  return result.rows;
}

/**
 * List pool cache entries with filters
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @param {object} filters - Filter options
 * @returns {object} - Paginated cache entries
 */
export async function listPoolCacheEntries(poolId, appId, filters = {}) {
  try {
    return await listCacheEntriesByPool(appId, poolId, filters);
  } catch (error) {
    logger.error({ err: error }, 'Error listing pool cache entries');
    throw error;
  }
}

/**
 * Purge pool cache with options
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @param {object} options - Purge options
 * @returns {number} - Number of entries purged
 */
export async function purgePoolCacheEntries(poolId, appId, options = {}) {
  return await purgePoolCache(appId, poolId, options);
}

/**
 * Bulk update pool cache entries
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @param {array} entryIds - Array of entry IDs
 * @param {object} updates - Update fields
 * @returns {number} - Number of entries updated
 */
export async function bulkUpdatePoolCache(poolId, appId, entryIds, updates) {
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return 0;
  }
  
  const setClauses = [];
  const values = [];
  let paramIndex = 1;
  
  // Handle TTL updates
  if (updates.ttl_seconds !== undefined) {
    const expiresAt = updates.ttl_seconds === 0 || updates.ttl_seconds === null
      ? null
      : new Date(Date.now() + updates.ttl_seconds * 1000);
    setClauses.push(`ttl_seconds = $${paramIndex}`);
    values.push(updates.ttl_seconds);
    paramIndex++;
    setClauses.push(`expires_at = $${paramIndex}`);
    values.push(expiresAt);
    paramIndex++;
  }
  
  if (setClauses.length === 0) {
    return 0;
  }
  
  setClauses.push('updated_at = NOW()');
  
  // Build IN clause for entry IDs
  const placeholders = entryIds.map((_, i) => `$${paramIndex + i}`).join(', ');
  values.push(...entryIds, poolId, appId);
  
  const result = await query(
    `UPDATE cache_entries 
     SET ${setClauses.join(', ')}
     WHERE id IN (${placeholders}) 
     AND storage_pool_id = $${paramIndex + entryIds.length} 
     AND app_id = $${paramIndex + entryIds.length + 1}
     RETURNING id`,
    values
  );
  
  return result.rowCount;
}

/**
 * Bulk update pool cache by filter
 * @param {string} poolId - Pool ID
 * @param {string} appId - App ID (for security)
 * @param {object} filters - Filter criteria
 * @param {object} updates - Update fields
 * @returns {number} - Number of entries updated
 */
export async function bulkUpdatePoolCacheByFilter(poolId, appId, filters, updates) {
  let whereClause = 'storage_pool_id = $1 AND app_id = $2';
  const params = [poolId, appId];
  let paramIndex = 3;
  
  if (filters.source_id) {
    whereClause += ` AND source_id = $${paramIndex}`;
    params.push(filters.source_id);
    paramIndex++;
  }
  
  if (filters.url_pattern) {
    whereClause += ` AND request_url LIKE $${paramIndex}`;
    params.push(`%${filters.url_pattern}%`);
    paramIndex++;
  }
  
  if (filters.status_code) {
    whereClause += ` AND response_status = $${paramIndex}`;
    params.push(filters.status_code);
    paramIndex++;
  }
  
  if (filters.created_after) {
    whereClause += ` AND created_at >= $${paramIndex}`;
    params.push(filters.created_after);
    paramIndex++;
  }
  
  if (filters.created_before) {
    whereClause += ` AND created_at <= $${paramIndex}`;
    params.push(filters.created_before);
    paramIndex++;
  }
  
  const setClauses = [];
  
  if (updates.ttl_seconds !== undefined) {
    const expiresAt = updates.ttl_seconds === 0 || updates.ttl_seconds === null
      ? null
      : new Date(Date.now() + updates.ttl_seconds * 1000);
    setClauses.push(`ttl_seconds = $${paramIndex}`);
    params.push(updates.ttl_seconds);
    paramIndex++;
    setClauses.push(`expires_at = $${paramIndex}`);
    params.push(expiresAt);
    paramIndex++;
  }
  
  if (setClauses.length === 0) {
    return 0;
  }
  
  setClauses.push('updated_at = NOW()');
  
  const result = await query(
    `UPDATE cache_entries 
     SET ${setClauses.join(', ')}
     WHERE ${whereClause}
     RETURNING id`,
    params
  );
  
  return result.rowCount;
}

export default {
  createStoragePool,
  getStoragePools,
  getStoragePoolById,
  updateStoragePool,
  deleteStoragePool,
  getPoolStatistics,
  getPoolSources,
  listPoolCacheEntries,
  purgePoolCacheEntries,
  bulkUpdatePoolCache,
  bulkUpdatePoolCacheByFilter,
};

