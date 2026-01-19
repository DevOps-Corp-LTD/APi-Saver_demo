import { getCostSavingsBySource, getCostSavingsTimeSeries } from '../services/costService.js';
import { logAudit } from '../services/auditService.js';
import { createErrorResponse } from '../utils/errorHandler.js';

export default async function costSavingsRoutes(fastify) {
  // Get cost savings data
  fastify.get('/', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          time_range: { 
            type: 'string', 
            enum: ['today', '7d', '30d', '90d', 'all'],
            default: 'all'
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { time_range = 'all' } = request.query;
      
      const data = await getCostSavingsBySource(request.appId, {
        time_range,
      });
      
      return data;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error getting cost savings');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve cost savings data',
      });
    }
  });
  
  // Get cost savings for specific source
  fastify.get('/sources/:id', {
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
          time_range: { 
            type: 'string', 
            enum: ['today', '7d', '30d', '90d', 'all'],
            default: 'all'
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { time_range = 'all' } = request.query;
      const { id: sourceId } = request.params;
      
      const data = await getCostSavingsBySource(request.appId, {
        time_range,
      });
      
      // Filter breakdown to only include the requested source
      const sourceBreakdown = data.breakdown.find(b => b.source_id === sourceId);
      
      if (!sourceBreakdown) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Source not found or has no cost data',
        });
      }
      
      // Recalculate summary for just this source
      return {
        summary: {
          total_saved: sourceBreakdown.total_saved,
          total_cached_requests: sourceBreakdown.cached_requests,
          total_api_calls: sourceBreakdown.api_calls_made,
          total_would_have_cost: sourceBreakdown.would_have_cost,
          overall_savings_percent: sourceBreakdown.savings_percent,
          avg_cost_per_request: sourceBreakdown.cost_per_request,
          currency: 'USD',
        },
        source: sourceBreakdown,
      };
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error getting source cost savings');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve source cost savings data',
      });
    }
  });
  
  // Export cost savings report
  fastify.get('/export', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          time_range: { 
            type: 'string', 
            enum: ['today', '7d', '30d', '90d', 'all'],
            default: 'all'
          },
          format: { 
            type: 'string', 
            enum: ['json', 'csv'],
            default: 'json'
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { time_range = 'all', format = 'json' } = request.query;
      
      const data = await getCostSavingsBySource(request.appId, {
        time_range,
      });
      
      if (format === 'csv') {
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="cost-savings-${Date.now()}.csv"`);
        
        const csvRows = [
          'Source Name,Cost Per Request,Cached Requests,API Calls Made,Total Saved,Would Have Cost,Savings %',
          ...data.breakdown.map(b => 
            `"${b.source_name}",${b.cost_per_request},${b.cached_requests},${b.api_calls_made},${b.total_saved},${b.would_have_cost},${b.savings_percent.toFixed(2)}%`
          ),
          `Total,,${data.summary.total_cached_requests},${data.summary.total_api_calls},${data.summary.total_saved},${data.summary.total_would_have_cost},${data.summary.overall_savings_percent.toFixed(2)}%`,
        ];
        
        return csvRows.join('\n');
      }
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'cost_savings_export',
        resource_type: 'report',
        new_value: { format, time_range },
        ip_address: request.ip,
      });
      
      return data;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error exporting cost savings');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to export cost savings data',
      });
    }
  });
  
  // Get cost savings time-series data
  fastify.get('/time-series', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          granularity: { 
            type: 'string', 
            enum: ['day', 'week', 'month'],
            default: 'day'
          },
          time_range: { 
            type: 'string', 
            enum: ['today', '7d', '30d', '90d', 'all'],
            default: '30d'
          },
          source_id: {
            type: 'string',
            format: 'uuid'
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { granularity = 'day', time_range = '30d', source_id = null } = request.query;
      
      const data = await getCostSavingsTimeSeries(request.appId, {
        granularity,
        time_range,
        source_id: source_id || null,
      });
      
      return data;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error getting cost savings time-series');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve cost savings time-series data',
      });
    }
  });
}

