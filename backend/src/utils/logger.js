import pino from 'pino';
import config from '../config/index.js';

/**
 * Create a logger instance for use in services and utilities
 * Uses the same configuration as Fastify's logger
 */
const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? {
    target: 'pino-pretty',
    options: {
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname',
    },
  } : undefined,
});

export default logger;
