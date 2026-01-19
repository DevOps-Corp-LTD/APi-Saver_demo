import { getComplianceRules, upsertComplianceRules, checkCompliance } from '../services/complianceService.js';
import { logAudit } from '../services/auditService.js';
import { handleValidationError } from '../utils/errorHandler.js';

export default async function complianceRoutes(fastify) {
  // Get compliance rules for a source
  fastify.get('/compliance/rules', {
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
    
    if (!source_id) {
      const { statusCode, response } = handleValidationError('source_id is required');
      return reply.status(statusCode).send(response);
    }
    
    const rules = await getComplianceRules(request.appId, source_id);
    return { rules };
  });

  // Create or update compliance rules (admin only)
  fastify.post('/compliance/rules', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['source_id', 'rules'],
        properties: {
          source_id: { type: 'string', format: 'uuid' },
          rules: {
            type: 'object',
            properties: {
              region_constraints: { type: 'object' },
              pii_detection: { type: 'object' },
              tos_aware: { type: 'object' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { source_id, rules } = request.body;
    
    await upsertComplianceRules(request.appId, source_id, rules);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'compliance_rules_update',
      resource_type: 'compliance',
      resource_id: source_id,
      new_value: { rules },
      ip_address: request.ip,
    });
    
    return { success: true, source_id, rules };
  });

  // Check compliance for a request/response
  fastify.post('/compliance/check', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['source_id', 'request', 'response'],
        properties: {
          source_id: { type: 'string', format: 'uuid' },
          request: { type: 'object' },
          response: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { source_id, request: reqData, response: resData } = request.body;
    
    const result = await checkCompliance(request.appId, source_id, reqData, resData);
    return result;
  });
}
