import { query } from '../db/pool.js';

/**
 * Mock Service
 * Handles mock response storage and serving
 */

/**
 * Get mock response for a request
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @param {object} body - Request body
 * @returns {object|null} - Mock response or null
 */
export async function getMockResponse(appId, sourceId, method, url, body = null) {
  // Get active mocks for this source, ordered by priority
  const result = await query(
    `SELECT * FROM mock_responses
     WHERE app_id = $1 AND source_id = $2 AND is_active = true
     ORDER BY priority ASC, created_at ASC`,
    [appId, sourceId]
  );
  
  for (const mock of result.rows) {
    // Check method match
    if (mock.request_method.toUpperCase() !== method.toUpperCase()) {
      continue;
    }
    
    // Check URL pattern match
    let urlMatches = false;
    try {
      if (mock.request_url_pattern.startsWith('/') || mock.request_url_pattern.startsWith('http')) {
        // Treat as regex pattern
        const urlRegex = new RegExp(mock.request_url_pattern);
        urlMatches = urlRegex.test(url);
      } else {
        // Simple substring match
        urlMatches = url.includes(mock.request_url_pattern);
      }
    } catch (err) {
      // Invalid regex, skip
      continue;
    }
    
    if (!urlMatches) {
      continue;
    }
    
    // Check body pattern if provided
    if (mock.request_body_pattern) {
      const bodyString = typeof body === 'string' ? body : JSON.stringify(body || {});
      try {
        const bodyRegex = new RegExp(mock.request_body_pattern);
        if (!bodyRegex.test(bodyString)) {
          continue;
        }
      } catch (err) {
        // Invalid regex, skip body check
      }
    }
    
    // Match found - return mock response
    return {
      status: mock.response_status || 200,
      headers: mock.response_headers || {},
      body: mock.response_body || mock.response_body_raw,
      is_mock: true,
      mock_id: mock.id,
      mock_name: mock.name,
    };
  }
  
  return null;
}

/**
 * Create a mock response
 * @param {string} appId - App ID
 * @param {object} mockData - Mock response data
 * @returns {object} - Created mock
 */
export async function createMockResponse(appId, mockData) {
  const {
    source_id,
    name,
    request_method,
    request_url_pattern,
    request_body_pattern = null,
    response_status = 200,
    response_headers = null,
    response_body = null,
    response_body_raw = null,
    is_active = true,
    priority = 0,
  } = mockData;
  
  const result = await query(
    `INSERT INTO mock_responses 
     (app_id, source_id, name, request_method, request_url_pattern, request_body_pattern,
      response_status, response_headers, response_body, response_body_raw, is_active, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      appId,
      source_id,
      name,
      request_method.toUpperCase(),
      request_url_pattern,
      request_body_pattern,
      response_status,
      response_headers ? JSON.stringify(response_headers) : null,
      response_body ? JSON.stringify(response_body) : null,
      response_body_raw,
      is_active,
      priority,
    ]
  );
  
  return result.rows[0];
}

/**
 * Get mock responses for a source
 * @param {string} appId - App ID
 * @param {string} sourceId - Source ID
 * @returns {array} - Array of mock responses
 */
export async function getMockResponses(appId, sourceId) {
  const result = await query(
    `SELECT * FROM mock_responses
     WHERE app_id = $1 AND source_id = $2
     ORDER BY priority ASC, created_at ASC`,
    [appId, sourceId]
  );
  
  return result.rows;
}

/**
 * Update a mock response
 * @param {string} mockId - Mock ID
 * @param {string} appId - App ID
 * @param {object} updates - Fields to update
 * @returns {object|null} - Updated mock or null
 */
export async function updateMockResponse(mockId, appId, updates) {
  const allowedFields = ['name', 'request_method', 'request_url_pattern', 'request_body_pattern',
                         'response_status', 'response_headers', 'response_body', 'response_body_raw',
                         'is_active', 'priority'];
  
  const setClauses = [];
  const values = [];
  let paramIndex = 1;
  
  for (const [key, value] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      if (key === 'response_headers' || key === 'response_body') {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value ? JSON.stringify(value) : null);
      } else {
        setClauses.push(`${key} = $${paramIndex}`);
        values.push(value);
      }
      paramIndex++;
    }
  }
  
  if (setClauses.length === 0) {
    return null;
  }
  
  setClauses.push('updated_at = NOW()');
  values.push(mockId, appId);
  
  const result = await query(
    `UPDATE mock_responses SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND app_id = $${paramIndex + 1}
     RETURNING *`,
    values
  );
  
  return result.rows[0] || null;
}

/**
 * Delete a mock response
 * @param {string} mockId - Mock ID
 * @param {string} appId - App ID
 * @returns {boolean} - True if deleted
 */
export async function deleteMockResponse(mockId, appId) {
  const result = await query(
    'DELETE FROM mock_responses WHERE id = $1 AND app_id = $2 RETURNING id',
    [mockId, appId]
  );
  
  return result.rowCount > 0;
}

export default {
  getMockResponse,
  createMockResponse,
  getMockResponses,
  updateMockResponse,
  deleteMockResponse,
};
