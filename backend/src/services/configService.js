import { query } from '../db/pool.js';
import { encrypt, decrypt, maskSecret } from '../utils/crypto.js';

/**
 * Get a config value for an app
 * @param {string} appId - App ID
 * @param {string} key - Config key
 * @returns {string|null} - Config value or null
 */
export async function getConfigValue(appId, key) {
  const result = await query(
    `SELECT config_value, is_secret FROM app_configs
     WHERE app_id = $1 AND config_key = $2`,
    [appId, key]
  );
  
  if (!result.rows[0]) return null;
  
  const row = result.rows[0];
  
  // Decrypt if secret
  if (row.is_secret && row.config_value) {
    try {
      return decrypt(row.config_value);
    } catch {
      return null;
    }
  }
  
  return row.config_value;
}

/**
 * Get all configs for an app (with secrets masked)
 * @param {string} appId - App ID
 * @returns {array} - List of config entries
 */
export async function getAllConfigs(appId) {
  const result = await query(
    `SELECT id, app_id, config_key, config_value, is_secret, created_at, updated_at
     FROM app_configs
     WHERE app_id = $1
     ORDER BY config_key`,
    [appId]
  );
  
  return result.rows.map(row => {
    if (row.is_secret && row.config_value) {
      // Return masked value for secrets
      return {
        ...row,
        config_value: '********',
        masked: true,
      };
    }
    return row;
  });
}

/**
 * Set a config value
 * @param {string} appId - App ID
 * @param {string} key - Config key
 * @param {string} value - Config value
 * @param {boolean} isSecret - Whether this is a secret value
 * @returns {object} - Updated config
 */
export async function setConfigValue(appId, key, value, isSecret = false) {
  // Encrypt if secret
  const storedValue = isSecret && value ? encrypt(value) : value;
  
  const result = await query(
    `INSERT INTO app_configs (app_id, config_key, config_value, is_secret)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_id, config_key) DO UPDATE SET
      config_value = EXCLUDED.config_value,
      is_secret = EXCLUDED.is_secret,
      updated_at = NOW()
     RETURNING id, app_id, config_key, is_secret, created_at, updated_at`,
    [appId, key, storedValue, isSecret]
  );
  
  const row = result.rows[0];
  
  return {
    ...row,
    config_value: isSecret ? '********' : value,
    masked: isSecret,
  };
}

/**
 * Delete a config value
 * @param {string} appId - App ID
 * @param {string} key - Config key
 * @returns {boolean} - True if deleted
 */
export async function deleteConfigValue(appId, key) {
  const result = await query(
    'DELETE FROM app_configs WHERE app_id = $1 AND config_key = $2',
    [appId, key]
  );
  return result.rowCount > 0;
}

/**
 * Set multiple config values at once
 * @param {string} appId - App ID
 * @param {object} configs - Key-value pairs { key: { value, isSecret } }
 * @returns {array} - Updated configs
 */
export async function setMultipleConfigs(appId, configs) {
  const results = [];
  
  for (const [key, config] of Object.entries(configs)) {
    const { value, isSecret = false } = typeof config === 'object' ? config : { value: config };
    const result = await setConfigValue(appId, key, value, isSecret);
    results.push(result);
  }
  
  return results;
}

/**
 * Get config as a simple key-value object (internal use, decrypts secrets)
 * @param {string} appId - App ID
 * @returns {object} - Config object
 */
export async function getConfigObject(appId) {
  const result = await query(
    `SELECT config_key, config_value, is_secret FROM app_configs WHERE app_id = $1`,
    [appId]
  );
  
  const configObj = {};
  
  for (const row of result.rows) {
    if (row.is_secret && row.config_value) {
      try {
        configObj[row.config_key] = decrypt(row.config_value);
      } catch {
        configObj[row.config_key] = null;
      }
    } else {
      configObj[row.config_key] = row.config_value;
    }
  }
  
  return configObj;
}

export default {
  getConfigValue,
  getAllConfigs,
  setConfigValue,
  deleteConfigValue,
  setMultipleConfigs,
  getConfigObject,
};

