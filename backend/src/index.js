import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import csrfProtection from '@fastify/csrf-protection';
import config from './config/index.js';
import { runMigrations } from './db/migrate.js';
import { checkConnection } from './db/pool.js';
import { getRedisClient, closeRedis } from './db/redis.js';
import authPlugin from './plugins/auth.js';
import rateLimitPlugin from './plugins/rateLimit.js';

// Import routes
import healthRoutes from './routes/health.js';
import proxyRoutes from './routes/proxy.js';
import configRoutes from './routes/config.js';
import auditRoutes from './routes/audit.js';
import metricsRoutes from './routes/metrics.js';
import oidcRoutes from './routes/oidc.js';
import rateLimitRoutes from './routes/ratelimit.js';
import cachePolicyRoutes from './routes/cachepolicy.js';
import authRoutes from './routes/auth.js';
import dataRoutes from './routes/data.js';
import sourcesRoutes from './routes/sources.js';
import reportsRoutes from './routes/reports.js';
import mocksRoutes from './routes/mocks.js';
import lineageRoutes from './routes/lineage.js';
import storagePoolsRoutes from './routes/storagePools.js';
import policiesRoutes from './routes/policies.js';
import complianceRoutes from './routes/compliance.js';
import costSavingsRoutes from './routes/costSavings.js';
import { initializeScheduledPurges, stopAllScheduledPurges } from './services/scheduledPurgeService.js';

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: config.logLevel,
    transport: config.nodeEnv === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    } : undefined,
    serializers: {
      req: (req) => {
        // Remove sensitive headers from logs
        const sanitized = { ...req };
        if (sanitized.headers) {
          sanitized.headers = { ...sanitized.headers };
          // Mask API keys and authorization headers
          if (sanitized.headers['x-api-key']) {
            sanitized.headers['x-api-key'] = '[REDACTED]';
          }
          if (sanitized.headers['authorization']) {
            sanitized.headers['authorization'] = '[REDACTED]';
          }
        }
        return sanitized;
      },
    },
  },
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB limit
  requestIdHeader: 'x-request-id',
  requestIdLogLabel: 'reqId',
  disableRequestLogging: false,
});

// Register plugins
async function start() {
  try {
    // Check database connection
    const dbConnected = await checkConnection();
    if (!dbConnected) {
      fastify.log.error('Database connection failed');
      process.exit(1);
    }
    fastify.log.info('Database connected');

    // Run migrations
    await runMigrations();
    fastify.log.info('Migrations completed');

    // Initialize Redis if configured (for HA deployments)
    if (config.redisUrl) {
      const redis = await getRedisClient();
      if (redis) {
        fastify.log.info('Redis connected (HA mode enabled)');
      } else {
        fastify.log.warn('Redis configured but connection failed, falling back to single-instance mode');
      }
    } else {
      fastify.log.info('Redis not configured, running in single-instance mode');
    }

    // Initialize scheduled purge jobs
    await initializeScheduledPurges();
    fastify.log.info('Scheduled purge jobs initialized');

    // Security plugins
    await fastify.register(helmet, {
      contentSecurityPolicy: config.nodeEnv === 'production' ? {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
        },
      } : false, // Disable CSP in development for easier debugging
    });

    // CORS configuration - validate origins
    const allowedOrigins = Array.isArray(config.corsOrigins) 
      ? config.corsOrigins 
      : config.corsOrigins.split(',').map(s => s.trim());
    
    // Validate origins - reject wildcards in production
    if (config.nodeEnv === 'production') {
      const hasWildcard = allowedOrigins.some(origin => origin === '*' || origin === 'null');
      if (hasWildcard) {
        fastify.log.warn('CORS wildcard origins detected in production - this is insecure');
      }
    }
    
    await fastify.register(cors, {
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) {
          return callback(null, true);
        }
        
        // Check if origin is in allowed list
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        
        // Reject origin
        fastify.log.warn({ origin }, 'CORS request from disallowed origin');
        return callback(new Error('Not allowed by CORS'), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
    });

    await fastify.register(cookie, {
      secret: config.jwtSecret,
    });

    await fastify.register(jwt, {
      secret: config.jwtSecret,
      cookie: {
        cookieName: 'token',
        signed: true,
      },
    });

    await fastify.register(csrfProtection, {
      cookieOpts: {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
      },
    });

    // Auth plugin (must be registered before rate limit plugin)
    await fastify.register(authPlugin);

    // Database-based rate limiting plugin
    // Only applies rate limiting if rules are configured in the database
    // See /api/v1/rate-limits endpoint to configure rules
    await fastify.register(rateLimitPlugin);

    // Register routes
    await fastify.register(healthRoutes);
    await fastify.register(proxyRoutes, { prefix: '/api/v1' });
    await fastify.register(configRoutes, { prefix: '/api/v1' });
    await fastify.register(auditRoutes, { prefix: '/api/v1' });
    await fastify.register(metricsRoutes, { prefix: '/api/v1' });
    await fastify.register(oidcRoutes, { prefix: '/api/v1' });
    await fastify.register(rateLimitRoutes, { prefix: '/api/v1' });
    await fastify.register(cachePolicyRoutes, { prefix: '/api/v1' });
    await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(dataRoutes, { prefix: '/api/v1/data' });
  await fastify.register(sourcesRoutes, { prefix: '/api/v1/sources' });
  await fastify.register(reportsRoutes, { prefix: '/api/v1' });
  await fastify.register(mocksRoutes, { prefix: '/api/v1' });
  await fastify.register(lineageRoutes, { prefix: '/api/v1' });
  await fastify.register(policiesRoutes, { prefix: '/api/v1' });
  await fastify.register(complianceRoutes, { prefix: '/api/v1' });
    await fastify.register(storagePoolsRoutes, { prefix: '/api/v1/storage-pools' });
    await fastify.register(costSavingsRoutes, { prefix: '/api/v1/cost-savings' });

    // Global error handler - prevent information disclosure
    fastify.setErrorHandler((error, request, reply) => {
      // Log full error details server-side
      fastify.log.error({ 
        err: error, 
        url: request.url,
        method: request.method,
        ip: request.ip,
      }, 'Request error');
      
      // Generate request ID for tracing (if not already set)
      const requestId = request.id || `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      if (error.validation) {
        // Extract validation error messages
        const validationMessages = error.validation.map(err => {
          const field = err.instancePath || err.params?.missingProperty || err.params?.additionalProperty || 'body';
          return `${field}: ${err.message}`;
        }).join('; ');
        
        fastify.log.warn({ 
          validation: error.validation, 
          body: request.body,
          url: request.url 
        }, 'Validation error');
        
        return reply.status(400).send({
          error: 'Validation Error',
          message: validationMessages || 'Invalid request parameters',
          requestId: config.nodeEnv === 'development' ? requestId : undefined,
          details: config.nodeEnv === 'development' ? error.validation : undefined,
        });
      }

      if (error.statusCode && error.statusCode < 500) {
        // Client errors (4xx) - can include message but sanitize
        return reply.status(error.statusCode).send({
          error: error.name || 'Error',
          message: error.message || 'Request failed',
          requestId: config.nodeEnv === 'development' ? requestId : undefined,
        });
      }

      // Server errors (5xx) - never expose internal details
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
        requestId: config.nodeEnv === 'development' ? requestId : undefined,
      });
    });

    // Start server
    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    fastify.log.info(`Server listening on ${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// Handle shutdown gracefully
process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received, shutting down gracefully');
  stopAllScheduledPurges();
  await closeRedis();
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  fastify.log.info('SIGINT received, shutting down gracefully');
  stopAllScheduledPurges();
  await closeRedis();
  await fastify.close();
  process.exit(0);
});

start();
