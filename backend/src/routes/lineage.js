import { getLineageForEntry, getLineageForCacheKey, getComprehensiveLineage, queryLineage } from '../services/lineageService.js';
import { logAudit } from '../services/auditService.js';
import { handleNotFoundError } from '../utils/errorHandler.js';

export default async function lineageRoutes(fastify) {
  // Get lineage for a cache entry
  fastify.get('/lineage/entry/:id', {
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
      const lineage = await getLineageForEntry(request.appId, request.params.id);
      return { lineage };
    } catch (error) {
      fastify.log.error({ err: error, url: request.url }, 'Lineage entry query error');
      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to query lineage for entry',
      });
    }
  });
  
  // Get lineage for a cache key
  fastify.get('/lineage/key/:key', {
    preHandler: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const lineage = await getLineageForCacheKey(request.appId, request.params.key);
      return { lineage };
    } catch (error) {
      fastify.log.error({ err: error, url: request.url }, 'Lineage key query error');
      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to query lineage for cache key',
      });
    }
  });
  
  // Get comprehensive lineage
  fastify.get('/lineage/comprehensive/:id', {
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
      const comprehensive = await getComprehensiveLineage(request.appId, request.params.id);
      
      if (!comprehensive) {
        const { statusCode, response } = handleNotFoundError('Cache entry');
        return reply.status(statusCode).send(response);
      }
      
      return comprehensive;
    } catch (error) {
      fastify.log.error({ err: error, url: request.url }, 'Comprehensive lineage query error');
      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to query comprehensive lineage',
      });
    }
  });
  
  // Query lineage with filters
  fastify.get('/lineage', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          event_type: { type: 'string' },
          source_id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const filters = {
        page: request.query.page,
        limit: request.query.limit,
        event_type: request.query.event_type,
        source_id: request.query.source_id,
        user_id: request.query.user_id,
        from: request.query.from ? new Date(request.query.from) : null,
        to: request.query.to ? new Date(request.query.to) : null,
      };
      
      // Validate dates
      if (filters.from && isNaN(filters.from.getTime())) {
        return reply.status(400).send({
          error: 'InvalidDate',
          message: 'Invalid "from" date format',
        });
      }
      
      if (filters.to && isNaN(filters.to.getTime())) {
        return reply.status(400).send({
          error: 'InvalidDate',
          message: 'Invalid "to" date format',
        });
      }
      
      const result = await queryLineage(request.appId, filters);
      return result;
    } catch (error) {
      fastify.log.error({ err: error, url: request.url }, 'Lineage query error');
      return reply.status(500).send({
        error: 'InternalServerError',
        message: 'Failed to query lineage',
      });
    }
  });
}
