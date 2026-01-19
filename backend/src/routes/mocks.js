import {
  getMockResponses,
  createMockResponse,
  updateMockResponse,
  deleteMockResponse,
} from '../services/mockService.js';
import { getSourceById } from '../services/sourceService.js';
import { logAudit } from '../services/auditService.js';
import { handleNotFoundError } from '../utils/errorHandler.js';

export default async function mocksRoutes(fastify) {
  // List mock responses for a source
  fastify.get('/mocks', {
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
    
    if (source_id) {
      // Verify source belongs to app
      const source = await getSourceById(source_id, request.appId);
      if (!source) {
        const { statusCode, response } = handleNotFoundError('Source');
        return reply.status(statusCode).send(response);
      }
      
      const mocks = await getMockResponses(request.appId, source_id);
      return { mocks };
    } else {
      // Return all mocks for the app
      const { query } = await import('../db/pool.js');
      const result = await query(
        `SELECT * FROM mock_responses WHERE app_id = $1 ORDER BY created_at DESC`,
        [request.appId]
      );
      return { mocks: result.rows };
    }
  });
  
  // Create mock response
  fastify.post('/mocks', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['source_id', 'name', 'request_method', 'request_url_pattern'],
        properties: {
          source_id: { type: 'string', format: 'uuid' },
          name: { type: 'string', minLength: 1, maxLength: 255 },
          request_method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
          request_url_pattern: { type: 'string' },
          request_body_pattern: { type: 'string' },
          response_status: { type: 'integer', default: 200 },
          response_headers: { type: 'object' },
          response_body: { type: ['object', 'string'] },
          response_body_raw: { type: 'string' },
          is_active: { type: 'boolean', default: true },
          priority: { type: 'integer', default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const source = await getSourceById(request.body.source_id, request.appId);
    if (!source) {
      const { statusCode, response } = handleNotFoundError('Source');
      return reply.status(statusCode).send(response);
    }
    
    const mock = await createMockResponse(request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'mock_create',
      resource_type: 'mock',
      resource_id: mock.id,
      new_value: { name: mock.name, source_id: mock.source_id },
      ip_address: request.ip,
    });
    
    return reply.status(201).send(mock);
  });
  
  // Update mock response
  fastify.patch('/mocks/:id', {
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
          name: { type: 'string' },
          request_method: { type: 'string' },
          request_url_pattern: { type: 'string' },
          request_body_pattern: { type: 'string' },
          response_status: { type: 'integer' },
          response_headers: { type: 'object' },
          response_body: { type: ['object', 'string'] },
          response_body_raw: { type: 'string' },
          is_active: { type: 'boolean' },
          priority: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const mock = await updateMockResponse(request.params.id, request.appId, request.body);
    
    if (!mock) {
      const { statusCode, response } = handleNotFoundError('Mock response');
      return reply.status(statusCode).send(response);
    }
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'mock_update',
      resource_type: 'mock',
      resource_id: mock.id,
      new_value: request.body,
      ip_address: request.ip,
    });
    
    return mock;
  });
  
  // Delete mock response
  fastify.delete('/mocks/:id', {
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
    const deleted = await deleteMockResponse(request.params.id, request.appId);
    
    if (!deleted) {
      const { statusCode, response } = handleNotFoundError('Mock response');
      return reply.status(statusCode).send(response);
    }
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'mock_delete',
      resource_type: 'mock',
      resource_id: request.params.id,
      ip_address: request.ip,
    });
    
    return { success: true };
  });
}
