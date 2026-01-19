import { query } from '../db/pool.js';

/**
 * Get cache statistics
 * @param {string} appId - App ID
 * @param {object} options - Query options
 * @returns {object} - Cache statistics
 */
export async function getCacheStats(appId, options = {}) {
  const { storage_pool_id = null, source_id = null } = options;
  
  let whereClause = 'WHERE ce.app_id = $1';
  const params = [appId];
  let paramIndex = 2;
  let needsSourceJoin = false;
  let joinClause = '';
  
  // Handle pool filtering
  if (storage_pool_id !== null) {
    if (storage_pool_id === '') {
      whereClause += ' AND ce.storage_pool_id IS NULL';
      needsSourceJoin = true;
      joinClause = 'INNER JOIN app_sources src ON ce.source_id = src.id AND src.app_id = $1 AND (src.storage_mode = \'dedicated\' OR src.storage_pool_id IS NULL)';
    } else {
      whereClause += ` AND ce.storage_pool_id = $${paramIndex}`;
      params.push(storage_pool_id);
      paramIndex++;
      needsSourceJoin = true;
      joinClause = `INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $${paramIndex - 1} AND src.app_id = $1`;
    }
  }
  
  // Handle source filtering
  if (source_id) {
    whereClause += ` AND ce.source_id = $${paramIndex}`;
    params.push(source_id);
    paramIndex++;
  }
  
  const sourceJoin = needsSourceJoin ? joinClause : '';
  
  const result = await query(
    `SELECT 
       COUNT(*) as total_entries,
       COALESCE(SUM(ce.hit_count), 0) as total_hits,
       COUNT(*) FILTER (WHERE ce.expires_at > NOW() OR ce.expires_at IS NULL) as active_entries,
       COUNT(*) FILTER (WHERE ce.expires_at IS NOT NULL AND ce.expires_at <= NOW()) as expired_entries,
       COALESCE(AVG(ce.hit_count), 0) as avg_hits_per_entry,
       CASE 
         WHEN COUNT(*) > 0 THEN 
           COUNT(*) FILTER (WHERE ce.hit_count > 0)::float / COUNT(*)::float
         ELSE 0
       END as hit_ratio
     FROM cache_entries ce
     ${sourceJoin}
     ${whereClause}`,
    params
  );
  
  const stats = result.rows[0] || {};
  return {
    total_entries: parseInt(stats.total_entries || 0, 10),
    total_hits: parseInt(stats.total_hits || 0, 10),
    active_entries: parseInt(stats.active_entries || 0, 10),
    expired_entries: parseInt(stats.expired_entries || 0, 10),
    avg_hits_per_entry: parseFloat(stats.avg_hits_per_entry || 0),
    hit_ratio: parseFloat(stats.hit_ratio || 0),
  };
}

/**
 * Calculate storage size for a cache entry
 * @param {object} entry - Cache entry
 * @returns {number} - Size in bytes
 */
export function calculateCacheEntrySize(entry) {
  let size = 0;
  
  if (entry.response_body) {
    try {
      size += Buffer.byteLength(JSON.stringify(entry.response_body), 'utf8');
    } catch (e) {
      size += 100;
    }
  }
  
  if (entry.response_body_raw) {
    size += Buffer.byteLength(entry.response_body_raw, 'utf8');
  }
  
  return size;
}

/**
 * Get pool storage size
 * @param {string} appId - App ID
 * @param {string|null} poolId - Pool ID (null for dedicated)
 * @returns {object} - Size statistics
 */
export async function getPoolStorageSize(appId, poolId = null) {
  const params = [appId];
  
  if (poolId === null) {
    const result = await query(
      `SELECT 
         COUNT(*) as entry_count,
         COALESCE(SUM(COALESCE(pg_column_size(response_body), 0) + COALESCE(octet_length(COALESCE(response_body_raw, '')), 0)), 0) as total_size_bytes,
         COALESCE(AVG(COALESCE(pg_column_size(response_body), 0) + COALESCE(octet_length(COALESCE(response_body_raw, '')), 0)), 0) as average_size_bytes
       FROM cache_entries
       WHERE app_id = $1 AND storage_pool_id IS NULL`,
      params
    );
    
    const row = result.rows[0] || {};
    
    return {
      entry_count: parseInt(row.entry_count || 0, 10),
      total_size_bytes: parseInt(row.total_size_bytes || 0, 10),
      average_size_bytes: parseFloat(row.average_size_bytes || 0),
    };
  } else {
    params.push(poolId);
    const result = await query(
      `SELECT 
         COUNT(*) as entry_count,
         COALESCE(SUM(COALESCE(pg_column_size(ce.response_body), 0) + COALESCE(octet_length(COALESCE(ce.response_body_raw, '')), 0)), 0) as total_size_bytes,
         COALESCE(AVG(COALESCE(pg_column_size(ce.response_body), 0) + COALESCE(octet_length(COALESCE(ce.response_body_raw, '')), 0)), 0) as average_size_bytes
       FROM cache_entries ce
       INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
       WHERE ce.app_id = $1 AND ce.storage_pool_id = $2`,
      params
    );
    
    const row = result.rows[0] || {};
    
    return {
      entry_count: parseInt(row.entry_count || 0, 10),
      total_size_bytes: parseInt(row.total_size_bytes || 0, 10),
      average_size_bytes: parseFloat(row.average_size_bytes || 0),
    };
  }
}

/**
 * Get dedicated pool statistics
 * @param {string} appId - App ID
 * @returns {object} - Dedicated pool statistics
 */
export async function getDedicatedPoolStats(appId) {
  const sourcesResult = await query(
    `SELECT COUNT(DISTINCT id) as source_count
     FROM app_sources
     WHERE app_id = $1 AND (storage_mode = 'dedicated' OR storage_pool_id IS NULL)`,
    [appId]
  );
  
  const statsResult = await query(
    `SELECT 
       COUNT(*) as total_entries,
       COALESCE(SUM(hit_count), 0) as total_hits,
       COUNT(*) FILTER (WHERE expires_at > NOW() OR expires_at IS NULL) as active_entries,
       COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW()) as expired_entries,
       COALESCE(AVG(hit_count), 0) as avg_hits_per_entry
     FROM cache_entries
     WHERE app_id = $1 AND storage_pool_id IS NULL`,
    [appId]
  );
  
  const sizeStats = await getPoolStorageSize(appId, null);
  
  const sourceStatsResult = await query(
    `SELECT 
       ce.source_id,
       src.name as source_name,
       COUNT(*) as entry_count,
       COALESCE(SUM(ce.hit_count), 0) as total_hits
     FROM cache_entries ce
     LEFT JOIN app_sources src ON ce.source_id = src.id
     WHERE ce.app_id = $1 AND ce.storage_pool_id IS NULL
     GROUP BY ce.source_id, src.name
     ORDER BY entry_count DESC`,
    [appId]
  );
  
  const stats = statsResult.rows[0] || {};
  
  return {
    total_entries: parseInt(stats.total_entries || 0, 10),
    total_hits: parseInt(stats.total_hits || 0, 10),
    active_entries: parseInt(stats.active_entries || 0, 10),
    expired_entries: parseInt(stats.expired_entries || 0, 10),
    avg_hits_per_entry: parseFloat(stats.avg_hits_per_entry || 0),
    source_count: parseInt(sourcesResult.rows[0]?.source_count || 0, 10),
    total_size_bytes: sizeStats.total_size_bytes || 0,
    average_size_bytes: sizeStats.average_size_bytes || 0,
    source_breakdown: sourceStatsResult.rows || [],
  };
}

/**
 * Get pool cache statistics
 * @param {string} appId - App ID
 * @param {string} poolId - Storage pool ID
 * @returns {object} - Pool statistics
 */
export async function getPoolCacheStats(appId, poolId) {
  const statsResult = await query(
    `SELECT 
       COUNT(*) as total_entries,
       COALESCE(SUM(ce.hit_count), 0) as total_hits,
       COUNT(*) FILTER (WHERE ce.expires_at > NOW() OR ce.expires_at IS NULL) as active_entries,
       COUNT(*) FILTER (WHERE ce.expires_at IS NOT NULL AND ce.expires_at <= NOW()) as expired_entries,
       COALESCE(AVG(ce.hit_count), 0) as avg_hits_per_entry,
       COUNT(DISTINCT ce.source_id) as source_count
     FROM cache_entries ce
     INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
     WHERE ce.app_id = $1 AND ce.storage_pool_id = $2`,
    [appId, poolId]
  );
  
  const sizeStats = await getPoolStorageSize(appId, poolId);
  
  const sourceStatsResult = await query(
    `SELECT 
       ce.source_id,
       src.name as source_name,
       COUNT(*) as entry_count,
       COALESCE(SUM(ce.hit_count), 0) as total_hits
     FROM cache_entries ce
     INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
     WHERE ce.app_id = $1 AND ce.storage_pool_id = $2
     GROUP BY ce.source_id, src.name
     ORDER BY entry_count DESC`,
    [appId, poolId]
  );
  
  const statusStatsResult = await query(
    `SELECT 
       ce.response_status,
       COUNT(*) as count
     FROM cache_entries ce
     INNER JOIN app_sources src ON ce.source_id = src.id AND src.storage_pool_id = $2 AND src.app_id = $1
     WHERE ce.app_id = $1 AND ce.storage_pool_id = $2
     GROUP BY ce.response_status
     ORDER BY count DESC`,
    [appId, poolId]
  );
  
  const stats = statsResult.rows[0] || {};
  
  return {
    total_entries: parseInt(stats.total_entries || 0, 10),
    total_hits: parseInt(stats.total_hits || 0, 10),
    active_entries: parseInt(stats.active_entries || 0, 10),
    expired_entries: parseInt(stats.expired_entries || 0, 10),
    avg_hits_per_entry: parseFloat(stats.avg_hits_per_entry || 0),
    source_count: parseInt(stats.source_count || 0, 10),
    total_size_bytes: sizeStats.total_size_bytes || 0,
    average_size_bytes: sizeStats.average_size_bytes || 0,
    source_breakdown: sourceStatsResult.rows || [],
    status_breakdown: statusStatsResult.rows || [],
  };
}
