import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { getConfigValue } from './configService.js';

/**
 * Get cost per API call for a source
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @returns {number} - Cost per API call in USD
 */
export async function getCostPerCall(appId, sourceId) {
  // First check if source has cost_per_request field set
  const sourceResult = await query(
    `SELECT cost_per_request FROM app_sources WHERE id = $1 AND app_id = $2`,
    [sourceId, appId]
  );
  
  if (sourceResult.rows[0]?.cost_per_request !== null && sourceResult.rows[0]?.cost_per_request !== undefined) {
    return parseFloat(sourceResult.rows[0].cost_per_request);
  }
  
  // Try to get source-specific cost from config (legacy)
  const sourceCost = await getConfigValue(appId, `source_${sourceId}_cost_per_call`);
  if (sourceCost) {
    return parseFloat(sourceCost);
  }
  
  // Try to get app-wide default cost
  const defaultCost = await getConfigValue(appId, 'cost_per_call');
  if (defaultCost) {
    return parseFloat(defaultCost);
  }
  
  // Return 0 if no cost configured
  return 0;
}

/**
 * Calculate saved cost from cache hits
 * @param {string} appId - App ID
 * @param {object} options - Calculation options
 * @returns {object} - Cost savings breakdown
 */
export async function calculateSavedCost(appId, options = {}) {
  try {
    const { source_id = null, time_range = null } = options;
    
    let whereClause = 'WHERE app_id = $1';
    const params = [appId];
    let paramIndex = 2;
    
    if (source_id) {
      whereClause += ` AND source_id = $${paramIndex}`;
      params.push(source_id);
      paramIndex++;
    }
    
    if (time_range) {
      const since = new Date();
      if (time_range.hours) {
        since.setHours(since.getHours() - time_range.hours);
      } else if (time_range.days) {
        since.setDate(since.getDate() - time_range.days);
      }
      whereClause += ` AND created_at >= $${paramIndex}`;
      params.push(since);
      paramIndex++;
    }
    
    // Get cache hits with source information
    const result = await query(
      `SELECT 
         ce.source_id,
         COALESCE(src.name, 'Unknown') as source_name,
         COALESCE(SUM(ce.hit_count), 0)::bigint as total_hits,
         COUNT(*)::bigint as entry_count
       FROM cache_entries ce
       LEFT JOIN app_sources src ON ce.source_id = src.id
       ${whereClause}
       GROUP BY ce.source_id, src.name`,
      params
    );
    
    let totalSavedCost = 0;
    const breakdown = [];
    
    for (const row of result.rows) {
      try {
        const costPerCall = await getCostPerCall(appId, row.source_id);
        const hits = parseInt(row.total_hits || 0, 10);
        const savedCost = hits * costPerCall;
        totalSavedCost += savedCost;
        
        breakdown.push({
          source_id: row.source_id,
          source_name: row.source_name || 'Unknown',
          hits: hits,
          cost_per_call: costPerCall,
          saved_cost: savedCost,
        });
      } catch (err) {
        logger.error({ sourceId: row.source_id, err: err.message }, '[calculateSavedCost] Error processing source');
        // Continue with next source
      }
    }
    
    return {
      total_saved_cost: totalSavedCost,
      breakdown: breakdown,
      currency: 'USD',
    };
  } catch (err) {
    logger.error({ err: err.message }, '[calculateSavedCost] Error calculating saved cost');
    // Return empty result instead of throwing
    return {
      total_saved_cost: 0,
      breakdown: [],
      currency: 'USD',
    };
  }
}

/**
 * Get cost metrics for an app
 * @param {string} appId - App ID
 * @returns {object} - Cost metrics
 */
export async function getCostMetrics(appId) {
  try {
    // Get total cache hits
    const hitsResult = await query(
      `SELECT 
         COALESCE(SUM(hit_count), 0)::bigint as total_hits,
         COUNT(*)::bigint as total_entries
       FROM cache_entries
       WHERE app_id = $1`,
      [appId]
    );
    
    const totalHits = Number(hitsResult.rows[0]?.total_hits || 0);
    const totalEntries = Number(hitsResult.rows[0]?.total_entries || 0);
    
    // Calculate saved cost
    let savedCost;
    try {
      savedCost = await calculateSavedCost(appId);
    } catch (err) {
      logger.error({ err: err.message }, '[getCostMetrics] Error calculating saved cost');
      savedCost = { breakdown: [], total_saved_cost: 0 };
    }
    
    // Get average cost per call across all sources
    let avgCostPerCall = 0;
    try {
      const sourcesResult = await query(
        `SELECT id FROM app_sources WHERE app_id = $1`,
        [appId]
      );
      
      let totalCostPerCall = 0;
      let sourceCount = 0;
      
      for (const source of sourcesResult.rows) {
        try {
          const cost = await getCostPerCall(appId, source.id);
          if (cost > 0) {
            totalCostPerCall += cost;
            sourceCount++;
          }
        } catch (err) {
          logger.error({ sourceId: source.id, err: err.message }, '[getCostMetrics] Error getting cost for source');
        }
      }
      
      avgCostPerCall = sourceCount > 0 ? totalCostPerCall / sourceCount : 0;
    } catch (err) {
      logger.error({ err: err.message }, '[getCostMetrics] Error getting sources');
    }
    
    return {
      total_hits: totalHits,
      total_entries: totalEntries,
      saved_cost: savedCost.total_saved_cost || 0,
      avg_cost_per_call: avgCostPerCall,
      cost_breakdown: savedCost.breakdown || [],
      currency: 'USD',
    };
  } catch (err) {
    logger.error({ err: err.message }, '[getCostMetrics] Error getting cost metrics');
    // Return default values instead of throwing
    return {
      total_hits: 0,
      total_entries: 0,
      saved_cost: 0,
      avg_cost_per_call: 0,
      cost_breakdown: [],
      currency: 'USD',
    };
  }
}

/**
 * Get cost savings breakdown by source with detailed metrics
 * @param {string} appId - App ID
 * @param {object} options - Calculation options
 * @returns {object} - Detailed cost savings breakdown
 */
export async function getCostSavingsBySource(appId, options = {}) {
  try {
    const { time_range = null } = options;
    
    let whereClause = 'WHERE ce.app_id = $1';
    const params = [appId];
    let paramIndex = 2;
    
    if (time_range) {
      const since = new Date();
      if (time_range === 'today') {
        since.setHours(0, 0, 0, 0);
      } else if (time_range === '7d') {
        since.setDate(since.getDate() - 7);
      } else if (time_range === '30d') {
        since.setDate(since.getDate() - 30);
      } else if (time_range === '90d') {
        since.setDate(since.getDate() - 90);
      }
      // 'all' doesn't add a time filter
      if (time_range !== 'all') {
        whereClause += ` AND ce.created_at >= $${paramIndex}`;
        params.push(since);
        paramIndex++;
      }
    }
    
    // Get cache statistics by source
    // Note on terminology:
    // - cached_requests = SUM(ce.hit_count) = total cache hits (requests served from cache)
    // - api_calls_made = COUNT(*) = number of cache entries = initial API calls that created cache entries
    // - Total requests = cached_requests + api_calls_made (when using cache-based calculation)
    // Handle case where cost_per_request column might not exist (use COALESCE)
    const result = await query(
      `SELECT 
         ce.source_id,
         COALESCE(src.name, 'Unknown') as source_name,
         COALESCE(src.cost_per_request, 0) as cost_per_request,
         COALESCE(SUM(ce.hit_count), 0)::bigint as cached_requests,
         COUNT(*)::bigint as api_calls_made
       FROM cache_entries ce
       LEFT JOIN app_sources src ON ce.source_id = src.id
       ${whereClause}
       GROUP BY ce.source_id, src.name, src.cost_per_request
       ORDER BY cached_requests DESC`,
      params
    );
    
    let totalSaved = 0;
    let totalCachedRequests = 0;
    let totalApiCalls = 0;
    let totalWouldHaveCost = 0;
    const breakdown = [];
    
    for (const row of result.rows) {
      // Get cost per request, fallback to getCostPerCall if not set in source
      let costPerRequest = 0;
      if (row.cost_per_request !== null && row.cost_per_request !== undefined && parseFloat(row.cost_per_request) > 0) {
        costPerRequest = parseFloat(row.cost_per_request);
      } else if (row.source_id) {
        try {
          costPerRequest = await getCostPerCall(appId, row.source_id);
        } catch (err) {
          logger.error({ sourceId: row.source_id, err: err.message }, '[getCostSavingsBySource] Error getting cost for source');
          costPerRequest = 0;
        }
      }
      
      // cached_requests = SUM(hit_count) = cache hits
      // api_calls_made = COUNT(*) = cache entries = initial API calls
      const cachedRequests = parseInt(row.cached_requests || 0, 10);
      const apiCallsMade = parseInt(row.api_calls_made || 0, 10);
      // Total saved = cache hits * cost per request (these requests didn't hit the API)
      const totalSavedForSource = cachedRequests * costPerRequest;
      // Would have cost = (cache hits + initial API calls) * cost per request
      const wouldHaveCost = (cachedRequests + apiCallsMade) * costPerRequest;
      const savingsPercent = wouldHaveCost > 0 ? (totalSavedForSource / wouldHaveCost) * 100 : 0;
      
      totalSaved += totalSavedForSource;
      totalCachedRequests += cachedRequests;
      totalApiCalls += apiCallsMade;
      totalWouldHaveCost += wouldHaveCost;
      
      breakdown.push({
        source_id: row.source_id,
        source_name: row.source_name || 'Unknown',
        cost_per_request: costPerRequest,
        cached_requests: cachedRequests,
        api_calls_made: apiCallsMade,
        total_saved: totalSavedForSource,
        would_have_cost: wouldHaveCost,
        savings_percent: savingsPercent,
      });
    }
    
    const overallSavingsPercent = totalWouldHaveCost > 0 
      ? (totalSaved / totalWouldHaveCost) * 100 
      : 0;
    
    // Calculate average cost per request
    const sourcesWithCost = breakdown.filter(b => b.cost_per_request > 0);
    const avgCostPerRequest = sourcesWithCost.length > 0
      ? sourcesWithCost.reduce((sum, b) => sum + b.cost_per_request, 0) / sourcesWithCost.length
      : 0;
    
    // Note: Total requests calculation is cache-based (total_cached_requests + total_api_calls)
    // This may differ from Dashboard's total requests if circuit breakers are used,
    // but is correct for cost savings calculations since we're calculating based on cache entries
    return {
      summary: {
        total_saved: totalSaved,
        total_cached_requests: totalCachedRequests, // SUM(hit_count) = cache hits
        total_api_calls: totalApiCalls, // COUNT(*) = cache entries = initial API calls
        total_would_have_cost: totalWouldHaveCost,
        overall_savings_percent: overallSavingsPercent,
        avg_cost_per_request: avgCostPerRequest,
        currency: 'USD',
      },
      breakdown,
    };
  } catch (err) {
    logger.error({ err: err.message }, '[getCostSavingsBySource] Error calculating cost savings');
    // Return empty result instead of throwing to prevent 500 errors
    return {
      summary: {
        total_saved: 0,
        total_cached_requests: 0,
        total_api_calls: 0,
        total_would_have_cost: 0,
        overall_savings_percent: 0,
        avg_cost_per_request: 0,
        currency: 'USD',
      },
      breakdown: [],
    };
  }
}

/**
 * Get cost savings time-series data grouped by day/week/month
 * @param {string} appId - App ID
 * @param {object} options - Calculation options
 * @returns {object} - Time-series cost savings data
 */
export async function getCostSavingsTimeSeries(appId, options = {}) {
  const { granularity = 'day', time_range = '30d', source_id = null } = options;
  
  // Determine DATE_TRUNC unit and date format
  let truncUnit, dateFormat;
  if (granularity === 'week') {
    truncUnit = 'week';
    dateFormat = 'YYYY-MM-DD'; // Start of week
  } else if (granularity === 'month') {
    truncUnit = 'month';
    dateFormat = 'YYYY-MM';
  } else {
    truncUnit = 'day';
    dateFormat = 'YYYY-MM-DD';
  }
  
  // Calculate date range
  // Note: For 'all', we don't add a time filter to match Dashboard behavior
  let whereClauseCreated = 'WHERE ce.app_id = $1';
  let whereClauseHits = 'WHERE ce.app_id = $1';
  const params = [appId];
  let paramIndex = 2;
  
  if (time_range !== 'all') {
    let since = new Date();
    if (time_range === 'today') {
      since.setHours(0, 0, 0, 0);
    } else if (time_range === '7d') {
      since.setDate(since.getDate() - 7);
    } else if (time_range === '30d') {
      since.setDate(since.getDate() - 30);
    } else if (time_range === '90d') {
      since.setDate(since.getDate() - 90);
    }
    whereClauseCreated += ` AND ce.created_at >= $${paramIndex}`;
    whereClauseHits += ` AND ce.last_hit_at >= $${paramIndex}`;
    params.push(since);
    paramIndex++;
  }
  
  if (source_id) {
    whereClauseCreated += ` AND ce.source_id = $${paramIndex}`;
    whereClauseHits += ` AND ce.source_id = $${paramIndex}`;
    params.push(source_id);
    paramIndex++;
  }
  
  // Query with DATE_TRUNC grouping
  // Note: DATE_TRUNC unit must be a literal, not a parameter, so we use string interpolation carefully
  // The truncUnit is validated to be one of: 'day', 'week', 'month' - safe for SQL
  // Note on terminology:
  // - cached_requests = SUM(ce.hit_count) = total cache hits
  // - api_calls_made = COUNT(*) = number of cache entries = initial API calls
  // 
  // For time series, we need to show hits when they occurred, not when entries were created.
  // We use a UNION approach:
  // 1. Group by created_at for new entries (api_calls_made) - these are the initial API calls
  // 2. Group by last_hit_at for hits (cached_requests) - attribute hits to when they last occurred
  //    Note: Since hit_count is cumulative, we attribute the full hit_count to the last_hit_at period
  //    This is an approximation, but better than attributing all hits to creation date
  const result = await query(
    `WITH created_entries AS (
      SELECT 
        DATE_TRUNC('${truncUnit}', ce.created_at) as period,
        ce.source_id,
        src.name as source_name,
        src.cost_per_request,
        0::bigint as cached_requests,
        COUNT(*)::bigint as api_calls_made
      FROM cache_entries ce
      LEFT JOIN app_sources src ON ce.source_id = src.id
      ${whereClauseCreated}
      GROUP BY period, ce.source_id, src.name, src.cost_per_request
    ),
    hit_entries AS (
      SELECT 
        DATE_TRUNC('${truncUnit}', ce.last_hit_at) as period,
        ce.source_id,
        src.name as source_name,
        src.cost_per_request,
        -- Count 1 hit per entry per period (since we only know last_hit_at, not individual hit timestamps)
        -- This gives us activity in each period without overcounting
        COUNT(*)::bigint as cached_requests,
        0::bigint as api_calls_made
      FROM cache_entries ce
      LEFT JOIN app_sources src ON ce.source_id = src.id
      ${whereClauseHits}
      AND ce.last_hit_at IS NOT NULL
      AND ce.hit_count > 0
      GROUP BY period, ce.source_id, src.name, src.cost_per_request
    )
    SELECT 
      period,
      source_id,
      source_name,
      cost_per_request,
      SUM(cached_requests)::bigint as cached_requests,
      SUM(api_calls_made)::bigint as api_calls_made
    FROM (
      SELECT * FROM created_entries
      UNION ALL
      SELECT * FROM hit_entries
    ) combined
    GROUP BY period, source_id, source_name, cost_per_request
    ORDER BY period ASC, source_id`,
    params
  );
  
  // Get all unique sources with their costs
  const sourceCosts = new Map();
  for (const row of result.rows) {
    if (!sourceCosts.has(row.source_id)) {
      const costPerRequest = row.cost_per_request !== null && row.cost_per_request !== undefined
        ? parseFloat(row.cost_per_request)
        : await getCostPerCall(appId, row.source_id);
      sourceCosts.set(row.source_id, {
        source_id: row.source_id,
        source_name: row.source_name || 'Unknown',
        cost_per_request: costPerRequest,
      });
    }
  }
  
  // Group by period and calculate costs
  const periodMap = new Map();
  
  for (const row of result.rows) {
    let periodKey;
    // PostgreSQL DATE_TRUNC returns a timestamp, we need to handle it properly
    // Convert to UTC date to avoid timezone issues
    const date = new Date(row.period);
    
    if (granularity === 'month') {
      // Format as YYYY-MM
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      periodKey = `${year}-${month}`;
    } else if (granularity === 'week') {
      // For week, DATE_TRUNC('week', ...) returns Monday of the week
      // Format as YYYY-MM-DD (start of week)
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      periodKey = `${year}-${month}-${day}`;
    } else {
      // day - Format as YYYY-MM-DD
      const year = date.getUTCFullYear();
      const month = String(date.getUTCMonth() + 1).padStart(2, '0');
      const day = String(date.getUTCDate()).padStart(2, '0');
      periodKey = `${year}-${month}-${day}`;
    }
    
    if (!periodMap.has(periodKey)) {
      periodMap.set(periodKey, {
        period: periodKey,
        total_saved: 0,
        total_cached_requests: 0,
        total_api_calls: 0,
        total_would_have_cost: 0,
        sources: new Map(),
      });
    }
    
    const periodData = periodMap.get(periodKey);
    const sourceInfo = sourceCosts.get(row.source_id);
    const costPerRequest = sourceInfo.cost_per_request;
    
    const cachedRequests = parseInt(row.cached_requests || 0, 10);
    const apiCallsMade = parseInt(row.api_calls_made || 0, 10);
    const savedForSource = cachedRequests * costPerRequest;
    const wouldHaveCostForSource = (cachedRequests + apiCallsMade) * costPerRequest;
    
    periodData.total_saved += savedForSource;
    periodData.total_cached_requests += cachedRequests;
    periodData.total_api_calls += apiCallsMade;
    periodData.total_would_have_cost += wouldHaveCostForSource;
    
    // Track per-source data for this period
    if (!periodData.sources.has(row.source_id)) {
      periodData.sources.set(row.source_id, {
        source_id: row.source_id,
        source_name: sourceInfo.source_name,
        cached_requests: 0,
        api_calls_made: 0,
        total_saved: 0,
        would_have_cost: 0,
      });
    }
    
    const sourceData = periodData.sources.get(row.source_id);
    sourceData.cached_requests += cachedRequests;
    sourceData.api_calls_made += apiCallsMade;
    sourceData.total_saved += savedForSource;
    sourceData.would_have_cost += wouldHaveCostForSource;
  }
  
  // Convert to array format
  const timeSeries = Array.from(periodMap.values())
    .map(period => ({
      period: period.period,
      total_saved: parseFloat(period.total_saved.toFixed(2)),
      total_cached_requests: period.total_cached_requests,
      total_api_calls: period.total_api_calls,
      total_would_have_cost: parseFloat(period.total_would_have_cost.toFixed(2)),
      savings_percent: period.total_would_have_cost > 0
        ? parseFloat(((period.total_saved / period.total_would_have_cost) * 100).toFixed(2))
        : 0,
      sources: Array.from(period.sources.values()),
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
  
  return {
    granularity,
    time_range,
    time_series: timeSeries,
    currency: 'USD',
  };
}

export default {
  getCostPerCall,
  calculateSavedCost,
  getCostMetrics,
  getCostSavingsBySource,
  getCostSavingsTimeSeries,
};
