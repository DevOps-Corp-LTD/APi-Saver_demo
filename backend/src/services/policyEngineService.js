import { query } from '../db/pool.js';

/**
 * Policy Engine Service
 * Supports policy-as-code evaluation with extensible rule engine
 * Can be extended to support OPA/Rego or CEL
 */

/**
 * Evaluate a policy rule
 * @param {string} ruleType - Type of rule ('ttl', 'cache', 'compliance', etc.)
 * @param {object} context - Evaluation context (request, source, cache entry, etc.)
 * @param {object} policy - Policy configuration
 * @returns {object} - Evaluation result
 */
export async function evaluatePolicy(ruleType, context, policy) {
  switch (ruleType) {
    case 'ttl':
      return evaluateTTLPolicy(context, policy);
    case 'cache':
      return evaluateCachePolicy(context, policy);
    case 'compliance':
      return evaluateCompliancePolicy(context, policy);
    default:
      return { allowed: true, reason: 'Unknown rule type' };
  }
}

/**
 * Evaluate TTL policy
 * @param {object} context - Context with requested TTL
 * @param {object} policy - Policy with max_ttl_seconds
 * @returns {object} - Evaluation result
 */
function evaluateTTLPolicy(context, policy) {
  const { requested_ttl } = context;
  const { max_ttl_seconds } = policy;
  
  if (!max_ttl_seconds) {
    return { allowed: true, effective_ttl: requested_ttl };
  }
  
  // If requested TTL is 0 (indefinite) or exceeds max, use max
  const effective_ttl = (requested_ttl === 0 || requested_ttl > max_ttl_seconds)
    ? max_ttl_seconds
    : requested_ttl;
  
  return {
    allowed: true,
    effective_ttl,
    reason: requested_ttl > max_ttl_seconds ? 'Limited by policy max_ttl_seconds' : null,
  };
}

/**
 * Evaluate cache policy
 * @param {object} context - Context with request info
 * @param {object} policy - Policy with no_cache flag
 * @returns {object} - Evaluation result
 */
function evaluateCachePolicy(context, policy) {
  const { no_cache } = policy;
  
  if (no_cache) {
    return {
      allowed: false,
      reason: 'Policy specifies no_cache=true',
    };
  }
  
  return { allowed: true };
}

/**
 * Evaluate compliance policy
 * @param {object} context - Context with request/response data
 * @param {object} policy - Compliance policy rules
 * @returns {object} - Evaluation result
 */
function evaluateCompliancePolicy(context, policy) {
  const { region_constraints, pii_detection, tos_aware } = policy;
  
  // Check region constraints
  if (region_constraints) {
    const { allowed_regions, blocked_regions } = region_constraints;
    const requestRegion = context.region || 'default';
    
    if (blocked_regions && blocked_regions.includes(requestRegion)) {
      return {
        allowed: false,
        reason: `Region ${requestRegion} is blocked by policy`,
      };
    }
    
    if (allowed_regions && !allowed_regions.includes(requestRegion)) {
      return {
        allowed: false,
        reason: `Region ${requestRegion} is not in allowed list`,
      };
    }
  }
  
  // Check PII detection
  if (pii_detection && pii_detection.enabled) {
    const hasPII = detectPII(context.response_body || context.request_body);
    if (hasPII && pii_detection.block_caching) {
      return {
        allowed: false,
        reason: 'PII detected in response, caching blocked by policy',
      };
    }
  }
  
  // Check TOS-aware rules
  if (tos_aware && tos_aware.enabled) {
    // This would check against TOS rules stored in database
    // For now, return allowed
  }
  
  return { allowed: true };
}

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
 * Evaluate policy using OPA (scaffolded - requires OPA server)
 * @param {string} policyPath - OPA policy path
 * @param {object} input - Input data for policy evaluation
 * @returns {Promise<object>} - Evaluation result
 */
export async function evaluateOPAPolicy(policyPath, input) {
  // Scaffolded: This would call an OPA server
  // Example: POST http://opa-server/v1/data/{policyPath}
  // For now, return a placeholder
  throw new Error('OPA integration not yet implemented. Install OPA server and configure OPA_URL environment variable.');
}

/**
 * Evaluate policy using CEL (scaffolded - requires CEL library)
 * @param {string} expression - CEL expression
 * @param {object} context - Evaluation context
 * @returns {Promise<object>} - Evaluation result
 */
export async function evaluateCELPolicy(expression, context) {
  // Scaffolded: This would use a CEL library
  // For now, return a placeholder
  throw new Error('CEL integration not yet implemented. Install @grpc/grpc-js and cel-js packages.');
}

/**
 * Get policy rules for a source
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @returns {object|null} - Policy rules or null
 */
export async function getPolicyRules(appId, sourceId) {
  const result = await query(
    `SELECT * FROM cache_policies
     WHERE app_id = $1 AND source_id = $2`,
    [appId, sourceId]
  );
  
  return result.rows[0] || null;
}

/**
 * Store policy rules
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @param {object} rules - Policy rules
 */
export async function storePolicyRules(appId, sourceId, rules) {
  // This would store policy rules in a policies table
  // For now, use cache_policies table
  await query(
    `INSERT INTO cache_policies (app_id, source_id, max_ttl_seconds, no_cache)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_id, source_id) DO UPDATE SET
       max_ttl_seconds = EXCLUDED.max_ttl_seconds,
       no_cache = EXCLUDED.no_cache,
       updated_at = NOW()`,
    [appId, sourceId, rules.max_ttl_seconds || null, rules.no_cache || false]
  );
}

export default {
  evaluatePolicy,
  evaluateOPAPolicy,
  evaluateCELPolicy,
  getPolicyRules,
  storePolicyRules,
};
