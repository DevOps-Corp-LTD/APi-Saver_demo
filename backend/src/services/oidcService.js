import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { Issuer } from 'openid-client';

// Cache for OIDC clients
const clientCache = new Map();

/**
 * Get OIDC config for an app
 * @param {string} appId - App ID
 * @returns {object|null} - OIDC config or null
 */
export async function getOidcConfig(appId) {
  const result = await query(
    `SELECT * FROM oidc_configs WHERE app_id = $1`,
    [appId]
  );
  
  if (!result.rows[0]) return null;
  
  const config = result.rows[0];
  
  // Decrypt client secret
  try {
    config.client_secret = decrypt(config.client_secret_encrypted);
    delete config.client_secret_encrypted;
  } catch {
    config.client_secret = null;
  }
  
  return config;
}

/**
 * Create or update OIDC config for an app
 * @param {string} appId - App ID
 * @param {object} config - OIDC configuration
 * @returns {object} - Created/updated config
 */
export async function upsertOidcConfig(appId, config) {
  const {
    issuer,
    client_id,
    client_secret,
    redirect_uri,
    scopes = 'openid profile email',
    role_claim = 'role',
    admin_role_value = 'admin',
    is_enabled = true,
  } = config;
  
  const clientSecretEncrypted = encrypt(client_secret);
  
  const result = await query(
    `INSERT INTO oidc_configs (app_id, issuer, client_id, client_secret_encrypted, redirect_uri, scopes, role_claim, admin_role_value, is_enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (app_id) DO UPDATE SET
       issuer = EXCLUDED.issuer,
       client_id = EXCLUDED.client_id,
       client_secret_encrypted = EXCLUDED.client_secret_encrypted,
       redirect_uri = EXCLUDED.redirect_uri,
       scopes = EXCLUDED.scopes,
       role_claim = EXCLUDED.role_claim,
       admin_role_value = EXCLUDED.admin_role_value,
       is_enabled = EXCLUDED.is_enabled,
       updated_at = NOW()
     RETURNING id, app_id, issuer, client_id, redirect_uri, scopes, role_claim, admin_role_value, is_enabled, created_at, updated_at`,
    [appId, issuer, client_id, clientSecretEncrypted, redirect_uri, scopes, role_claim, admin_role_value, is_enabled]
  );
  
  // Clear client cache
  clientCache.delete(appId);
  
  return result.rows[0];
}

/**
 * Delete OIDC config for an app
 * @param {string} appId - App ID
 * @returns {boolean} - Success
 */
export async function deleteOidcConfig(appId) {
  const result = await query(
    'DELETE FROM oidc_configs WHERE app_id = $1',
    [appId]
  );
  
  // Clear client cache
  clientCache.delete(appId);
  
  return result.rowCount > 0;
}

/**
 * Get or create OIDC client for an app
 * @param {string} appId - App ID
 * @returns {object|null} - OIDC client or null
 */
export async function getOidcClient(appId) {
  // Check cache first
  if (clientCache.has(appId)) {
    const cached = clientCache.get(appId);
    // Cache for 5 minutes
    if (cached.timestamp > Date.now() - 5 * 60 * 1000) {
      return cached.client;
    }
  }
  
  const config = await getOidcConfig(appId);
  
  if (!config || !config.is_enabled) {
    return null;
  }
  
  try {
    // Discover OIDC issuer
    const issuer = await Issuer.discover(config.issuer);
    
    // Create client
    const client = new issuer.Client({
      client_id: config.client_id,
      client_secret: config.client_secret,
      redirect_uris: [config.redirect_uri],
      response_types: ['code'],
    });
    
    // Attach config metadata to client
    client.oidcConfig = config;
    
    // Cache the client
    clientCache.set(appId, {
      client,
      timestamp: Date.now(),
    });
    
    return client;
  } catch (error) {
    logger.error({ err: error.message }, 'Failed to create OIDC client');
    return null;
  }
}

/**
 * Generate authorization URL for OIDC login
 * @param {string} appId - App ID
 * @param {string} state - State parameter for CSRF protection
 * @param {string} nonce - Nonce for replay protection
 * @returns {string|null} - Authorization URL or null
 */
export async function getAuthorizationUrl(appId, state, nonce) {
  const client = await getOidcClient(appId);
  
  if (!client) {
    return null;
  }
  
  const config = client.oidcConfig;
  
  return client.authorizationUrl({
    scope: config.scopes,
    state,
    nonce,
  });
}

/**
 * Handle OIDC callback and get user claims
 * @param {string} appId - App ID
 * @param {object} params - Callback parameters
 * @param {string} expectedState - Expected state value
 * @param {string} expectedNonce - Expected nonce value
 * @returns {object} - Token set and user claims
 */
export async function handleCallback(appId, params, expectedState, expectedNonce) {
  const client = await getOidcClient(appId);
  
  if (!client) {
    throw new Error('OIDC not configured or disabled');
  }
  
  const config = client.oidcConfig;
  
  // Exchange code for tokens
  const tokenSet = await client.callback(config.redirect_uri, params, {
    state: expectedState,
    nonce: expectedNonce,
  });
  
  // Get user info
  const userInfo = await client.userinfo(tokenSet.access_token);
  
  // Combine ID token claims with user info
  const claims = {
    ...tokenSet.claims(),
    ...userInfo,
  };
  
  return {
    tokenSet,
    claims,
    roleClaimValue: extractRoleClaim(claims, config.role_claim),
    adminRoleValue: config.admin_role_value,
  };
}

/**
 * Extract role claim from claims object
 * @param {object} claims - Claims object
 * @param {string} roleClaim - Role claim path (supports dot notation)
 * @returns {string|null} - Role value or null
 */
function extractRoleClaim(claims, roleClaim) {
  // Support dot notation for nested claims (e.g., "realm_access.roles")
  const parts = roleClaim.split('.');
  let value = claims;
  
  for (const part of parts) {
    if (value && typeof value === 'object') {
      value = value[part];
    } else {
      return null;
    }
  }
  
  // Handle array claims (common in Keycloak)
  if (Array.isArray(value)) {
    return value[0];
  }
  
  return value;
}

/**
 * Test OIDC configuration
 * @param {object} config - OIDC configuration to test
 * @returns {object} - Test result
 */
export async function testOidcConfig(config) {
  try {
    // Try to discover the issuer
    const issuer = await Issuer.discover(config.issuer);
    
    return {
      success: true,
      issuer: {
        name: issuer.metadata.issuer,
        authorization_endpoint: issuer.metadata.authorization_endpoint,
        token_endpoint: issuer.metadata.token_endpoint,
        userinfo_endpoint: issuer.metadata.userinfo_endpoint,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

export default {
  getOidcConfig,
  upsertOidcConfig,
  deleteOidcConfig,
  getOidcClient,
  getAuthorizationUrl,
  handleCallback,
  testOidcConfig,
};
