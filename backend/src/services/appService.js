import { query } from '../db/pool.js';
import { generateApiKey, hash, maskSecret } from '../utils/crypto.js';
import { constantTimeCompare, addAuthFailureDelay } from '../utils/timingAttack.js';

/**
 * Get app by API key
 * @param {string} apiKey - API key
 * @returns {object|null} - App or null
 */
export async function getAppByApiKey(apiKey) {
  const apiKeyHash = hash(apiKey);
  const result = await query(
    'SELECT * FROM apps WHERE api_key_hash = $1',
    [apiKeyHash]
  );
  return result.rows[0] || null;
}

/**
 * Get app by ID
 * @param {string} appId - App ID
 * @returns {object|null} - App or null
 */
export async function getAppById(appId) {
  const result = await query(
    'SELECT * FROM apps WHERE id = $1',
    [appId]
  );
  return result.rows[0] || null;
}

/**
 * Create a new app
 * @param {string} name - App name
 * @returns {object} - Created app with API key (shown only once)
 */
export async function createApp(name) {
  const apiKey = generateApiKey();
  const apiKeyHash = hash(apiKey);
  
  const result = await query(
    `INSERT INTO apps (name, api_key_hash)
     VALUES ($1, $2)
     RETURNING id, name, created_at`,
    [name, apiKeyHash]
  );
  
  return {
    ...result.rows[0],
    api_key: apiKey, // Return plain key only on creation
  };
}

/**
 * Update app name
 * @param {string} appId - App ID
 * @param {string} name - New name
 * @returns {object|null} - Updated app or null
 */
export async function updateApp(appId, name) {
  const result = await query(
    `UPDATE apps SET name = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name, updated_at`,
    [name, appId]
  );
  return result.rows[0] || null;
}

/**
 * Rotate API key for an app
 * @param {string} appId - App ID
 * @returns {object} - New API key (shown only once)
 */
export async function rotateApiKey(appId) {
  const apiKey = generateApiKey();
  const apiKeyHash = hash(apiKey);
  
  const result = await query(
    `UPDATE apps SET api_key_hash = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id, name`,
    [apiKeyHash, appId]
  );
  
  if (!result.rows[0]) {
    throw new Error('App not found');
  }
  
  return {
    ...result.rows[0],
    api_key: apiKey, // Return plain key only on rotation
  };
}

/**
 * Get app info with masked API key
 * @param {string} appId - App ID
 * @returns {object|null} - App info with masked key
 */
export async function getAppInfo(appId) {
  const result = await query(
    'SELECT id, name, api_key_hash, created_at, updated_at FROM apps WHERE id = $1',
    [appId]
  );
  
  if (!result.rows[0]) return null;
  
  return {
    ...result.rows[0],
    api_key: maskSecret(result.rows[0].api_key_hash || ''),
    api_key_hash: undefined, // Don't expose hash
  };
}

/**
 * List all apps (admin)
 * @returns {array} - List of apps with masked keys
 */
export async function listApps() {
  const result = await query(
    'SELECT id, name, created_at, updated_at FROM apps ORDER BY created_at DESC'
  );
  return result.rows;
}

export default {
  getAppByApiKey,
  getAppById,
  createApp,
  updateApp,
  rotateApiKey,
  getAppInfo,
  listApps,
};

