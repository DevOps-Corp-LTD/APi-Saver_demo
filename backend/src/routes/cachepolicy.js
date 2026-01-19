import { 
  getCachePolicies, 
  getCachePolicyById, 
  upsertCachePolicy, 
  deleteCachePolicy,
  getCacheStatsWithPolicy,
  purgeExpiredEntries,
} from '../services/cachePolicyService.js';
import { logAudit } from '../services/auditService.js';
import { handleNotFoundError } from '../utils/errorHandler.js';

export default async function cachePolicyRoutes(fastify) {
  // List cache policies
  fastify.get('/cache-policies', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const policies = await getCachePolicies(request.appId);
    return { policies };
  });
  
  // Get single cache policy
  fastify.get('/cache-policies/:id', {
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
    const policy = await getCachePolicyById(request.params.id, request.appId);
    
    if (!policy) {
      const { statusCode, response } = handleNotFoundError('Cache policy');
      return reply.status(statusCode).send(response);
    }
    
    return policy;
  });
  
  // Create or update cache policy (admin only)
  fastify.put('/cache-policies', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        properties: {
          source_id: { type: 'string', format: 'uuid' },
          max_ttl_seconds: { type: 'integer', minimum: 0, maximum: 31536000, default: 86400 },
          no_cache: { type: 'boolean', default: false },
          purge_schedule: { 
            type: 'string', 
            pattern: '^([0-9,\\-\\*\\/]+\\s+){4}[0-9,\\-\\*\\/]+$',
            description: 'Cron expression (e.g., "0 2 * * *" for daily at 2 AM)',
          },
        },
      },
    },
  }, async (request, reply) => {
    const policy = await upsertCachePolicy(request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_policy_upsert',
      resource_type: 'cache_policy',
      resource_id: policy.id,
      new_value: { 
        source_id: policy.source_id, 
        max_ttl_seconds: policy.max_ttl_seconds,
        no_cache: policy.no_cache,
        purge_schedule: policy.purge_schedule,
      },
      ip_address: request.ip,
    });
    
    return policy;
  });
  
  // Delete cache policy (admin only)
  fastify.delete('/cache-policies/:id', {
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
    const policy = await getCachePolicyById(request.params.id, request.appId);
    
    if (!policy) {
      const { statusCode, response } = handleNotFoundError('Cache policy');
      return reply.status(statusCode).send(response);
    }
    
    await deleteCachePolicy(request.params.id, request.appId);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_policy_delete',
      resource_type: 'cache_policy',
      resource_id: request.params.id,
      old_value: { source_id: policy.source_id, max_ttl_seconds: policy.max_ttl_seconds },
      ip_address: request.ip,
    });
    
    return { success: true };
  });
  
  // Get cache statistics with policy info
  fastify.get('/cache-policies/stats', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const stats = await getCacheStatsWithPolicy(request.appId);
    return stats;
  });
  
  // Trigger manual expired entries cleanup (admin only)
  fastify.post('/cache-policies/cleanup', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
  }, async (request, reply) => {
    const purged = await purgeExpiredEntries();
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_cleanup',
      resource_type: 'cache',
      new_value: { entries_purged: purged },
      ip_address: request.ip,
    });
    
    return { success: true, entries_purged: purged };
  });
}
