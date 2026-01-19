import fp from 'fastify-plugin';
import { checkRateLimit } from '../services/rateLimitService.js';
import { getAppByApiKey } from '../services/appService.js';

/**
 * Database-based rate limiting plugin
 * Only applies rate limiting if rules are configured in the database
 */
async function rateLimitPlugin(fastify) {
  // Helper function to check rate limits
  async function checkRateLimits(request, reply) {
    // Skip rate limiting for health/readiness endpoints
    const url = request.raw?.url || request.url || '';
    if (url === '/health' || url === '/ready') {
      return;
    }

    // Try to get appId - it might be set by authentication middleware
    // or we can get it from API key for API key routes
    let appId = request.appId;
    
    // If appId not set yet, try to get it from API key (for API key routes)
    if (!appId) {
      const apiKey = request.headers['x-api-key'] || request.headers['authorization']?.replace('Bearer ', '');
      if (apiKey && !apiKey.startsWith('eyJ')) { // Not a JWT token
        try {
          const app = await getAppByApiKey(apiKey);
          if (app) {
            appId = app.id;
          }
        } catch (err) {
          // If we can't get app, skip rate limiting (auth will handle error)
          fastify.log.debug({ err }, 'Could not get app for rate limiting');
        }
      }
    }

    // Skip if we still don't have appId (route might not require auth)
    if (!appId) {
      return;
    }

    // Determine source ID if available (from route params or query)
    const sourceId = request.params?.sourceId || request.query?.source_id || null;
    
    // Use IP address or API key as identifier
    const identifier = request.ip || request.headers['x-api-key'] || 'default';

    try {
      const result = await checkRateLimit(appId, sourceId, identifier);

      // If no rule configured (limit is null), allow request
      if (result.limit === null) {
        return;
      }

      // If rate limit exceeded
      if (!result.allowed) {
        const retryAfter = result.reset || 1;
        
        reply.header('Retry-After', retryAfter);
        reply.header('X-RateLimit-Limit', result.limit);
        reply.header('X-RateLimit-Remaining', result.remaining);
        reply.header('X-RateLimit-Reset', retryAfter);
        
        return reply.status(429).send({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Rate limit exceeded, retry in ${retryAfter} seconds`,
        });
      }

      // Add rate limit headers for successful requests
      reply.header('X-RateLimit-Limit', result.limit);
      reply.header('X-RateLimit-Remaining', result.remaining);
      reply.header('X-RateLimit-Reset', result.reset);
    } catch (err) {
      // If error checking rate limit, log but allow request
      fastify.log.warn({ err, appId }, 'Rate limit check failed, allowing request');
    }
  }

  // Check rate limits in preValidation hook
  // This runs after authentication middleware (which typically runs in preHandler)
  // but before route handlers, ensuring appId is available from JWT or API key
  fastify.addHook('preValidation', checkRateLimits);
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  dependencies: ['auth'],
});

