import { query } from '../db/pool.js';

/**
 * Simple PII detection (can be enhanced)
 * @param {any} data - Data to check for PII
 * @returns {boolean} - True if PII detected
 */
function detectPII(data) {
  if (!data) return false;
  
  const dataString = typeof data === 'string' ? data : JSON.stringify(data);
  const lowerData = dataString.toLowerCase();
  
  // Simple patterns for PII detection
  const piiPatterns = [
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/, // Credit card
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
    /\b\d{3}-\d{3}-\d{4}\b/, // Phone
  ];
  
  return piiPatterns.some(pattern => pattern.test(lowerData));
}

/**
 * Cache Compliance Engine
 * Handles TOS-aware caching, region constraints, and PII handling
 */

/**
 * Check compliance rules before caching
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @param {object} request - Request context
 * @param {object} response - Response context
 * @returns {object} - Compliance check result
 */
export async function checkCompliance(appId, sourceId, request, response) {
  // Get compliance rules for source
  const complianceRules = await getComplianceRules(appId, sourceId);
  
  if (!complianceRules) {
    return { allowed: true, reason: 'No compliance rules configured' };
  }
  
  const checks = [];
  
  // Check region constraints
  if (complianceRules.region_constraints) {
    const regionCheck = checkRegionConstraints(request, complianceRules.region_constraints);
    checks.push(regionCheck);
    if (!regionCheck.allowed) {
      return { allowed: false, reason: regionCheck.reason, checks };
    }
  }
  
  // Check PII detection
  if (complianceRules.pii_detection && complianceRules.pii_detection.enabled) {
    const piiCheck = checkPII(response, complianceRules.pii_detection);
    checks.push(piiCheck);
    if (!piiCheck.allowed) {
      return { allowed: false, reason: piiCheck.reason, checks };
    }
  }
  
  // Check TOS-aware rules
  if (complianceRules.tos_aware && complianceRules.tos_aware.enabled) {
    const tosCheck = await checkTOSRules(appId, sourceId, request, response, complianceRules.tos_aware);
    checks.push(tosCheck);
    if (!tosCheck.allowed) {
      return { allowed: false, reason: tosCheck.reason, checks };
    }
  }
  
  return { allowed: true, checks };
}

/**
 * Check region constraints
 * @param {object} request - Request context
 * @param {object} constraints - Region constraints
 * @returns {object} - Check result
 */
function checkRegionConstraints(request, constraints) {
  const { allowed_regions, blocked_regions } = constraints;
  const requestRegion = request.region || request.headers?.['x-region'] || 'default';
  
  if (blocked_regions && Array.isArray(blocked_regions) && blocked_regions.includes(requestRegion)) {
    return {
      allowed: false,
      reason: `Region ${requestRegion} is blocked by compliance policy`,
      check_type: 'region',
    };
  }
  
  if (allowed_regions && Array.isArray(allowed_regions) && !allowed_regions.includes(requestRegion)) {
    return {
      allowed: false,
      reason: `Region ${requestRegion} is not in allowed regions list`,
      check_type: 'region',
    };
  }
  
  return {
    allowed: true,
    check_type: 'region',
    region: requestRegion,
  };
}

/**
 * Check PII in response
 * @param {object} response - Response context
 * @param {object} piiConfig - PII detection configuration
 * @returns {object} - Check result
 */
function checkPII(response, piiConfig) {
  const { block_caching, allowed_types } = piiConfig;
  const responseBody = response.body || response.data;
  
  if (!responseBody) {
    return { allowed: true, check_type: 'pii' };
  }
  
  const hasPII = detectPII(responseBody);
  
  if (hasPII && block_caching) {
    return {
      allowed: false,
      reason: 'PII detected in response, caching blocked by compliance policy',
      check_type: 'pii',
      pii_detected: true,
    };
  }
  
  return {
    allowed: true,
    check_type: 'pii',
    pii_detected: hasPII,
  };
}

/**
 * Check TOS-aware rules
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @param {object} request - Request context
 * @param {object} response - Response context
 * @param {object} tosConfig - TOS configuration
 * @returns {Promise<object>} - Check result
 */
async function checkTOSRules(appId, sourceId, request, response, tosConfig) {
  // Get TOS rules for source
  const tosRules = await getTOSRules(appId, sourceId);
  
  if (!tosRules || tosRules.length === 0) {
    return { allowed: true, check_type: 'tos' };
  }
  
  // Check each TOS rule
  for (const rule of tosRules) {
    if (rule.block_caching && matchesTOSRule(request, response, rule)) {
      return {
        allowed: false,
        reason: `TOS rule "${rule.name}" blocks caching`,
        check_type: 'tos',
        rule_id: rule.id,
      };
    }
  }
  
  return { allowed: true, check_type: 'tos' };
}

/**
 * Check if request/response matches a TOS rule
 * @param {object} request - Request context
 * @param {object} response - Response context
 * @param {object} rule - TOS rule
 * @returns {boolean} - True if matches
 */
function matchesTOSRule(request, response, rule) {
  // Check URL pattern
  if (rule.url_pattern) {
    const urlPattern = new RegExp(rule.url_pattern);
    if (!urlPattern.test(request.url)) {
      return false;
    }
  }
  
  // Check method
  if (rule.methods && !rule.methods.includes(request.method)) {
    return false;
  }
  
  // Check status code
  if (rule.status_codes && !rule.status_codes.includes(response.status)) {
    return false;
  }
  
  return true;
}

/**
 * Get compliance rules for a source
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @returns {Promise<object|null>} - Compliance rules or null
 */
export async function getComplianceRules(appId, sourceId) {
  const result = await query(
    `SELECT * FROM compliance_rules
     WHERE app_id = $1 AND source_id = $2`,
    [appId, sourceId]
  );
  
  if (result.rows.length === 0) {
    return null;
  }
  
  const row = result.rows[0];
  return {
    region_constraints: row.region_constraints,
    pii_detection: row.pii_detection,
    tos_aware: row.tos_aware,
  };
}

/**
 * Get TOS rules for a source
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @returns {Promise<array>} - Array of TOS rules
 */
async function getTOSRules(appId, sourceId) {
  const result = await query(
    `SELECT * FROM tos_rules
     WHERE app_id = $1 AND source_id = $2 AND is_enabled = true
     ORDER BY priority ASC`,
    [appId, sourceId]
  );
  
  return result.rows;
}

/**
 * Create or update compliance rules
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @param {object} rules - Compliance rules
 */
export async function upsertComplianceRules(appId, sourceId, rules) {
  await query(
    `INSERT INTO compliance_rules (app_id, source_id, region_constraints, pii_detection, tos_aware)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (app_id, source_id) DO UPDATE SET
       region_constraints = EXCLUDED.region_constraints,
       pii_detection = EXCLUDED.pii_detection,
       tos_aware = EXCLUDED.tos_aware,
       updated_at = NOW()`,
    [
      appId,
      sourceId,
      JSON.stringify(rules.region_constraints || null),
      JSON.stringify(rules.pii_detection || null),
      JSON.stringify(rules.tos_aware || null),
    ]
  );
}

export default {
  checkCompliance,
  getComplianceRules,
  upsertComplianceRules,
};
