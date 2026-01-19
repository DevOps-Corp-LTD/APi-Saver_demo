import { createClient } from 'redis';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let redisClient = null;
let isConnected = false;

/**
 * Get or create Redis client (singleton)
 * Returns null if REDIS_URL is not configured
 */
export async function getRedisClient() {
  if (!config.redisUrl) {
    return null;
  }

  if (redisClient && isConnected) {
    return redisClient;
  }

  try {
    redisClient = createClient({ url: config.redisUrl });

    redisClient.on('error', (err) => {
      logger.error({ err }, 'Redis client error');
      isConnected = false;
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
      isConnected = true;
    });

    redisClient.on('disconnect', () => {
      logger.info('Redis client disconnected');
      isConnected = false;
    });

    await redisClient.connect();
    return redisClient;
  } catch (err) {
    logger.error({ err }, 'Failed to connect to Redis');
    redisClient = null;
    isConnected = false;
    return null;
  }
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable() {
  return isConnected && redisClient !== null;
}

/**
 * Close Redis connection
 */
export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
  }
}

export default { getRedisClient, isRedisAvailable, closeRedis };

