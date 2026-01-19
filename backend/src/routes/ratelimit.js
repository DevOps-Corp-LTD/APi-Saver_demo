import { 
  getRateLimitRules, 
  getRateLimitRule, 
  createRateLimitRule, 
  updateRateLimitRule, 
  deleteRateLimitRule,
  getRateLimitStatus,
} from '../services/rateLimitService.js';
import { logAudit } from '../services/auditService.js';
import { handleNotFoundError, handleDatabaseError } from '../utils/errorHandler.js';

export default async function rateLimitRoutes(fastify) {
  // List rate limit rules
  fastify.get('/rate-limits', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const rules = await getRateLimitRules(request.appId);
    return { rules };
  });
  
  // Get single rate limit rule
  fastify.get('/rate-limits/:id', {
    preHandler: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const rule = await getRateLimitRule(request.params.id, request.appId);
    
    if (!rule) {
      const { statusCode, response } = handleNotFoundError('Rate limit rule');
      return reply.status(statusCode).send(response);
    }
    
    return rule;
  });
  
  // Create rate limit rule (admin only)
  fastify.post('/rate-limits', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        properties: {
          source_id: { type: 'string', format: 'uuid' },
          max_requests: { type: 'integer', minimum: 1, maximum: 1000000, default: 100 },
          window_seconds: { type: 'integer', minimum: 1, maximum: 86400, default: 60 },
          is_enabled: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const rule = await createRateLimitRule(request.appId, request.body);
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'rate_limit_create',
        resource_type: 'rate_limit',
        resource_id: rule.id,
        new_value: { source_id: rule.source_id, max_requests: rule.max_requests, window_seconds: rule.window_seconds },
        ip_address: request.ip,
      });
      
      return reply.status(201).send(rule);
    } catch (err) {
      if (err.code === '23505' || err.code === '23503' || err.code === '23502' || err.code === '42P01') {
        const { statusCode, response } = handleDatabaseError(err);
        return reply.status(statusCode).send(response);
      }
      throw err;
    }
  });
  
  // Update rate limit rule (admin only)
  fastify.patch('/rate-limits/:id', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          max_requests: { type: 'integer', minimum: 1, maximum: 1000000 },
          window_seconds: { type: 'integer', minimum: 1, maximum: 86400 },
          is_enabled: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const oldRule = await getRateLimitRule(request.params.id, request.appId);
    
    if (!oldRule) {
      const { statusCode, response } = handleNotFoundError('Rate limit rule');
      return reply.status(statusCode).send(response);
    }
    
    const rule = await updateRateLimitRule(request.params.id, request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'rate_limit_update',
      resource_type: 'rate_limit',
      resource_id: rule.id,
      old_value: { max_requests: oldRule.max_requests, window_seconds: oldRule.window_seconds },
      new_value: request.body,
      ip_address: request.ip,
    });
    
    return rule;
  });
  
  // Delete rate limit rule (admin only)
  fastify.delete('/rate-limits/:id', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const rule = await getRateLimitRule(request.params.id, request.appId);
    
    if (!rule) {
      const { statusCode, response } = handleNotFoundError('Rate limit rule');
      return reply.status(statusCode).send(response);
    }
    
    await deleteRateLimitRule(request.params.id, request.appId);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'rate_limit_delete',
      resource_type: 'rate_limit',
      resource_id: request.params.id,
      old_value: { source_id: rule.source_id, max_requests: rule.max_requests },
      ip_address: request.ip,
    });
    
    return { success: true };
  });
  
  // Get current rate limit status
  fastify.get('/rate-limits/status', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          source_id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { source_id } = request.query;
    const identifier = request.headers['x-api-key'] || request.ip;
    
    const status = await getRateLimitStatus(request.appId, source_id, identifier);
    return status;
  });
}
