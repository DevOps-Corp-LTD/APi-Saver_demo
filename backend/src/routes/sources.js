import {
  getSourcesByAppId,
  getSourceById,
  createSource,
  createMultipleSources,
  getSourcesByCanonicalName,
  updateSource,
  deleteSource,
  testSourceConnectivity,
} from '../services/sourceService.js';
import { logAudit } from '../services/auditService.js';
import { validateUrl } from '../utils/urlValidation.js';
import { handleNotFoundError, handleValidationError, handleDatabaseError } from '../utils/errorHandler.js';

// Hard-coded demo limit - DO NOT make this configurable
const DEMO_MAX_SOURCES = 2;

export default async function sourcesRoutes(fastify) {
  // List sources
  fastify.get('/', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const sources = await getSourcesByAppId(request.appId);
    return { sources };
  });
  
  // Get source by ID
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
    const source = await getSourceById(request.params.id, request.appId);
    
    if (!source) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'Source not found',
      });
    }
    
    return source;
  });
  
  // Create source (admin only)
  fastify.post('/', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 255 },
          // Backward compatibility: single URL format
          base_url: { type: 'string', format: 'uri' },
          auth_type: { type: 'string', enum: ['none', 'bearer', 'api_key', 'basic'], default: 'none' },
          auth_config: { type: 'object' },
          headers: { type: 'object' },
          priority: { type: 'integer', default: 0 },
          timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000, default: 30000 },
          retry_count: { type: 'integer', minimum: 0, maximum: 10, default: 3 },
          circuit_breaker_threshold: { type: 'integer', minimum: 1, default: 5 },
          storage_mode: { type: 'string', enum: ['dedicated', 'shared'], default: 'dedicated' },
          storage_pool_id: { 
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'null' }
            ]
          },
          vary_headers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Headers to include in cache key (Vary rules)',
          },
          kill_switch_enabled: { type: 'boolean', default: false },
          bypass_bot_detection: { type: 'boolean', default: false },
          fallback_mode: { type: 'string', enum: ['none', 'mock', 'alternative_source'], default: 'none' },
          cost_per_request: { type: 'number', minimum: 0, maximum: 9999.9999 },
          is_active: { type: 'boolean', default: true },
          // New multi-URL format
          url_entries: {
            type: 'array',
            items: {
              type: 'object',
              required: ['base_url'],
              properties: {
                base_url: { type: 'string', format: 'uri' },
                auth_type: { type: 'string', enum: ['none', 'bearer', 'api_key', 'basic'], default: 'none' },
                auth_config: { type: 'object' },
                headers: { type: 'object' },
                priority: { type: 'integer', default: 0 },
                timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000, default: 30000 },
                retry_count: { type: 'integer', minimum: 0, maximum: 10, default: 3 },
                circuit_breaker_threshold: { type: 'integer', minimum: 1, default: 5 },
                fallback_mode: { type: 'string', enum: ['none', 'mock', 'alternative_source'], default: 'none' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
      // DEMO LIMIT VALIDATION - PRIMARY SECURITY LAYER
      // Check source count BEFORE any processing to prevent bypassing
      const existingSources = await getSourcesByAppId(request.appId);
      const currentCount = existingSources.length;
      const newSourcesCount = request.body.url_entries?.length || 1;

      if (currentCount + newSourcesCount > DEMO_MAX_SOURCES) {
        // Log the attempt
        await logAudit({
          app_id: request.appId,
          user_id: request.userId,
          action: 'demo_limit_exceeded',
          resource_type: 'source',
          resource_id: null,
          new_value: { attempted_count: newSourcesCount, current_count: currentCount },
          ip_address: request.ip,
        });
        
        return reply.status(403).send({
          error: 'Demo Limit Exceeded',
          message: 'Demo version is limited to 2 API sources. Please delete an existing source before adding a new one. To purchase the full version please contact services@devops-corp.com'
        });
      }

      try {
        // Check if this is multi-URL format (has url_entries)
        if (request.body.url_entries && Array.isArray(request.body.url_entries)) {
          // Multi-URL format
          if (request.body.url_entries.length === 0) {
            const { statusCode, response } = handleValidationError('url_entries array must contain at least one entry');
            return reply.status(statusCode).send(response);
          }

          // Validate: multi-URL sources must use shared storage
          if (request.body.url_entries.length > 1 && request.body.storage_mode === 'dedicated') {
            const { statusCode, response } = handleValidationError('Shared storage is required when using multiple URLs. All URLs in a multi-URL source must share the same cache pool.');
            return reply.status(statusCode).send(response);
          }

          // Validate all URLs
          for (const entry of request.body.url_entries) {
            try {
              validateUrl(entry.base_url);
            } catch (err) {
              const { statusCode, response } = handleValidationError(`Invalid base URL in entry: ${err.message}`);
              return reply.status(statusCode).send(response);
            }
          }

          // Validate storage mode
          if (request.body.storage_mode === 'shared' && !request.body.storage_pool_id) {
            const { statusCode, response } = handleValidationError('storage_pool_id is required when storage_mode is "shared"');
            return reply.status(statusCode).send(response);
          }

          // Validate pool exists if shared mode
          if (request.body.storage_mode === 'shared' && request.body.storage_pool_id) {
            const { getStoragePoolById } = await import('../services/storagePoolService.js');
            const pool = await getStoragePoolById(request.body.storage_pool_id, request.appId);
            if (!pool) {
              const { statusCode, response } = handleNotFoundError('Storage pool');
              return reply.status(statusCode).send(response);
            }
          }

          const sources = await createMultipleSources(request.appId, request.body, request.body.url_entries);

          // Log audit for each source
          for (const source of sources) {
            await logAudit({
              app_id: request.appId,
              user_id: request.userId,
              action: 'source_create',
              resource_type: 'source',
              resource_id: source.id,
              new_value: { name: source.name, base_url: source.base_url },
              ip_address: request.ip,
            });
          }

          return reply.status(201).send({ sources });
        } else {
          // Backward compatibility: single URL format
          if (!request.body.base_url) {
            const { statusCode, response } = handleValidationError('base_url is required for single URL format, or use url_entries for multi-URL format');
            return reply.status(statusCode).send(response);
          }

          // Validate base_url to prevent SSRF
          try {
            validateUrl(request.body.base_url);
          } catch (err) {
            const { statusCode, response } = handleValidationError(`Invalid base URL: ${err.message}`);
            return reply.status(statusCode).send(response);
          }
          
          // Validate storage mode
          if (request.body.storage_mode === 'shared' && !request.body.storage_pool_id) {
            const { statusCode, response } = handleValidationError('storage_pool_id is required when storage_mode is "shared"');
            return reply.status(statusCode).send(response);
          }
          
          // Validate pool exists if shared mode (and pool_id is provided)
          if (request.body.storage_mode === 'shared' && request.body.storage_pool_id) {
            const { getStoragePoolById } = await import('../services/storagePoolService.js');
            const pool = await getStoragePoolById(request.body.storage_pool_id, request.appId);
            if (!pool) {
              const { statusCode, response } = handleNotFoundError('Storage pool');
              return reply.status(statusCode).send(response);
            }
          }
          
          const source = await createSource(request.appId, request.body);
        
          await logAudit({
            app_id: request.appId,
            user_id: request.userId,
            action: 'source_create',
            resource_type: 'source',
            resource_id: source.id,
            new_value: { name: source.name, base_url: source.base_url },
            ip_address: request.ip,
          });
          
          return reply.status(201).send(source);
        }
    } catch (err) {
      if (err.code === '23505' || err.code === '23503' || err.code === '23502' || err.code === '42P01') {
        const { statusCode, response } = handleDatabaseError(err);
        return reply.status(statusCode).send(response);
      }
      throw err;
    }
  });
  
  // Update source (admin only)
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
          base_url: { type: 'string', format: 'uri' },
          auth_type: { type: 'string', enum: ['none', 'bearer', 'api_key', 'basic'] },
          auth_config: { type: 'object' },
          headers: { type: 'object' },
          priority: { type: 'integer' },
          timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000 },
          retry_count: { type: 'integer', minimum: 0, maximum: 10 },
          circuit_breaker_threshold: { type: 'integer', minimum: 1 },
          is_active: { type: 'boolean' },
          storage_mode: { type: 'string', enum: ['dedicated', 'shared'] },
          storage_pool_id: { 
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'null' }
            ]
          },
          vary_headers: {
            type: 'array',
            items: { type: 'string' },
            description: 'Headers to include in cache key (Vary rules)',
          },
          kill_switch_enabled: { type: 'boolean' },
          bypass_bot_detection: { type: 'boolean' },
          fallback_mode: { type: 'string', enum: ['none', 'mock', 'alternative_source'] },
          cost_per_request: { type: 'number', minimum: 0, maximum: 9999.9999 },
        },
      },
    },
  }, async (request, reply) => {
    const oldSource = await getSourceById(request.params.id, request.appId);
    
    if (!oldSource) {
      const { statusCode, response } = handleNotFoundError('Source');
      return reply.status(statusCode).send(response);
    }
    
    // Validate base_url if being updated
    if (request.body.base_url) {
      try {
        validateUrl(request.body.base_url);
      } catch (err) {
        const { statusCode, response } = handleValidationError(`Invalid base URL: ${err.message}`);
        return reply.status(statusCode).send(response);
      }
    }
    
    // Validate storage mode
    // Note: dedicated mode will automatically create a pool in updateSource()
    if (request.body.storage_mode === 'shared' && !request.body.storage_pool_id) {
      // Check if source already has a pool
      const currentSource = await getSourceById(request.params.id, request.appId);
      if (!currentSource?.storage_pool_id) {
        const { statusCode, response } = handleValidationError('storage_pool_id is required when storage_mode is "shared"');
        return reply.status(statusCode).send(response);
      }
    }
    
    // Validate pool exists if shared mode and pool_id is being set/changed
    if (request.body.storage_mode === 'shared' && request.body.storage_pool_id) {
      const { getStoragePoolById } = await import('../services/storagePoolService.js');
      const pool = await getStoragePoolById(request.body.storage_pool_id, request.appId);
      if (!pool) {
        const { statusCode, response } = handleNotFoundError('Storage pool');
        return reply.status(statusCode).send(response);
      }
    }
    
    const source = await updateSource(request.params.id, request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'source_update',
      resource_type: 'source',
      resource_id: source.id,
      old_value: { name: oldSource.name, base_url: oldSource.base_url, is_active: oldSource.is_active },
      new_value: request.body,
      ip_address: request.ip,
    });
    
    return source;
  });
  
  // Delete source (admin only)
  fastify.delete('/:id', {
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
    const source = await getSourceById(request.params.id, request.appId);
    
    if (!source) {
      const { statusCode, response } = handleNotFoundError('Source');
      return reply.status(statusCode).send(response);
    }
    
    await deleteSource(request.params.id, request.appId);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'source_delete',
      resource_type: 'source',
      resource_id: request.params.id,
      old_value: { name: source.name, base_url: source.base_url },
      ip_address: request.ip,
    });
    
    return { success: true };
  });
  
  // Test source connectivity (admin only)
  fastify.post('/:id/test', {
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
    const source = await getSourceById(request.params.id, request.appId);
    
    if (!source) {
      const { statusCode, response } = handleNotFoundError('Source');
      return reply.status(statusCode).send(response);
    }
    
    const result = await testSourceConnectivity(request.params.id, request.appId);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'source_test',
      resource_type: 'source',
      resource_id: request.params.id,
      new_value: result,
      ip_address: request.ip,
    });
    
    return result;
  });
}
