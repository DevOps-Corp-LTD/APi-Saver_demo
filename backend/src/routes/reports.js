import { query } from '../db/pool.js';
import { calculateSavedCost, getCostMetrics } from '../services/costService.js';
import { getComplianceRules } from '../services/complianceService.js';
import { logAudit } from '../services/auditService.js';

export default async function reportsRoutes(fastify) {
  // Cost report
  fastify.get('/reports/cost', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          source_id: { type: 'string', format: 'uuid' },
          from: { type: 'string' },
          to: { type: 'string' },
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { source_id, from, to, format = 'json' } = request.query;
      
      let timeRange = null;
      if (from || to) {
        timeRange = {};
        if (from) {
          const fromDate = new Date(from);
          const now = new Date();
          const diffMs = now - fromDate;
          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          if (diffDays > 0) {
            timeRange.days = diffDays;
          } else {
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            timeRange.hours = diffHours;
          }
        }
      }
      
      const savedCost = await calculateSavedCost(request.appId, {
        source_id,
        time_range: timeRange,
      });
      
      const costMetrics = await getCostMetrics(request.appId);
      
      const report = {
        period: {
          from: from || null,
          to: to || new Date().toISOString(),
        },
        summary: {
          total_saved_cost: savedCost.total_saved_cost || 0,
          total_hits: costMetrics.total_hits || 0,
          avg_cost_per_call: costMetrics.avg_cost_per_call || 0,
          currency: 'USD',
        },
        breakdown: savedCost.breakdown || [],
        generated_at: new Date().toISOString(),
      };
      
      if (format === 'csv') {
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="cost-report-${Date.now()}.csv"`);
        
        const csvRows = [
          'Source,Total Hits,Cost Per Call,Saved Cost',
          ...(savedCost.breakdown || []).map(b => 
            `"${b.source_name || 'Unknown'}",${b.hits || 0},${b.cost_per_call || 0},${b.saved_cost || 0}`
          ),
          `Total,,,${savedCost.total_saved_cost || 0}`,
        ];
        
        return csvRows.join('\n');
      }
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'report_cost_export',
        resource_type: 'report',
        new_value: { format, source_id },
        ip_address: request.ip,
      });
      
      return report;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error generating cost report');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to generate cost report',
      });
    }
  });
  
  // Compliance report
  fastify.get('/reports/compliance', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          source_id: { type: 'string', format: 'uuid' },
          from: { type: 'string' },
          to: { type: 'string' },
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        },
      },
    },
  }, async (request, reply) => {
    const { source_id, from, to, format = 'json' } = request.query;
    
    // Get compliance rules
    let complianceData = [];
    if (source_id) {
      const rules = await getComplianceRules(request.appId, source_id);
      if (rules) {
        complianceData.push({
          source_id,
          rules,
        });
      }
    } else {
      // Get all sources with compliance rules
      const result = await query(
        `SELECT cr.*, src.name as source_name
         FROM compliance_rules cr
         LEFT JOIN app_sources src ON cr.source_id = src.id
         WHERE cr.app_id = $1`,
        [request.appId]
      );
      complianceData = result.rows;
    }
    
    // Get cache entries blocked by compliance
    let whereClause = 'WHERE ce.app_id = $1';
    const params = [request.appId];
    let paramIndex = 2;
    
    if (source_id) {
      whereClause += ` AND ce.source_id = $${paramIndex}`;
      params.push(source_id);
      paramIndex++;
    }
    
    if (from) {
      whereClause += ` AND ce.created_at >= $${paramIndex}`;
      params.push(new Date(from));
      paramIndex++;
    }
    
    if (to) {
      whereClause += ` AND ce.created_at <= $${paramIndex}`;
      params.push(new Date(to));
      paramIndex++;
    }
    
    const cacheStats = await query(
      `SELECT 
         COUNT(*) as total_entries,
         COUNT(DISTINCT ce.source_id) as sources_count
       FROM cache_entries ce
       ${whereClause}`,
      params
    );
    
    const report = {
      period: {
        from: from || null,
        to: to || new Date().toISOString(),
      },
      compliance_rules: complianceData,
      cache_statistics: {
        total_entries: parseInt(cacheStats.rows[0]?.total_entries || 0, 10),
        sources_count: parseInt(cacheStats.rows[0]?.sources_count || 0, 10),
      },
      generated_at: new Date().toISOString(),
    };
    
    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="compliance-report-${Date.now()}.csv"`);
      
      const csvRows = [
        'Source,Region Constraints,PII Detection,TOS Aware',
        ...complianceData.map(d => 
          `"${d.source_name || d.source_id}",${d.region_constraints ? 'Yes' : 'No'},${d.pii_detection?.enabled ? 'Yes' : 'No'},${d.tos_aware?.enabled ? 'Yes' : 'No'}`
        ),
      ];
      
      return csvRows.join('\n');
    }
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'report_compliance_export',
      resource_type: 'report',
      new_value: { format, source_id },
      ip_address: request.ip,
    });
    
    return report;
  });
  
  // Usage report (for legal/audit purposes)
  fastify.get('/reports/usage', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          source_id: { type: 'string', format: 'uuid' },
          format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
        },
      },
    },
  }, async (request, reply) => {
    const { from, to, source_id, format = 'json' } = request.query;
    
    let whereClause = 'WHERE ce.app_id = $1';
    const params = [request.appId];
    let paramIndex = 2;
    
    if (source_id) {
      whereClause += ` AND ce.source_id = $${paramIndex}`;
      params.push(source_id);
      paramIndex++;
    }
    
    if (from) {
      whereClause += ` AND ce.created_at >= $${paramIndex}`;
      params.push(new Date(from));
      paramIndex++;
    }
    
    if (to) {
      whereClause += ` AND ce.created_at <= $${paramIndex}`;
      params.push(new Date(to));
      paramIndex++;
    }
    
    // Get usage statistics
    const usageStats = await query(
      `SELECT 
         COUNT(*) as total_entries,
         COALESCE(SUM(hit_count), 0) as total_hits,
         COUNT(DISTINCT source_id) as sources_used,
         MIN(created_at) as first_usage,
         MAX(created_at) as last_usage
       FROM cache_entries ce
       ${whereClause}`,
      params
    );
    
    // Get source breakdown
    const sourceBreakdown = await query(
      `SELECT 
         src.id as source_id,
         src.name as source_name,
         COUNT(ce.id) as entries,
         COALESCE(SUM(ce.hit_count), 0) as hits
       FROM cache_entries ce
       LEFT JOIN app_sources src ON ce.source_id = src.id
       ${whereClause}
       GROUP BY src.id, src.name
       ORDER BY hits DESC`,
      params
    );
    
    const stats = usageStats.rows[0] || {};
    
    const report = {
      period: {
        from: from || null,
        to: to || new Date().toISOString(),
      },
      summary: {
        total_entries: parseInt(stats.total_entries || 0, 10),
        total_hits: parseInt(stats.total_hits || 0, 10),
        sources_used: parseInt(stats.sources_used || 0, 10),
        first_usage: stats.first_usage,
        last_usage: stats.last_usage,
      },
      source_breakdown: sourceBreakdown.rows,
      generated_at: new Date().toISOString(),
    };
    
    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="usage-report-${Date.now()}.csv"`);
      
      const csvRows = [
        'Source,Entries,Total Hits',
        ...sourceBreakdown.rows.map(r => 
          `"${r.source_name || 'Unknown'}",${r.entries},${r.hits}`
        ),
        `Total,${stats.total_entries},${stats.total_hits}`,
      ];
      
      return csvRows.join('\n');
    }
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'report_usage_export',
      resource_type: 'report',
      new_value: { format, source_id },
      ip_address: request.ip,
    });
    
    return report;
  });
}
