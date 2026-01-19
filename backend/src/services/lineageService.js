import { query } from '../db/pool.js';
import logger from '../utils/logger.js';

/**
 * Enhanced Lineage Service
 * Tracks comprehensive lineage: who/what/when/where/TTL
 */

/**
 * Log a lineage event
 * @param {object} event - Lineage event data
 */
export async function logLineageEvent(event) {
  const {
    app_id,
    cache_entry_id,
    event_type, // 'created', 'accessed', 'invalidated', 'updated', 'policy_changed'
    user_id = null,
    source_id = null,
    action = null,
    metadata = null,
  } = event;
  
  await query(
    `INSERT INTO lineage_events 
     (app_id, cache_entry_id, event_type, user_id, source_id, action, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      app_id,
      cache_entry_id,
      event_type,
      user_id,
      source_id,
      action,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

/**
 * Get lineage for a cache entry
 * @param {string} appId - App ID
 * @param {string} cacheEntryId - Cache entry ID
 * @returns {Promise<array>} - Array of lineage events
 */
export async function getLineageForEntry(appId, cacheEntryId) {
  try {
    const result = await query(
      `SELECT le.*, u.email as user_email, src.name as source_name
       FROM lineage_events le
       LEFT JOIN users u ON le.user_id = u.id
       LEFT JOIN app_sources src ON le.source_id = src.id
       WHERE le.app_id = $1 AND le.cache_entry_id = $2
       ORDER BY le.created_at ASC`,
      [appId, cacheEntryId]
    );
    
    return result.rows.map(row => {
      let metadata = null;
      if (row.metadata) {
        try {
          metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        } catch (parseErr) {
          // Log parse error but don't fail the entire function
          logger.error({ entryId: row.id, err: parseErr.message }, '[getLineageForEntry] Failed to parse metadata');
          // Return null for metadata instead of failing
          metadata = null;
        }
      }
      return {
        ...row,
        metadata,
      };
    });
  } catch (err) {
    logger.error({ err: err.message }, '[getLineageForEntry] Error');
    return [];
  }
}

/**
 * Get lineage for a cache key
 * @param {string} appId - App ID
 * @param {string} cacheKey - Cache key
 * @returns {Promise<array>} - Array of lineage events
 */
export async function getLineageForCacheKey(appId, cacheKey) {
  try {
    // First get cache entry ID from cache key
    const entryResult = await query(
      `SELECT id FROM cache_entries 
       WHERE app_id = $1 AND cache_key = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [appId, cacheKey]
    );
    
    if (entryResult.rows.length === 0) {
      return [];
    }
    
    const entryId = entryResult.rows[0].id;
    return await getLineageForEntry(appId, entryId);
  } catch (err) {
    logger.error({ err: err.message }, '[getLineageForCacheKey] Error');
    return [];
  }
}

/**
 * Get comprehensive lineage with cache entry details
 * @param {string} appId - App ID
 * @param {string} cacheEntryId - Cache entry ID
 * @returns {Promise<object>} - Comprehensive lineage
 */
export async function getComprehensiveLineage(appId, cacheEntryId) {
  try {
    // Get cache entry
    const entryResult = await query(
      `SELECT ce.*, src.name as source_name
       FROM cache_entries ce
       LEFT JOIN app_sources src ON ce.source_id = src.id
       WHERE ce.app_id = $1 AND ce.id = $2`,
      [appId, cacheEntryId]
    );
    
    if (entryResult.rows.length === 0) {
      return null;
    }
    
    const entry = entryResult.rows[0];
    
    // Get lineage events
    const events = await getLineageForEntry(appId, cacheEntryId);
    
    return {
      entry: {
        id: entry.id,
        cache_key: entry.cache_key,
        request_url: entry.request_url,
        request_method: entry.request_method,
        source_id: entry.source_id,
        source_name: entry.source_name,
        ttl_seconds: entry.ttl_seconds,
        expires_at: entry.expires_at,
        created_at: entry.created_at,
        hit_count: entry.hit_count,
        tags: entry.tags,
      },
      lineage: events.map(event => ({
        event_type: event.event_type,
        who: event.user_email || 'system',
        what: event.action || event.event_type,
        when: event.created_at,
        where: event.source_name || 'unknown',
        metadata: event.metadata,
      })),
      summary: {
        created_by: events.find(e => e.event_type === 'created')?.user_email || 'system',
        created_at: entry.created_at,
        last_accessed: events.find(e => e.event_type === 'accessed')?.created_at || entry.last_hit_at,
        access_count: entry.hit_count,
        invalidated: events.some(e => e.event_type === 'invalidated'),
        policy_changes: events.filter(e => e.event_type === 'policy_changed').length,
      },
    };
  } catch (err) {
    logger.error({ err: err.message }, '[getComprehensiveLineage] Error');
    return null;
  }
}

/**
 * Query lineage with filters
 * @param {string} appId - App ID
 * @param {object} filters - Filter options
 * @returns {Promise<object>} - Paginated lineage results
 */
export async function queryLineage(appId, filters = {}) {
  try {
    const {
      page = 1,
      limit = 50,
      event_type = null,
      source_id = null,
      user_id = null,
      from = null,
      to = null,
    } = filters;
    
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE le.app_id = $1';
    const params = [appId];
    let paramIndex = 2;
    
    if (event_type) {
      whereClause += ` AND le.event_type = $${paramIndex}`;
      params.push(event_type);
      paramIndex++;
    }
    
    if (source_id) {
      whereClause += ` AND le.source_id = $${paramIndex}`;
      params.push(source_id);
      paramIndex++;
    }
    
    if (user_id) {
      whereClause += ` AND le.user_id = $${paramIndex}`;
      params.push(user_id);
      paramIndex++;
    }
    
    if (from) {
      whereClause += ` AND le.created_at >= $${paramIndex}`;
      params.push(from);
      paramIndex++;
    }
    
    if (to) {
      whereClause += ` AND le.created_at <= $${paramIndex}`;
      params.push(to);
      paramIndex++;
    }
    
    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM lineage_events le ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0]?.count || 0, 10);
    
    // Get events
    params.push(limit, offset);
    const result = await query(
      `SELECT le.*, u.email as user_email, src.name as source_name, ce.cache_key, ce.request_url
       FROM lineage_events le
       LEFT JOIN users u ON le.user_id = u.id
       LEFT JOIN app_sources src ON le.source_id = src.id
       LEFT JOIN cache_entries ce ON le.cache_entry_id = ce.id
       ${whereClause}
       ORDER BY le.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );
    
    return {
      events: result.rows.map(row => {
        let metadata = null;
        if (row.metadata) {
          try {
            metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          } catch (parseErr) {
            // Log parse error but don't fail the entire function
            logger.error({ eventId: row.id, err: parseErr.message }, '[queryLineage] Failed to parse metadata');
            // Return null for metadata instead of failing
            metadata = null;
          }
        }
        return {
          ...row,
          metadata,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  } catch (err) {
    logger.error({ err: err.message }, '[queryLineage] Error querying lineage');
    // Return empty result instead of throwing to prevent 500 errors
    return {
      events: [],
      pagination: {
        page: filters.page || 1,
        limit: filters.limit || 50,
        total: 0,
        pages: 0,
      },
    };
  }
}

export default {
  logLineageEvent,
  getLineageForEntry,
  getLineageForCacheKey,
  getComprehensiveLineage,
  queryLineage,
};
