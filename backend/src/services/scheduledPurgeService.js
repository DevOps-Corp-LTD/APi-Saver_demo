import cron from 'node-cron';
import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { purgeExpiredEntries } from './cacheService.js';
import { logAudit } from './auditService.js';
import { getRedisClient, isRedisAvailable } from '../db/redis.js';

let scheduledJobs = new Map();

// Lock TTL in seconds (should be longer than expected job duration)
const LOCK_TTL_SECONDS = 300; // 5 minutes

/**
 * Validate cron expression
 * @param {string} cronExpression - Cron expression to validate
 * @returns {boolean} - True if valid
 */
function isValidCronExpression(cronExpression) {
  try {
    cron.validate(cronExpression);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquire a distributed lock using Redis
 * @param {string} lockKey - Lock key
 * @param {number} ttlSeconds - Lock TTL in seconds
 * @returns {boolean} - True if lock acquired
 */
async function acquireLock(lockKey, ttlSeconds = LOCK_TTL_SECONDS) {
  if (!isRedisAvailable()) {
    // No Redis = single instance, always acquire
    return true;
  }

  try {
    const redis = await getRedisClient();
    if (!redis) return true;

    // SET NX with TTL - atomic lock acquisition
    const result = await redis.set(lockKey, Date.now().toString(), {
      NX: true,
      EX: ttlSeconds,
    });

    return result === 'OK';
  } catch (err) {
    logger.error({ err }, 'Error acquiring lock');
    // On error, allow execution (single instance behavior)
    return true;
  }
}

/**
 * Release a distributed lock
 * @param {string} lockKey - Lock key
 */
async function releaseLock(lockKey) {
  if (!isRedisAvailable()) {
    return;
  }

  try {
    const redis = await getRedisClient();
    if (redis) {
      await redis.del(lockKey);
    }
  } catch (err) {
    logger.error({ err }, 'Error releasing lock');
  }
}

/**
 * Start scheduled purge job for a cache policy
 * @param {string} policyId - Policy ID
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID (optional)
 * @param {string} cronExpression - Cron expression
 */
function startScheduledPurge(policyId, appId, sourceId, cronExpression) {
  // Stop existing job if any
  stopScheduledPurge(policyId);

  if (!isValidCronExpression(cronExpression)) {
    logger.warn({ policyId, cronExpression }, 'Invalid cron expression for policy');
    return;
  }

  const task = cron.schedule(cronExpression, async () => {
    const lockKey = `purge-lock:${policyId}`;

    // Try to acquire lock (prevents duplicate runs across instances)
    const hasLock = await acquireLock(lockKey);
    if (!hasLock) {
      logger.debug({ policyId }, 'Skipping scheduled purge - another instance holds the lock');
      return;
    }

    try {
      logger.info({ policyId, appId, sourceId }, 'Running scheduled purge for policy');
      
      // Purge expired entries
      const purged = await purgeExpiredEntries();
      
      // Log audit entry
      await logAudit({
        app_id: appId,
        user_id: null, // System action
        action: 'cache_scheduled_purge',
        resource_type: 'cache',
        resource_id: sourceId,
        new_value: { 
          policy_id: policyId,
          cron_expression: cronExpression,
          entries_purged: purged 
        },
        ip_address: null,
      });

      logger.info({ policyId, purged }, 'Scheduled purge completed');
    } catch (error) {
      logger.error({ policyId, err: error }, 'Error in scheduled purge for policy');
    } finally {
      // Release lock after job completes
      await releaseLock(lockKey);
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  scheduledJobs.set(policyId, task);
  logger.info({ policyId, cronExpression }, 'Started scheduled purge for policy');
}

/**
 * Stop scheduled purge job for a cache policy
 * @param {string} policyId - Policy ID
 */
export function stopScheduledPurge(policyId) {
  const task = scheduledJobs.get(policyId);
  if (task) {
    task.stop();
    scheduledJobs.delete(policyId);
    logger.info({ policyId }, 'Stopped scheduled purge for policy');
  }
}

/**
 * Initialize all scheduled purge jobs from database
 */
export async function initializeScheduledPurges() {
  try {
    // Get all cache policies with purge schedules
    const result = await query(
      `SELECT id, app_id, source_id, purge_schedule
       FROM cache_policies
       WHERE purge_schedule IS NOT NULL AND purge_schedule != ''`
    );

    logger.info({ count: result.rows.length }, 'Initializing scheduled purge jobs');

    for (const policy of result.rows) {
      if (isValidCronExpression(policy.purge_schedule)) {
        startScheduledPurge(
          policy.id,
          policy.app_id,
          policy.source_id,
          policy.purge_schedule
        );
      } else {
        logger.warn({ policyId: policy.id, cronExpression: policy.purge_schedule }, 'Skipping invalid cron expression for policy');
      }
    }

    logger.info({ count: scheduledJobs.size }, 'Initialized scheduled purge jobs');
  } catch (error) {
    logger.error({ err: error }, 'Error initializing scheduled purges');
  }
}

/**
 * Update scheduled purge job for a policy
 * @param {string} policyId - Policy ID
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID (optional)
 * @param {string|null} cronExpression - Cron expression or null to stop
 */
export function updateScheduledPurge(policyId, appId, sourceId, cronExpression) {
  stopScheduledPurge(policyId);

  if (cronExpression && cronExpression.trim() !== '') {
    startScheduledPurge(policyId, appId, sourceId, cronExpression);
  }
}

/**
 * Stop all scheduled purge jobs
 */
export function stopAllScheduledPurges() {
  for (const [policyId] of scheduledJobs) {
    stopScheduledPurge(policyId);
  }
}

/**
 * Get status of all scheduled purge jobs
 * @returns {Array} - Array of job statuses
 */
export function getScheduledPurgeStatus() {
  return Array.from(scheduledJobs.entries()).map(([policyId, task]) => ({
    policyId,
    running: task.running || false,
  }));
}
