import { getPolicyRules, storePolicyRules, evaluatePolicy } from '../services/policyEngineService.js';
import { logAudit } from '../services/auditService.js';
import { handleValidationError } from '../utils/errorHandler.js';

export default async function policiesRoutes(fastify) {
  // Get policy rules for a source
  fastify.get('/policies', {
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
    
    const rules = await getPolicyRules(request.appId, source_id);
    return { rules };
  });

  // Store policy rules (admin only)
  fastify.post('/policies', {
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
              ttl: { type: 'object' },
              cache: { type: 'object' },
              compliance: { type: 'object' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { source_id, rules } = request.body;
    
    await storePolicyRules(request.appId, source_id, rules);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'policy_rules_update',
      resource_type: 'policy',
      resource_id: source_id,
      new_value: { rules },
      ip_address: request.ip,
    });
    
    return { success: true, source_id, rules };
  });

  // Evaluate a policy
  fastify.post('/policies/evaluate', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['rule_type', 'context', 'policy'],
        properties: {
          rule_type: { type: 'string', enum: ['ttl', 'cache', 'compliance'] },
          context: { type: 'object' },
          policy: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    const { rule_type, context, policy } = request.body;
    
    const result = await evaluatePolicy(rule_type, context, policy);
    return { result };
  });
}
