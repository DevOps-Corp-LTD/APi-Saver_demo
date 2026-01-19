import {
  createStoragePool,
  getStoragePools,
  getStoragePoolById,
  updateStoragePool,
  deleteStoragePool,
  getPoolStatistics,
  getPoolSources,
  listPoolCacheEntries,
  purgePoolCacheEntries,
  bulkUpdatePoolCache,
  bulkUpdatePoolCacheByFilter,
} from '../services/storagePoolService.js';
import { listCacheEntries, purgeCache } from '../services/cacheService.js';
import { query } from '../db/pool.js';
import { logAudit } from '../services/auditService.js';
import { getAppInfo } from '../services/appService.js';
import { handleNotFoundError, handleValidationError, handleDatabaseError, createErrorResponse } from '../utils/errorHandler.js';

export default async function storagePoolsRoutes(fastify) {
  // List all storage pools
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const result = await getStoragePools(request.appId);
      return result;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error getting storage pools');
      const { statusCode, response } = createErrorResponse(err, {
        statusCode: 500,
        code: 'StoragePoolError',
      });
      return reply.status(statusCode).send(response);
    }
  });
  
  // Dedicated pool endpoints removed - each dedicated source now has its own pool
  
  // Get pool by ID
  fastify.get('/:id', {
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
    const pool = await getStoragePoolById(request.params.id, request.appId);
    
    if (!pool) {
      const { statusCode, response } = handleNotFoundError('Storage pool');
      return reply.status(statusCode).send(response);
    }
    
    return pool;
  });
  
  // Create storage pool (admin only)
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.appId) {
      const { statusCode, response } = handleValidationError('App ID is required. Please ensure you are properly authenticated.');
      return reply.status(statusCode).send(response);
    }
    
    // Verify app exists
    try {
      const app = await getAppInfo(request.appId);
      if (!app) {
        const { statusCode, response } = handleValidationError('Invalid app ID. Please ensure you are properly authenticated.');
        return reply.status(statusCode).send(response);
      }
    } catch (err) {
      const { statusCode, response } = handleValidationError('Invalid app ID. Please ensure you are properly authenticated.');
      return reply.status(statusCode).send(response);
    }
    
    try {
      const pool = await createStoragePool(request.appId, request.body);
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'storage_pool_create',
        resource_type: 'storage_pool',
        resource_id: pool.id,
        new_value: { name: pool.name, description: pool.description },
        ip_address: request.ip,
      });
      
      return reply.status(201).send(pool);
    } catch (err) {
      if (err.code === '23505' || err.code === '23503' || err.code === '23502' || err.code === '42P01') {
        const { statusCode, response } = handleDatabaseError(err);
        return reply.status(statusCode).send(response);
      }
      throw err;
    }
  });
  
  // Update storage pool (admin only)
  fastify.patch('/:id', {
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
          name: { type: 'string', minLength: 1, maxLength: 255 },
          description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const oldPool = await getStoragePoolById(request.params.id, request.appId);
    
    if (!oldPool) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Storage pool not found',
      });
    }
    
    const pool = await updateStoragePool(request.params.id, request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'storage_pool_update',
      resource_type: 'storage_pool',
      resource_id: pool.id,
      old_value: { name: oldPool.name, description: oldPool.description },
      new_value: request.body,
      ip_address: request.ip,
    });
    
    return pool;
  });
  
  // Delete storage pool (admin only)
  fastify.delete('/:id', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          purge_cache: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const pool = await getStoragePoolById(request.params.id, request.appId);
    
    if (!pool) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Storage pool not found',
      });
    }
    
    try {
      await deleteStoragePool(request.params.id, request.appId, {
        purge_cache: request.query.purge_cache === 'true',
      });
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'storage_pool_delete',
        resource_type: 'storage_pool',
        resource_id: request.params.id,
        old_value: { name: pool.name },
        ip_address: request.ip,
      });
      
      return { success: true };
    } catch (err) {
      if (err.message.includes('sources are still using it')) {
        const { statusCode, response } = createErrorResponse(err, {
          statusCode: 409,
          code: 'Conflict',
        });
        return reply.status(statusCode).send(response);
      }
      throw err;
    }
  });
  
  // Get pool statistics
  fastify.get('/:id/stats', {
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
    try {
      const pool = await getStoragePoolById(request.params.id, request.appId);
      
      if (!pool) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Storage pool not found',
        });
      }
      
      const stats = await getPoolStatistics(request.params.id, request.appId);
      return stats;
    } catch (err) {
      fastify.log.error({ err, poolId: request.params.id, appId: request.appId }, 'Error getting pool statistics');
      const { statusCode, response } = createErrorResponse(err, {
        statusCode: 500,
        code: 'PoolStatsError',
      });
      return reply.status(statusCode).send(response);
    }
  });
  
  // List cache entries in pool
  fastify.get('/:id/cache', {
    preHandler: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          expired: { type: 'boolean', default: false },
          source_id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const pool = await getStoragePoolById(request.params.id, request.appId);
      
      if (!pool) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Storage pool not found',
        });
      }
      
      const result = await listPoolCacheEntries(request.params.id, request.appId, {
        page: request.query.page,
        limit: request.query.limit,
        expired: request.query.expired,
        source_id: request.query.source_id,
      });
      
      return result;
    } catch (err) {
      fastify.log.error({ err, poolId: request.params.id, appId: request.appId }, 'Error listing pool cache entries');
      const { statusCode, response } = createErrorResponse(err, {
        statusCode: 500,
        code: 'CacheEntryError',
      });
      return reply.status(statusCode).send(response);
    }
  });
  
  // Purge pool cache (admin only)
  fastify.post('/:id/cache/purge', {
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
          source_id: { type: 'string', format: 'uuid' },
          expired_only: { type: 'boolean', default: false },
          url_pattern: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const pool = await getStoragePoolById(request.params.id, request.appId);
    
    if (!pool) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Storage pool not found',
      });
    }
    
    const purged = await purgePoolCacheEntries(request.params.id, request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'pool_cache_purge',
      resource_type: 'storage_pool',
      resource_id: request.params.id,
      new_value: { entries_purged: purged, options: request.body },
      ip_address: request.ip,
    });
    
    return { success: true, entries_purged: purged };
  });
  
  // Get pool sources
  fastify.get('/:id/sources', {
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
    const pool = await getStoragePoolById(request.params.id, request.appId);
    
    if (!pool) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Storage pool not found',
      });
    }
    
    const sources = await getPoolSources(request.params.id, request.appId);
    return { sources };
  });
}

