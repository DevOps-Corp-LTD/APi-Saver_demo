import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { purgeExpiredEntries as purgeExpiredCacheEntries } from './cacheService.js';
import { updateScheduledPurge, stopScheduledPurge } from './scheduledPurgeService.js';

/**
 * Get all cache policies for an app
 * @param {string} appId - App ID
 * @returns {Array} - Array of cache policies
 */
export async function getCachePolicies(appId) {
  const result = await query(
    `SELECT cp.*, s.name as source_name
     FROM cache_policies cp
     LEFT JOIN app_sources s ON cp.source_id = s.id
     WHERE cp.app_id = $1
     ORDER BY cp.created_at DESC`,
    [appId]
  );
  return result.rows;
}

/**
 * Get a single cache policy by policy ID
 * @param {string} policyId - Policy ID
 * @param {string} appId - App ID
 * @returns {object|null} - Cache policy or null
 */
export async function getCachePolicyById(policyId, appId) {
  const result = await query(
    `SELECT cp.*, s.name as source_name
     FROM cache_policies cp
     LEFT JOIN app_sources s ON cp.source_id = s.id
     WHERE cp.id = $1 AND cp.app_id = $2`,
    [policyId, appId]
  );
  return result.rows[0] || null;
}

/**
 * Get cache policy for a specific source
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @returns {object|null} - Cache policy or null
 */
export async function getCachePolicy(appId, sourceId) {
  const result = await query(
    `SELECT * FROM cache_policies
     WHERE app_id = $1 AND source_id = $2`,
    [appId, sourceId]
  );
  return result.rows[0] || null;
}

/**
 * Create or update a cache policy
 * @param {string} appId - App ID
 * @param {object} policyData - Policy data
 * @returns {object} - Created/updated policy
 */
export async function upsertCachePolicy(appId, policyData) {
  const { source_id, max_ttl_seconds = 86400, no_cache = false, purge_schedule = null } = policyData;
  
  const result = await query(
    `INSERT INTO cache_policies (app_id, source_id, max_ttl_seconds, no_cache, purge_schedule)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (app_id, source_id) DO UPDATE SET
       max_ttl_seconds = EXCLUDED.max_ttl_seconds,
       no_cache = EXCLUDED.no_cache,
       purge_schedule = EXCLUDED.purge_schedule,
       updated_at = NOW()
     RETURNING *`,
    [appId, source_id, max_ttl_seconds, no_cache, purge_schedule]
  );
  
  const policy = result.rows[0];
  
  // Update scheduled purge job
  updateScheduledPurge(policy.id, appId, source_id, purge_schedule);
  
  // Log lineage event for policy change
  try {
    const { logLineageEvent } = await import('./lineageService.js');
    // Get cache entries for this source to log policy changes
    const entriesResult = await query(
      `SELECT id FROM cache_entries WHERE app_id = $1 AND source_id = $2 LIMIT 1`,
      [appId, source_id]
    );
    if (entriesResult.rows.length > 0) {
      await logLineageEvent({
        app_id: appId,
        cache_entry_id: entriesResult.rows[0].id,
        event_type: 'policy_changed',
        source_id: source_id,
        action: 'cache_policy_upsert',
        metadata: {
          max_ttl_seconds: policy.max_ttl_seconds,
          no_cache: policy.no_cache,
          purge_schedule: policy.purge_schedule,
        },
      });
    }
  } catch (err) {
    logger.error({ err: err.message }, '[upsertCachePolicy] Failed to log lineage event');
  }
  
  return policy;
}

/**
 * Delete a cache policy
 * @param {string} policyId - Policy ID
 * @param {string} appId - App ID
 * @returns {boolean} - True if deleted
 */
export async function deleteCachePolicy(policyId, appId) {
  // Stop scheduled purge job
  stopScheduledPurge(policyId);
  
  const result = await query(
    'DELETE FROM cache_policies WHERE id = $1 AND app_id = $2',
    [policyId, appId]
  );
  return result.rowCount > 0;
}

/**
 * Get cache statistics with policy information
 * @param {string} appId - App ID
 * @returns {object} - Cache statistics
 */
export async function getCacheStatsWithPolicy(appId) {
  const statsResult = await query(
    `SELECT 
       COUNT(*) as total_entries,
       SUM(hit_count) as total_hits,
       COUNT(*) FILTER (WHERE expires_at > NOW() OR expires_at IS NULL) as active_entries,
       COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW()) as expired_entries,
       AVG(hit_count) as avg_hits_per_entry
     FROM cache_entries
     WHERE app_id = $1`,
    [appId]
  );
  
  const policiesResult = await query(
    `SELECT COUNT(*) as total_policies
     FROM cache_policies
     WHERE app_id = $1`,
    [appId]
  );
  
  return {
    ...statsResult.rows[0],
    total_policies: parseInt(policiesResult.rows[0].total_policies, 10),
  };
}

/**
 * Purge expired cache entries
 * @returns {number} - Number of entries purged
 */
export async function purgeExpiredEntries() {
  return await purgeExpiredCacheEntries();
}
