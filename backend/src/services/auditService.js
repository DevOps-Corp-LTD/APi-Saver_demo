import { query } from '../db/pool.js';
import logger from '../utils/logger.js';

/**
 * Log an audit entry
 * @param {object} entry - Audit entry data
 * @returns {object} - Created audit log
 */
export async function logAudit(entry) {
  const {
    app_id,
    user_id = null,
    action,
    resource_type = null,
    resource_id = null,
    old_value = null,
    new_value = null,
    ip_address = null,
    user_agent = null,
  } = entry;
  
  // Scrub PII from values
  const scrubbed = {
    old_value: scrubPII(old_value),
    new_value: scrubPII(new_value),
  };
  
  const result = await query(
    `INSERT INTO audit_logs 
     (app_id, user_id, action, resource_type, resource_id, old_value, new_value, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [app_id, user_id, action, resource_type, resource_id, 
     scrubbed.old_value ? JSON.stringify(scrubbed.old_value) : null,
     scrubbed.new_value ? JSON.stringify(scrubbed.new_value) : null,
     ip_address, user_agent]
  );
  
  return result.rows[0];
}

/**
 * Get audit logs for an app with pagination
 * @param {string} appId - App ID
 * @param {object} options - Pagination and filter options
 * @returns {object} - Paginated audit logs
 */
export async function getAuditLogs(appId, options = {}) {
  const { page = 1, limit = 50, action = null, resource_type = null, from = null, to = null } = options;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE app_id = $1';
  const params = [appId];
  let paramIndex = 2;
  
  if (action) {
    whereClause += ` AND action = $${paramIndex}`;
    params.push(action);
    paramIndex++;
  }
  
  if (resource_type) {
    whereClause += ` AND resource_type = $${paramIndex}`;
    params.push(resource_type);
    paramIndex++;
  }
  
  if (from) {
    whereClause += ` AND created_at >= $${paramIndex}`;
    params.push(from);
    paramIndex++;
  }
  
  if (to) {
    whereClause += ` AND created_at <= $${paramIndex}`;
    params.push(to);
    paramIndex++;
  }
  
  // Get total count
  const countResult = await query(
    `SELECT COUNT(*) FROM audit_logs ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);
  
  // Get logs
  params.push(limit, offset);
  const result = await query(
    `SELECT * FROM audit_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );
  
  return {
    logs: result.rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get distinct actions for filtering
 * @param {string} appId - App ID
 * @returns {array} - List of distinct actions
 */
export async function getDistinctActions(appId) {
  const result = await query(
    `SELECT DISTINCT action FROM audit_logs WHERE app_id = $1 ORDER BY action`,
    [appId]
  );
  return result.rows.map(r => r.action);
}

/**
 * Get distinct resource types for filtering
 * @param {string} appId - App ID
 * @returns {array} - List of distinct resource types
 */
export async function getDistinctResourceTypes(appId) {
  const result = await query(
    `SELECT DISTINCT resource_type FROM audit_logs 
     WHERE app_id = $1 AND resource_type IS NOT NULL 
     ORDER BY resource_type`,
    [appId]
  );
  return result.rows.map(r => r.resource_type);
}

/**
 * Scrub PII from audit log values
 * @param {object} value - Value to scrub
 * @returns {object} - Scrubbed value
 */
function scrubPII(value) {
  if (!value) return null;
  if (typeof value !== 'object') return value;
  
  const sensitiveKeys = ['password', 'secret', 'token', 'api_key', 'auth_config', 'headers'];
  const scrubbed = { ...value };
  
  for (const key of Object.keys(scrubbed)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      scrubbed[key] = '[REDACTED]';
    } else if (typeof scrubbed[key] === 'object') {
      scrubbed[key] = scrubPII(scrubbed[key]);
    }
  }
  
  return scrubbed;
}

/**
 * Export audit logs as CSV or JSON
 * @param {string} appId - App ID
 * @param {object} options - Export options
 * @returns {object} - Export data
 */
export async function exportAuditLogs(appId, options = {}) {
  const { 
    format = 'json', 
    from = null, 
    to = null, 
    action = null, 
    resource_type = null,
    limit = 10000 
  } = options;
  
  let whereClause = 'WHERE app_id = $1';
  const params = [appId];
  let paramIndex = 2;
  
  if (action) {
    whereClause += ` AND action = $${paramIndex}`;
    params.push(action);
    paramIndex++;
  }
  
  if (resource_type) {
    whereClause += ` AND resource_type = $${paramIndex}`;
    params.push(resource_type);
    paramIndex++;
  }
  
  if (from) {
    whereClause += ` AND created_at >= $${paramIndex}`;
    params.push(from);
    paramIndex++;
  }
  
  if (to) {
    whereClause += ` AND created_at <= $${paramIndex}`;
    params.push(to);
    paramIndex++;
  }
  
  params.push(limit);
  
  const result = await query(
    `SELECT id, app_id, user_id, action, resource_type, resource_id, 
            old_value, new_value, ip_address, user_agent, created_at
     FROM audit_logs
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${paramIndex}`,
    params
  );
  
  if (format === 'csv') {
    return convertToCSV(result.rows);
  }
  
  return {
    format: 'json',
    count: result.rows.length,
    exported_at: new Date().toISOString(),
    logs: result.rows,
  };
}

/**
 * Convert audit logs to CSV format
 * @param {array} logs - Audit logs
 * @returns {string} - CSV string
 */
function convertToCSV(logs) {
  if (logs.length === 0) {
    return '';
  }
  
  const headers = [
    'id', 'app_id', 'user_id', 'action', 'resource_type', 'resource_id',
    'old_value', 'new_value', 'ip_address', 'user_agent', 'created_at'
  ];
  
  const csvRows = [headers.join(',')];
  
  for (const log of logs) {
    const values = headers.map(header => {
      let value = log[header];
      
      // Handle JSON fields
      if (typeof value === 'object' && value !== null) {
        value = JSON.stringify(value);
      }
      
      // Handle null
      if (value === null || value === undefined) {
        return '';
      }
      
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      value = String(value);
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = `"${value.replace(/"/g, '""')}"`;
      }
      
      return value;
    });
    
    csvRows.push(values.join(','));
  }
  
  return csvRows.join('\n');
}

/**
 * Send webhook notification for audit event
 * @param {object} webhookConfig - Webhook configuration
 * @param {object} auditEntry - Audit entry
 */
export async function sendWebhookNotification(webhookConfig, auditEntry) {
  if (!webhookConfig?.url) return;
  
  try {
    const response = await fetch(webhookConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(webhookConfig.secret && {
          'X-Webhook-Secret': webhookConfig.secret,
        }),
        ...webhookConfig.headers,
      },
      body: JSON.stringify({
        event: 'audit.created',
        timestamp: new Date().toISOString(),
        data: {
          id: auditEntry.id,
          action: auditEntry.action,
          resource_type: auditEntry.resource_type,
          resource_id: auditEntry.resource_id,
          user_id: auditEntry.user_id,
          created_at: auditEntry.created_at,
        },
      }),
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    
    if (!response.ok) {
      logger.error({ status: response.status }, 'Webhook notification failed');
    }
  } catch (error) {
    logger.error({ err: error.message }, 'Webhook notification error');
  }
}

/**
 * Get audit summary statistics
 * @param {string} appId - App ID
 * @param {object} options - Summary options
 * @returns {object} - Summary statistics
 */
export async function getAuditSummary(appId, options = {}) {
  const { from = null, to = null } = options;
  
  let whereClause = 'WHERE app_id = $1';
  const params = [appId];
  let paramIndex = 2;
  
  if (from) {
    whereClause += ` AND created_at >= $${paramIndex}`;
    params.push(from);
    paramIndex++;
  }
  
  if (to) {
    whereClause += ` AND created_at <= $${paramIndex}`;
    params.push(to);
    paramIndex++;
  }
  
  // Get counts by action
  const actionCounts = await query(
    `SELECT action, COUNT(*) as count
     FROM audit_logs
     ${whereClause}
     GROUP BY action
     ORDER BY count DESC`,
    params
  );
  
  // Get counts by resource type
  const resourceCounts = await query(
    `SELECT resource_type, COUNT(*) as count
     FROM audit_logs
     ${whereClause} AND resource_type IS NOT NULL
     GROUP BY resource_type
     ORDER BY count DESC`,
    params
  );
  
  // Get total count
  const totalCount = await query(
    `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
    params
  );
  
  // Get recent activity (last 24 hours by hour)
  const recentActivity = await query(
    `SELECT 
       date_trunc('hour', created_at) as hour,
       COUNT(*) as count
     FROM audit_logs
     ${whereClause} AND created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY date_trunc('hour', created_at)
     ORDER BY hour DESC`,
    params
  );
  
  return {
    total: parseInt(totalCount.rows[0].total, 10),
    by_action: actionCounts.rows.reduce((acc, row) => {
      acc[row.action] = parseInt(row.count, 10);
      return acc;
    }, {}),
    by_resource_type: resourceCounts.rows.reduce((acc, row) => {
      acc[row.resource_type] = parseInt(row.count, 10);
      return acc;
    }, {}),
    hourly_activity: recentActivity.rows.map(row => ({
      hour: row.hour,
      count: parseInt(row.count, 10),
    })),
  };
}

export default {
  logAudit,
  getAuditLogs,
  getDistinctActions,
  getDistinctResourceTypes,
  exportAuditLogs,
  sendWebhookNotification,
  getAuditSummary,
};

