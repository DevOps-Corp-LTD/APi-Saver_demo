import { query } from '../db/pool.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

/**
 * Get users for an app
 * @param {string} appId - App ID
 * @param {object} options - Pagination options
 * @returns {object} - Paginated users
 */
export async function getUsers(appId, options = {}) {
  const { page = 1, limit = 20 } = options;
  const offset = (page - 1) * limit;
  
  // Get total count
  const countResult = await query(
    'SELECT COUNT(*) FROM users WHERE app_id = $1',
    [appId]
  );
  const total = parseInt(countResult.rows[0].count, 10);
  
  // Get users
  const result = await query(
    `SELECT id, app_id, email, role, is_active, last_login_at, created_at, updated_at
     FROM users
     WHERE app_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [appId, limit, offset]
  );
  
  return {
    users: result.rows,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get user by ID
 * @param {string} userId - User ID
 * @param {string} appId - App ID (for security)
 * @returns {object|null} - User or null
 */
export async function getUserById(userId, appId) {
  const result = await query(
    `SELECT id, app_id, email, role, is_active, last_login_at, created_at, updated_at
     FROM users WHERE id = $1 AND app_id = $2`,
    [userId, appId]
  );
  return result.rows[0] || null;
}

/**
 * Get user by email
 * @param {string} email - Email
 * @param {string} appId - App ID
 * @returns {object|null} - User or null
 */
export async function getUserByEmail(email, appId) {
  const result = await query(
    `SELECT * FROM users WHERE email = $1 AND app_id = $2`,
    [email, appId]
  );
  return result.rows[0] || null;
}

/**
 * Create a new user
 * @param {string} appId - App ID
 * @param {object} userData - User data
 * @returns {object} - Created user
 */
export async function createUser(appId, userData) {
  const { email, password, role = 'viewer', is_active = true } = userData;
  
  const passwordHash = await bcrypt.hash(password, 10);
  
  const result = await query(
    `INSERT INTO users (app_id, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, app_id, email, role, is_active, created_at`,
    [appId, email, passwordHash, role, is_active]
  );
  
  return result.rows[0];
}

/**
 * Update user
 * @param {string} userId - User ID
 * @param {string} appId - App ID (for security)
 * @param {object} updates - Fields to update
 * @returns {object|null} - Updated user or null
 */
export async function updateUser(userId, appId, updates) {
  const allowedFields = ['email', 'role', 'is_active'];
  
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
  
  if (setClauses.length === 0) {
    return getUserById(userId, appId);
  }
  
  setClauses.push('updated_at = NOW()');
  values.push(userId, appId);
  
  const result = await query(
    `UPDATE users SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND app_id = $${paramIndex + 1}
     RETURNING id, app_id, email, role, is_active, last_login_at, created_at, updated_at`,
    values
  );
  
  return result.rows[0] || null;
}

/**
 * Delete user
 * @param {string} userId - User ID
 * @param {string} appId - App ID (for security)
 * @returns {boolean} - True if deleted
 */
export async function deleteUser(userId, appId) {
  const result = await query(
    'DELETE FROM users WHERE id = $1 AND app_id = $2 RETURNING id',
    [userId, appId]
  );
  return result.rowCount > 0;
}

/**
 * Change user password
 * @param {string} userId - User ID
 * @param {string} appId - App ID (for security)
 * @param {string} newPassword - New password
 * @returns {boolean} - True if updated
 */
export async function changePassword(userId, appId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  
  const result = await query(
    `UPDATE users SET password_hash = $1, updated_at = NOW()
     WHERE id = $2 AND app_id = $3`,
    [passwordHash, userId, appId]
  );
  
  return result.rowCount > 0;
}

/**
 * Verify user password
 * @param {string} email - Email
 * @param {string} appId - App ID
 * @param {string} password - Password
 * @returns {object|null} - User if password matches, null otherwise
 */
export async function verifyPassword(email, appId, password) {
  const user = await getUserByEmail(email, appId);
  
  if (!user || !user.is_active) {
    return null;
  }
  
  const isValid = await bcrypt.compare(password, user.password_hash);
  
  if (!isValid) {
    return null;
  }
  
  // Update last login
  await query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );
  
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    app_id: user.app_id,
  };
}

/**
 * Upsert OIDC user (used by OIDC callback)
 * @param {string} appId - App ID
 * @param {object} userData - User data from OIDC
 * @returns {object} - User
 */
export async function upsertOidcUser(appId, userData) {
  const { email, name, role = 'viewer' } = userData;
  
  // Check if user exists
  const existing = await getUserByEmail(email, appId);
  
  if (existing) {
    // Update role if provided
    if (role) {
      await updateUser(existing.id, appId, { role });
    }
    return existing;
  }
  
  // Create new user with random password (OIDC users don't use password)
  const randomPassword = crypto.randomBytes(32).toString('hex');
  return await createUser(appId, {
    email,
    password: randomPassword,
    role,
  });
}

export default {
  getUsers,
  getUserById,
  getUserByEmail,
  createUser,
  updateUser,
  deleteUser,
  changePassword,
  verifyPassword,
  upsertOidcUser,
};
