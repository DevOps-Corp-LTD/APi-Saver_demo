import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { getRedisClient, isRedisAvailable } from '../db/redis.js';

// In-memory store for rate limit tracking (fallback when Redis unavailable)
const rateLimitStore = new Map();

// Clean up old entries every minute (in-memory only)
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (now > data.windowEnd) {
      rateLimitStore.delete(key);
    }
  }
}, 60 * 1000);

/**
 * Get rate limit rules for an app
 * @param {string} appId - App ID
 * @returns {array} - Rate limit rules
 */
export async function getRateLimitRules(appId) {
  const result = await query(
    `SELECT r.*, s.name as source_name
     FROM rate_limit_rules r
     LEFT JOIN app_sources s ON r.source_id = s.id
     WHERE r.app_id = $1
     ORDER BY r.created_at DESC`,
    [appId]
  );
  return result.rows;
}

/**
 * Get rate limit rule by ID
 * @param {string} ruleId - Rule ID
 * @param {string} appId - App ID
 * @returns {object|null} - Rule or null
 */
export async function getRateLimitRule(ruleId, appId) {
  const result = await query(
    `SELECT r.*, s.name as source_name
     FROM rate_limit_rules r
     LEFT JOIN app_sources s ON r.source_id = s.id
     WHERE r.id = $1 AND r.app_id = $2`,
    [ruleId, appId]
  );
  return result.rows[0] || null;
}

/**
 * Create a rate limit rule
 * @param {string} appId - App ID
 * @param {object} rule - Rule data
 * @returns {object} - Created rule
 */
export async function createRateLimitRule(appId, rule) {
  const {
    source_id = null,
    max_requests = 100,
    window_seconds = 60,
    is_enabled = true,
  } = rule;
  
  const result = await query(
    `INSERT INTO rate_limit_rules (app_id, source_id, max_requests, window_seconds, is_enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [appId, source_id, max_requests, window_seconds, is_enabled]
  );
  
  return result.rows[0];
}

/**
 * Update a rate limit rule
 * @param {string} ruleId - Rule ID
 * @param {string} appId - App ID
 * @param {object} updates - Fields to update
 * @returns {object|null} - Updated rule or null
 */
export async function updateRateLimitRule(ruleId, appId, updates) {
  const allowedFields = ['max_requests', 'window_seconds', 'is_enabled'];
  const setClause = [];
  const params = [ruleId, appId];
  let paramIndex = 3;
  
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      setClause.push(`${field} = $${paramIndex}`);
      params.push(updates[field]);
      paramIndex++;
    }
  }
  
  if (setClause.length === 0) {
    return getRateLimitRule(ruleId, appId);
  }
  
  setClause.push('updated_at = NOW()');
  
  const result = await query(
    `UPDATE rate_limit_rules SET ${setClause.join(', ')}
     WHERE id = $1 AND app_id = $2
     RETURNING *`,
    params
  );
  
  return result.rows[0] || null;
}

/**
 * Delete a rate limit rule
 * @param {string} ruleId - Rule ID
 * @param {string} appId - App ID
 * @returns {boolean} - Success
 */
export async function deleteRateLimitRule(ruleId, appId) {
  const result = await query(
    'DELETE FROM rate_limit_rules WHERE id = $1 AND app_id = $2',
    [ruleId, appId]
  );
  return result.rowCount > 0;
}

/**
 * Get rate limit rule for a source
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID (optional)
 * @returns {object|null} - Matching rule or null
 */
export async function getRuleForSource(appId, sourceId = null) {
  // First, try to find source-specific rule
  if (sourceId) {
    const sourceRule = await query(
      `SELECT * FROM rate_limit_rules 
       WHERE app_id = $1 AND source_id = $2 AND is_enabled = true`,
      [appId, sourceId]
    );
    
    if (sourceRule.rows[0]) {
      return sourceRule.rows[0];
    }
  }
  
  // Fall back to app-wide rule (source_id IS NULL)
  const appRule = await query(
    `SELECT * FROM rate_limit_rules 
     WHERE app_id = $1 AND source_id IS NULL AND is_enabled = true`,
    [appId]
  );
  
  return appRule.rows[0] || null;
}

/**
 * Check rate limit using Redis (distributed)
 */
async function checkRateLimitRedis(key, maxRequests, windowSeconds) {
  const redis = await getRedisClient();
  if (!redis) {
    return null; // Fallback to in-memory
  }

  try {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;

    // Increment counter with TTL
    const count = await redis.incr(windowKey);
    if (count === 1) {
      // Set expiry on first request in window
      await redis.expire(windowKey, windowSeconds + 1);
    }

    const remaining = Math.max(0, maxRequests - count);
    const resetIn = windowSeconds - Math.floor((now % windowMs) / 1000);

    return {
      allowed: count <= maxRequests,
      limit: maxRequests,
      remaining,
      reset: resetIn,
      window_seconds: windowSeconds,
    };
  } catch (err) {
    logger.error({ err }, 'Redis rate limit error, falling back to in-memory');
    return null; // Fallback to in-memory
  }
}

/**
 * Check rate limit using in-memory store (single instance)
 */
function checkRateLimitMemory(key, maxRequests, windowSeconds) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  let data = rateLimitStore.get(key);

  if (!data || now > data.windowEnd) {
    // Start new window
    data = {
      count: 0,
      windowStart: now,
      windowEnd: now + windowMs,
    };
  }

  data.count++;
  rateLimitStore.set(key, data);

  const remaining = Math.max(0, maxRequests - data.count);
  const resetIn = Math.ceil((data.windowEnd - now) / 1000);

  return {
    allowed: data.count <= maxRequests,
    limit: maxRequests,
    remaining,
    reset: resetIn,
    window_seconds: windowSeconds,
  };
}

/**
 * Check rate limit and update counter
 * Uses Redis if available, falls back to in-memory
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID (optional)
 * @param {string} identifier - Rate limit key identifier (e.g., IP or API key)
 * @returns {object} - Rate limit result
 */
export async function checkRateLimit(appId, sourceId = null, identifier = null) {
  const rule = await getRuleForSource(appId, sourceId);
  
  if (!rule) {
    // No rule configured, allow request
    return {
      allowed: true,
      limit: null,
      remaining: null,
      reset: null,
    };
  }
  
  const key = `${appId}:${sourceId || 'global'}:${identifier || 'default'}`;

  // Try Redis first for distributed rate limiting
  if (isRedisAvailable()) {
    const redisResult = await checkRateLimitRedis(key, rule.max_requests, rule.window_seconds);
    if (redisResult) {
      return redisResult;
    }
  }

  // Fallback to in-memory
  return checkRateLimitMemory(key, rule.max_requests, rule.window_seconds);
}

/**
 * Get rate limit status using Redis
 */
async function getRateLimitStatusRedis(key, maxRequests, windowSeconds) {
  const redis = await getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowKey = `ratelimit:${key}:${Math.floor(now / windowMs)}`;

    const count = parseInt(await redis.get(windowKey) || '0', 10);
    const remaining = Math.max(0, maxRequests - count);
    const resetIn = windowSeconds - Math.floor((now % windowMs) / 1000);

    return {
      configured: true,
      limit: maxRequests,
      remaining,
      reset: resetIn,
      current: count,
    };
  } catch (err) {
    logger.error({ err }, 'Redis rate limit status error');
    return null;
  }
}

/**
 * Get current rate limit status without incrementing
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID (optional)
 * @param {string} identifier - Rate limit key identifier
 * @returns {object} - Rate limit status
 */
export async function getRateLimitStatus(appId, sourceId = null, identifier = null) {
  const rule = await getRuleForSource(appId, sourceId);
  
  if (!rule) {
    return {
      configured: false,
      limit: null,
      remaining: null,
      reset: null,
    };
  }
  
  const key = `${appId}:${sourceId || 'global'}:${identifier || 'default'}`;

  // Try Redis first
  if (isRedisAvailable()) {
    const redisStatus = await getRateLimitStatusRedis(key, rule.max_requests, rule.window_seconds);
    if (redisStatus) {
      return redisStatus;
    }
  }

  // Fallback to in-memory
  const now = Date.now();
  const data = rateLimitStore.get(key);
  
  if (!data || now > data.windowEnd) {
    return {
      configured: true,
      limit: rule.max_requests,
      remaining: rule.max_requests,
      reset: rule.window_seconds,
    };
  }
  
  const remaining = Math.max(0, rule.max_requests - data.count);
  const resetIn = Math.ceil((data.windowEnd - now) / 1000);
  
  return {
    configured: true,
    limit: rule.max_requests,
    remaining,
    reset: resetIn,
    current: data.count,
  };
}

export default {
  getRateLimitRules,
  getRateLimitRule,
  createRateLimitRule,
  updateRateLimitRule,
  deleteRateLimitRule,
  getRuleForSource,
  checkRateLimit,
  getRateLimitStatus,
};
