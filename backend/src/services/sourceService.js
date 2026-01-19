import { query } from '../db/pool.js';
import logger from '../utils/logger.js';
import { encrypt, decrypt, maskSecret } from '../utils/crypto.js';
import axios from 'axios';

// Hard-coded demo limit - DO NOT make this configurable
const DEMO_MAX_SOURCES = 2;

/**
 * Extract hostname from URL for naming purposes
 * @param {string} url - URL to extract hostname from
 * @returns {string} - Hostname with port if non-standard
 */
function extractHostname(url) {
  try {
    const urlObj = new URL(url);
    let hostname = urlObj.hostname;
    // Include port if not standard (80 for http, 443 for https)
    if (urlObj.port && 
        !((urlObj.protocol === 'http:' && urlObj.port === '80') ||
          (urlObj.protocol === 'https:' && urlObj.port === '443'))) {
      hostname = `${hostname}:${urlObj.port}`;
    }
    // Sanitize: max 50 chars, replace spaces with hyphens
    hostname = hostname.replace(/\s+/g, '-').substring(0, 50);
    return hostname;
  } catch {
    // Fallback: extract from string
    return url.replace(/^https?:\/\//, '').split('/')[0].substring(0, 50);
  }
}

/**
 * Extract canonical name from source name
 * @param {string} sourceName - Source name
 * @returns {string} - Canonical name (base name before " - " or first word)
 */
function extractCanonicalName(sourceName) {
  const dashIndex = sourceName.indexOf(' - ');
  const spaceIndex = sourceName.indexOf(' ');
  
  if (dashIndex > 0) {
    return sourceName.substring(0, dashIndex);
  } else if (spaceIndex > 0 && !sourceName.match(/^[A-Z][a-z]+ [A-Z]/)) {
    // Only use first word if it's not a proper name (like "JSONPlaceholder API")
    return sourceName.split(' ')[0];
  }
  return sourceName;
}

/**
 * Get sources by canonical name
 * @param {string} appId - App ID
 * @param {string} canonicalName - Canonical name to match
 * @returns {array} - List of related sources
 */
export async function getSourcesByCanonicalName(appId, canonicalName) {
  const result = await query(
    `SELECT * FROM app_sources 
     WHERE app_id = $1 
     AND (
       LOWER(name) = LOWER($2) 
       OR LOWER(name) LIKE LOWER($2 || ' - %')
       OR LOWER(name) LIKE LOWER($2 || ' %')
     )
     ORDER BY priority ASC`,
    [appId, canonicalName]
  );
  return result.rows;
}

/**
 * Get sources for an app
 * @param {string} appId - App ID
 * @returns {array} - List of sources (with masked secrets)
 */
export async function getSourcesByAppId(appId) {
  const result = await query(
    `SELECT id, app_id, name, base_url, auth_type, priority, timeout_ms, 
            retry_count, circuit_breaker_threshold, is_active, storage_mode, 
            storage_pool_id, vary_headers, kill_switch_enabled, bypass_bot_detection, 
            fallback_mode, cost_per_request, created_at, updated_at
     FROM app_sources
     WHERE app_id = $1
     ORDER BY priority ASC`,
    [appId]
  );
  return result.rows;
}

/**
 * Get a source by ID
 * @param {string} sourceId - Source ID
 * @param {string} appId - App ID (for security)
 * @returns {object|null} - Source or null
 */
export async function getSourceById(sourceId, appId) {
  const result = await query(
    `SELECT * FROM app_sources WHERE id = $1 AND app_id = $2`,
    [sourceId, appId]
  );
  return result.rows[0] || null;
}

/**
 * Get source with decrypted auth config (internal use only)
 * @param {string} sourceId - Source ID
 * @returns {object|null} - Source with decrypted config
 */
export async function getSourceWithAuth(sourceId) {
  const result = await query(
    `SELECT * FROM app_sources WHERE id = $1`,
    [sourceId]
  );
  
  if (!result.rows[0]) return null;
  
  const source = result.rows[0];
  
  // Decrypt auth config if present
  if (source.auth_config_encrypted) {
    try {
      source.auth_config = JSON.parse(decrypt(source.auth_config_encrypted));
    } catch {
      source.auth_config = null;
    }
  }
  
  // Decrypt headers if present
  if (source.headers_encrypted) {
    try {
      source.headers = JSON.parse(decrypt(source.headers_encrypted));
    } catch {
      source.headers = null;
    }
  }
  
  return source;
}

/**
 * Create a new source
 * @param {string} appId - App ID
 * @param {object} sourceData - Source data
 * @returns {object} - Created source
 */
export async function createSource(appId, sourceData) {
  // DEMO LIMIT VALIDATION - SECONDARY SECURITY LAYER
  const existingSources = await getSourcesByAppId(appId);
  if (existingSources.length >= DEMO_MAX_SOURCES) {
    throw new Error('Demo version is limited to 2 API sources. To purchase the full version please contact services@devops-corp.com');
  }

  let {
    name,
    base_url,
    auth_type = 'none',
    auth_config = null,
    headers = null,
    priority = 0,
    timeout_ms = 30000,
    retry_count = 3,
    circuit_breaker_threshold = 5,
    storage_mode = 'dedicated',
    storage_pool_id = null,
    bypass_bot_detection = false,
    fallback_mode = 'none',
    cost_per_request = null,
  } = sourceData;
  
  // Validate storage mode
  if (storage_mode === 'shared' && !storage_pool_id) {
    throw new Error('storage_pool_id is required when storage_mode is "shared"');
  }
  
  // Auto-create storage pool for dedicated mode
  if (storage_mode === 'dedicated') {
    const { createStoragePool } = await import('./storagePoolService.js');
    const crypto = await import('crypto');
    let poolName = `${name} (Dedicated)`;
    
    // Check if pool name already exists and generate unique name if needed
    const existingPool = await query(
      'SELECT id FROM storage_pools WHERE app_id = $1 AND name = $2',
      [appId, poolName]
    );
    
    // If name exists, append unique suffix
    if (existingPool.rows.length > 0) {
      const uniqueSuffix = crypto.randomUUID().substring(0, 8);
      poolName = `${name} (Dedicated) - ${uniqueSuffix}`;
      
      // Double-check the new name doesn't exist (very unlikely but safe)
      const checkAgain = await query(
        'SELECT id FROM storage_pools WHERE app_id = $1 AND name = $2',
        [appId, poolName]
      );
      
      // If still exists (extremely rare), append timestamp
      if (checkAgain.rows.length > 0) {
        poolName = `${name} (Dedicated) - ${Date.now()}`;
      }
    }
    
    // Create pool with the unique name
    const pool = await createStoragePool(appId, {
      name: poolName,
      description: `Automatically created dedicated storage for ${name}`
    });
    
    storage_pool_id = pool.id;
    // Keep storage_mode as 'dedicated' - the pool is just for organization/management
  }
  
  // Encrypt sensitive data
  const authConfigEncrypted = auth_config ? encrypt(JSON.stringify(auth_config)) : null;
  const headersEncrypted = headers ? encrypt(JSON.stringify(headers)) : null;
  
  const vary_headers = sourceData.vary_headers || ['accept', 'content-type', 'x-api-version'];
  
  const result = await query(
    `INSERT INTO app_sources 
     (app_id, name, base_url, auth_type, auth_config_encrypted, headers_encrypted,
      priority, timeout_ms, retry_count, circuit_breaker_threshold, storage_mode, storage_pool_id, vary_headers, bypass_bot_detection, fallback_mode, cost_per_request)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id, app_id, name, base_url, auth_type, priority, timeout_ms,
               retry_count, circuit_breaker_threshold, is_active, storage_mode, storage_pool_id, vary_headers, kill_switch_enabled, bypass_bot_detection, fallback_mode, cost_per_request, created_at`,
    [appId, name, base_url, auth_type, authConfigEncrypted, headersEncrypted,
     priority, timeout_ms, retry_count, circuit_breaker_threshold, storage_mode, storage_pool_id, JSON.stringify(vary_headers), bypass_bot_detection, fallback_mode, cost_per_request]
  );
  
  return result.rows[0];
}

/**
 * Update a source
 * @param {string} sourceId - Source ID
 * @param {string} appId - App ID (for security)
 * @param {object} updates - Fields to update
 * @returns {object|null} - Updated source or null
 */
export async function updateSource(sourceId, appId, updates) {
  const allowedFields = ['name', 'base_url', 'auth_type', 'priority', 'timeout_ms',
                         'retry_count', 'circuit_breaker_threshold', 'is_active', 
                         'storage_mode', 'storage_pool_id', 'vary_headers', 'kill_switch_enabled', 'bypass_bot_detection', 'fallback_mode', 'cost_per_request'];
  
  const setClauses = [];
  const values = [];
  let paramIndex = 1;
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }
  
  // Get current source state before updating (needed for cache entry migration)
  const currentSource = await getSourceById(sourceId, appId);
  if (!currentSource) {
    throw new Error('Source not found');
  }
  
  // Handle storage mode transitions
  const currentMode = currentSource.storage_mode || 'dedicated';
  const newMode = updates.storage_mode !== undefined ? updates.storage_mode : currentMode;
  
  // If changing to dedicated mode, auto-create a pool
  if (newMode === 'dedicated' && currentMode !== 'dedicated') {
    const { createStoragePool } = await import('./storagePoolService.js');
    const crypto = await import('crypto');
    const sourceName = updates.name !== undefined ? updates.name : currentSource.name;
    let poolName = `${sourceName} (Dedicated)`;
    
    // Check if pool name already exists and generate unique name if needed
    const existingPool = await query(
      'SELECT id FROM storage_pools WHERE app_id = $1 AND name = $2',
      [appId, poolName]
    );
    
    // If name exists, append unique suffix
    if (existingPool.rows.length > 0) {
      const uniqueSuffix = crypto.randomUUID().substring(0, 8);
      poolName = `${sourceName} (Dedicated) - ${uniqueSuffix}`;
      
      // Double-check the new name doesn't exist (very unlikely but safe)
      const checkAgain = await query(
        'SELECT id FROM storage_pools WHERE app_id = $1 AND name = $2',
        [appId, poolName]
      );
      
      // If still exists (extremely rare), append timestamp
      if (checkAgain.rows.length > 0) {
        poolName = `${sourceName} (Dedicated) - ${Date.now()}`;
      }
    }
    
    // Create pool with the unique name
    const pool = await createStoragePool(appId, {
      name: poolName,
      description: `Automatically created dedicated storage for ${sourceName}`
    });
    
    updates.storage_pool_id = pool.id;
    // Keep storage_mode as 'dedicated' - the pool is just for organization/management
  }
  
  // Validate storage mode if being updated
  if (updates.storage_mode === 'shared' && (!updates.storage_pool_id && !updates.hasOwnProperty('storage_pool_id'))) {
    // Check current source to see if it has a pool
    if (!currentSource?.storage_pool_id) {
      throw new Error('storage_pool_id is required when storage_mode is "shared"');
    }
  }
  
  // Handle encrypted fields separately
  if (updates.auth_config !== undefined) {
    setClauses.push(`auth_config_encrypted = $${paramIndex}`);
    values.push(updates.auth_config ? encrypt(JSON.stringify(updates.auth_config)) : null);
    paramIndex++;
  }
  
  if (updates.headers !== undefined) {
    setClauses.push(`headers_encrypted = $${paramIndex}`);
    values.push(updates.headers ? encrypt(JSON.stringify(updates.headers)) : null);
    paramIndex++;
  }
  
  // Handle vary_headers
  if (updates.vary_headers !== undefined) {
    setClauses.push(`vary_headers = $${paramIndex}`);
    values.push(Array.isArray(updates.vary_headers) ? JSON.stringify(updates.vary_headers) : updates.vary_headers);
    paramIndex++;
  }
  
  if (setClauses.length === 0) {
    return getSourceById(sourceId, appId);
  }
  
  setClauses.push('updated_at = NOW()');
  values.push(sourceId, appId);
  
  const result = await query(
    `UPDATE app_sources SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND app_id = $${paramIndex + 1}
     RETURNING id, app_id, name, base_url, auth_type, priority, timeout_ms,
               retry_count, circuit_breaker_threshold, is_active, storage_mode, storage_pool_id, vary_headers, kill_switch_enabled, fallback_mode, cost_per_request, updated_at`,
    values
  );
  
  const updatedSource = result.rows[0] || null;
  
  // If storage_pool_id changed, update all cache entries for this source
  if (updatedSource && (updates.storage_pool_id !== undefined || updates.storage_mode !== undefined)) {
    const oldPoolId = currentSource.storage_pool_id;
    const newPoolId = updatedSource.storage_pool_id;
    
    // Only update if pool actually changed
    if (oldPoolId !== newPoolId) {
      try {
        await query(
          `UPDATE cache_entries 
           SET storage_pool_id = $1, updated_at = NOW()
           WHERE app_id = $2 AND source_id = $3`,
          [newPoolId, appId, sourceId]
        );
        logger.info({ sourceId, oldPoolId, newPoolId }, '[updateSource] Migrated cache entries for source');
      } catch (err) {
        logger.error({ sourceId, err }, '[updateSource] Failed to migrate cache entries for source');
        // Don't fail the source update if cache migration fails
      }
    }
  }
  
  return updatedSource;
}

/**
 * Delete a source
 * @param {string} sourceId - Source ID
 * @param {string} appId - App ID (for security)
 * @returns {boolean} - True if deleted
 */
export async function deleteSource(sourceId, appId) {
  const result = await query(
    'DELETE FROM app_sources WHERE id = $1 AND app_id = $2 RETURNING id',
    [sourceId, appId]
  );
  return result.rowCount > 0;
}

/**
 * Test source connectivity
 * @param {string} sourceId - Source ID
 * @param {string} appId - App ID (for security)
 * @returns {object} - Test result
 */
export async function testSourceConnectivity(sourceId, appId) {
  const source = await getSourceWithAuth(sourceId);
  
  if (!source || source.app_id !== appId) {
    throw new Error('Source not found');
  }
  
  const startTime = Date.now();
  
  try {
    const headers = source.headers || {};
    
    // Add auth headers based on auth_type
    if (source.auth_type === 'bearer' && source.auth_config?.token) {
      headers['Authorization'] = `Bearer ${source.auth_config.token}`;
    } else if (source.auth_type === 'api_key' && source.auth_config) {
      const { header_name, key } = source.auth_config;
      headers[header_name || 'X-API-Key'] = key;
    }
    
    const response = await axios.get(source.base_url, {
      headers,
      timeout: source.timeout_ms,
      validateStatus: () => true, // Accept any status
    });
    
    const latency = Date.now() - startTime;
    
    return {
      success: response.status >= 200 && response.status < 400,
      status: response.status,
      latency_ms: latency,
      message: response.status >= 200 && response.status < 400 
        ? 'Connection successful' 
        : `HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      success: false,
      status: null,
      latency_ms: Date.now() - startTime,
      message: err.message,
    };
  }
}

/**
 * Get active sources sorted by priority
 * @param {string} appId - App ID
 * @returns {array} - Active sources sorted by priority
 */
export async function getActiveSourcesByPriority(appId) {
  const result = await query(
    `SELECT * FROM app_sources
     WHERE app_id = $1 AND is_active = true
     ORDER BY priority ASC`,
    [appId]
  );
  return result.rows;
}

/**
 * Create multiple sources from URL entries (for multi-URL HA setup)
 * @param {string} appId - App ID
 * @param {object} baseConfig - Shared configuration
 * @param {array} urlEntries - Array of URL entry configurations
 * @returns {array} - Array of created sources
 */
export async function createMultipleSources(appId, baseConfig, urlEntries) {
  if (!urlEntries || urlEntries.length === 0) {
    throw new Error('url_entries array is required and must not be empty');
  }

  // DEMO LIMIT VALIDATION - SECONDARY SECURITY LAYER
  const existingSources = await getSourcesByAppId(appId);
  const newCount = urlEntries.length;
  if (existingSources.length + newCount > DEMO_MAX_SOURCES) {
    throw new Error('Demo version is limited to 2 API sources. To purchase the full version please contact services@devops-corp.com');
  }

  const {
    name: baseName,
    storage_mode = 'dedicated',
    storage_pool_id = null,
    bypass_bot_detection = false,
    cost_per_request = null,
    is_active = true,
    vary_headers = ['accept', 'content-type', 'x-api-version'],
  } = baseConfig;

  // Validate: multi-URL sources must use shared storage
  if (urlEntries.length > 1 && storage_mode === 'dedicated') {
    throw new Error('Shared storage is required when using multiple URLs. All URLs in a multi-URL source must share the same cache pool.');
  }

  // Validate storage mode
  if (storage_mode === 'shared' && !storage_pool_id) {
    throw new Error('storage_pool_id is required when storage_mode is "shared"');
  }

  // Create shared storage pool for dedicated mode (one pool for all URLs)
  // Note: This only applies to single-URL sources now, as multi-URL requires shared mode
  let sharedPoolId = storage_pool_id;
  if (storage_mode === 'dedicated' && urlEntries.length === 1) {
    const { createStoragePool } = await import('./storagePoolService.js');
    const crypto = await import('crypto');
    let poolName = `${baseName} (Dedicated)`;
    
    // Check if pool name already exists and generate unique name if needed
    const existingPool = await query(
      'SELECT id FROM storage_pools WHERE app_id = $1 AND name = $2',
      [appId, poolName]
    );
    
    if (existingPool.rows.length > 0) {
      const uniqueSuffix = crypto.randomUUID().substring(0, 8);
      poolName = `${baseName} (Dedicated) - ${uniqueSuffix}`;
      
      const checkAgain = await query(
        'SELECT id FROM storage_pools WHERE app_id = $1 AND name = $2',
        [appId, poolName]
      );
      
      if (checkAgain.rows.length > 0) {
        poolName = `${baseName} (Dedicated) - ${Date.now()}`;
      }
    }
    
    const pool = await createStoragePool(appId, {
      name: poolName,
      description: `Automatically created dedicated storage for ${baseName}`
    });
    
    sharedPoolId = pool.id;
  }

  // Validate all URLs are unique
  const urlSet = new Set();
  for (const entry of urlEntries) {
    if (urlSet.has(entry.base_url)) {
      throw new Error(`Duplicate URL found: ${entry.base_url}`);
    }
    urlSet.add(entry.base_url);
  }

  // Generate source names
  const sourceNames = [];
  if (urlEntries.length === 1) {
    // Single entry: use base name
    sourceNames.push(baseName);
  } else {
    // Multiple entries: use base name - hostname
    const hostnameCounts = new Map();
    for (const entry of urlEntries) {
      const hostname = extractHostname(entry.base_url);
      const count = hostnameCounts.get(hostname) || 0;
      hostnameCounts.set(hostname, count + 1);
      
      if (count === 0) {
        sourceNames.push(`${baseName} - ${hostname}`);
      } else {
        // Duplicate hostname: append index
        sourceNames.push(`${baseName} - ${hostname}-${count + 1}`);
      }
    }
  }

  // Create sources in transaction
  const createdSources = [];
  
  // Use a transaction-like approach: create all or rollback on error
  try {
    for (let i = 0; i < urlEntries.length; i++) {
      const entry = urlEntries[i];
      const sourceName = sourceNames[i];
      
      const {
        base_url,
        auth_type = 'none',
        auth_config = null,
        headers = null,
        priority = 0,
        timeout_ms = 30000,
        retry_count = 3,
        circuit_breaker_threshold = 5,
        fallback_mode = 'none',
      } = entry;

      // Encrypt sensitive data
      const authConfigEncrypted = auth_config ? encrypt(JSON.stringify(auth_config)) : null;
      const headersEncrypted = headers ? encrypt(JSON.stringify(headers)) : null;
      
      const result = await query(
        `INSERT INTO app_sources 
         (app_id, name, base_url, auth_type, auth_config_encrypted, headers_encrypted,
          priority, timeout_ms, retry_count, circuit_breaker_threshold, storage_mode, storage_pool_id, vary_headers, bypass_bot_detection, fallback_mode, cost_per_request, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id, app_id, name, base_url, auth_type, priority, timeout_ms,
                   retry_count, circuit_breaker_threshold, is_active, storage_mode, storage_pool_id, vary_headers, kill_switch_enabled, bypass_bot_detection, fallback_mode, cost_per_request, created_at`,
        [appId, sourceName, base_url, auth_type, authConfigEncrypted, headersEncrypted,
         priority, timeout_ms, retry_count, circuit_breaker_threshold, storage_mode, sharedPoolId, JSON.stringify(vary_headers), bypass_bot_detection, fallback_mode, cost_per_request, is_active]
      );
      
      createdSources.push(result.rows[0]);
    }
  } catch (err) {
    // If any source creation fails, try to clean up created sources
    // Note: In a real transaction, this would be automatic, but we're using individual queries
    // For now, we'll let the error propagate - the user can retry
    throw err;
  }

  return createdSources;
}

export default {
  getSourcesByAppId,
  getSourceById,
  getSourceWithAuth,
  createSource,
  createMultipleSources,
  updateSource,
  deleteSource,
  testSourceConnectivity,
  getActiveSourcesByPriority,
  getSourcesByCanonicalName,
};

