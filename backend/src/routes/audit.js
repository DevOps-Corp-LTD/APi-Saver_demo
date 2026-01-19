import { getAuditLogs, getDistinctActions, getDistinctResourceTypes, exportAuditLogs, getAuditSummary } from '../services/auditService.js';
import { logAudit } from '../services/auditService.js';
import { handleValidationError } from '../utils/errorHandler.js';

export default async function auditRoutes(fastify) {
  // Get audit logs (admin only)
  fastify.get('/audit', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          action: { type: 'string' },
          resource_type: { type: 'string' },
          from: { type: 'string' }, // Allow empty strings, validate in handler
          to: { type: 'string' }, // Allow empty strings, validate in handler
        },
      },
    },
  }, async (request, reply) => {
    const { page, limit, action, resource_type, from, to } = request.query;
    
    // Convert empty strings to undefined for optional filters
    // Validate date format if provided
    let fromDate = from && from.trim() ? from : undefined;
    let toDate = to && to.trim() ? to : undefined;
    
    if (fromDate && isNaN(Date.parse(fromDate))) {
      const { statusCode, response } = handleValidationError('Invalid date format for "from" parameter');
      return reply.status(statusCode).send(response);
    }
    
    if (toDate && isNaN(Date.parse(toDate))) {
      const { statusCode, response } = handleValidationError('Invalid date format for "to" parameter');
      return reply.status(statusCode).send(response);
    }
    
    const filters = {
      page,
      limit,
      action: action && action.trim() ? action : undefined,
      resource_type: resource_type && resource_type.trim() ? resource_type : undefined,
      from: fromDate,
      to: toDate,
    };
    
    const result = await getAuditLogs(request.appId, filters);
    return result;
  });
  
  // Get filter options (admin only)
  fastify.get('/audit/filters', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
  }, async (request, reply) => {
    const [actions, resourceTypes] = await Promise.all([
      getDistinctActions(request.appId),
      getDistinctResourceTypes(request.appId),
    ]);
    
    return { actions, resource_types: resourceTypes };
  });
  
  // Export audit logs (admin only)
  fastify.get('/audit/export', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
          action: { type: 'string' },
          resource_type: { type: 'string' },
          from: { type: 'string' }, // Allow empty strings, validate in handler
          to: { type: 'string' }, // Allow empty strings, validate in handler
          limit: { type: 'integer', minimum: 1, maximum: 100000, default: 10000 },
        },
      },
    },
  }, async (request, reply) => {
    const { format, action, resource_type, from, to, limit } = request.query;
    
    // Convert empty strings to undefined for optional filters
    // Validate date format if provided
    let fromDate = from && from.trim() ? from : undefined;
    let toDate = to && to.trim() ? to : undefined;
    
    if (fromDate && isNaN(Date.parse(fromDate))) {
      const { statusCode, response } = handleValidationError('Invalid date format for "from" parameter');
      return reply.status(statusCode).send(response);
    }
    
    if (toDate && isNaN(Date.parse(toDate))) {
      const { statusCode, response } = handleValidationError('Invalid date format for "to" parameter');
      return reply.status(statusCode).send(response);
    }
    
    const filters = {
      format,
      limit,
      action: action && action.trim() ? action : undefined,
      resource_type: resource_type && resource_type.trim() ? resource_type : undefined,
      from: fromDate,
      to: toDate,
    };
    
    // Log the export action
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'audit_export',
      resource_type: 'audit',
      new_value: filters,
      ip_address: request.ip,
    });
    
    const result = await exportAuditLogs(request.appId, filters);
    
    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
      return result;
    }
    
    return result;
  });
  
  // Get audit summary (admin only)
  fastify.get('/audit/summary', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string' }, // Allow empty strings, validate in handler
          to: { type: 'string' }, // Allow empty strings, validate in handler
        },
      },
    },
  }, async (request, reply) => {
    const { from, to } = request.query;
    
    // Convert empty strings to undefined and validate date format
    let fromDate = from && from.trim() ? from : undefined;
    let toDate = to && to.trim() ? to : undefined;
    
    if (fromDate && isNaN(Date.parse(fromDate))) {
      const { statusCode, response } = handleValidationError('Invalid date format for "from" parameter');
      return reply.status(statusCode).send(response);
    }
    
    if (toDate && isNaN(Date.parse(toDate))) {
      const { statusCode, response } = handleValidationError('Invalid date format for "to" parameter');
      return reply.status(statusCode).send(response);
    }
    
    const filters = {
      from: fromDate,
      to: toDate,
    };
    
    const summary = await getAuditSummary(request.appId, filters);
    return summary;
  });
}

