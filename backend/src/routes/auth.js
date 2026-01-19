import { getAppByApiKey, getAppInfo, rotateApiKey } from '../services/appService.js';
import { 
  getUsers, 
  getUserById, 
  createUser, 
  updateUser, 
  deleteUser, 
  changePassword,
  getUserByEmail,
} from '../services/userService.js';
import { logAudit } from '../services/auditService.js';
import { validatePassword } from '../utils/passwordValidation.js';
import { loginRateLimit, rotateKeyRateLimit } from '../utils/authRateLimit.js';
import { handleAuthError, handleNotFoundError, handleValidationError, handleDatabaseError } from '../utils/errorHandler.js';
import { addAuthFailureDelay } from '../utils/timingAttack.js';
import { sanitizeEmail } from '../utils/inputSanitization.js';
import config from '../config/index.js';
import { query } from '../db/pool.js';
import bcrypt from 'bcrypt';

export default async function authRoutes(fastify) {
  // Login with API key or email/password - returns JWT token
  fastify.post('/login', {
    preHandler: [loginRateLimit],
    schema: {
      body: {
        type: 'object',
        oneOf: [
          {
            required: ['api_key'],
            properties: {
              api_key: { type: 'string' },
            },
          },
          {
            required: ['email', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              password: { type: 'string' },
            },
          },
        ],
      },
    },
  }, async (request, reply) => {
    const { api_key } = request.body;
    let { email, password } = request.body;
    
    // API Key login
    if (api_key) {
      const app = await getAppByApiKey(api_key);
      
      if (!app) {
        const { statusCode, response } = handleAuthError('Invalid API key');
        return reply.status(statusCode).send(response);
      }
      
      // Generate JWT token with expiration
      const token = fastify.jwt.sign({
        appId: app.id,
        userId: null, // API key login doesn't have a user
        email: null,
        role: 'admin',
      }, {
        expiresIn: '8h', // 8 hour expiration
      });
      
      // Set cookie with expiration and security settings
      reply.setCookie('token', token, {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        secure: config.nodeEnv === 'production' || request.protocol === 'https',
        maxAge: 8 * 60 * 60, // 8 hours in seconds
        path: '/', // Explicit path
      });
      
      const appInfo = await getAppInfo(app.id);
      
      await logAudit({
        app_id: app.id,
        action: 'login',
        resource_type: 'auth',
        new_value: { method: 'api_key' },
        ip_address: request.ip,
        user_agent: request.headers['user-agent'],
      });
      
      return {
        token,
        app: appInfo,
        role: 'admin',
      };
    }
    
    // Email/Password login
    if (email && password) {
      // Try to get app from API key header (optional)
      let appId = null;
      const apiKeyHeader = request.headers['x-api-key'];
      if (apiKeyHeader) {
        const app = await getAppByApiKey(apiKeyHeader);
        if (app) {
          appId = app.id;
        }
      }
      
      // Sanitize email input
      let sanitizedEmail;
      try {
        sanitizedEmail = sanitizeEmail(email);
        fastify.log.debug({ originalEmail: email, sanitizedEmail }, 'Email sanitized for login');
      } catch (err) {
        fastify.log.warn({ email, error: err.message }, 'Email sanitization failed');
        await addAuthFailureDelay();
        const { statusCode, response } = handleAuthError('Invalid email or password');
        return reply.status(statusCode).send(response);
      }
      email = sanitizedEmail;
      
      // Find user by email
      // If appId is provided, search within that app; otherwise search across all apps
      let user = null;
      if (appId) {
        fastify.log.debug({ email, appId }, 'Searching for user with appId');
        user = await getUserByEmail(email, appId);
      } else {
        fastify.log.debug({ email }, 'Searching for user across all apps');
        // Search across all apps - find user by email
        const result = await query(
          'SELECT id, app_id, email, password_hash, role, is_active FROM users WHERE email = $1 AND is_active = true LIMIT 1',
          [email]
        );
        if (result.rows.length > 0) {
          user = result.rows[0];
          appId = user.app_id;
          fastify.log.debug({ userId: user.id, appId: user.app_id, email: user.email }, 'User found');
        } else {
          fastify.log.warn({ email }, 'User not found or inactive');
        }
      }
      
      if (!user || !user.is_active) {
        // Add delay to prevent timing attacks
        await addAuthFailureDelay();
        const { statusCode, response } = handleAuthError('Invalid email or password');
        return reply.status(statusCode).send(response);
      }
      
      // Verify password (bcrypt.compare is constant-time)
      const passwordMatch = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatch) {
        fastify.log.warn({ email, userId: user.id }, 'Password mismatch');
        // Add delay to prevent timing attacks
        await addAuthFailureDelay();
        const { statusCode, response } = handleAuthError('Invalid email or password');
        return reply.status(statusCode).send(response);
      }
      
      fastify.log.info({ email, userId: user.id, role: user.role }, 'Password login successful');
      
      // Get app info
      const app = await getAppInfo(appId);
      
      // Update last login
      await query(
        'UPDATE users SET last_login_at = NOW() WHERE id = $1',
        [user.id]
      );
      
      // Generate JWT token with expiration
      const token = fastify.jwt.sign({
        appId: appId,
        userId: user.id,
        email: user.email,
        role: user.role || 'viewer',
      }, {
        expiresIn: '8h', // 8 hour expiration
      });
      
      // Set cookie with expiration and security settings
      reply.setCookie('token', token, {
        signed: true,
        httpOnly: true,
        sameSite: 'strict',
        secure: config.nodeEnv === 'production' || request.protocol === 'https',
        maxAge: 8 * 60 * 60, // 8 hours in seconds
        path: '/', // Explicit path
      });
      
      await logAudit({
        app_id: appId,
        user_id: user.id,
        action: 'login',
        resource_type: 'auth',
        new_value: { method: 'password', email: user.email, role: user.role },
        ip_address: request.ip,
        user_agent: request.headers['user-agent'],
      });
      
      return {
        token,
        app,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        role: user.role || 'viewer',
      };
    }
    
    return reply.status(400).send({
      error: 'Bad Request',
      message: 'Either api_key or email+password required',
    });
  });
  
  // Verify token
  fastify.get('/verify', {
    preHandler: [fastify.authenticateJwt],
  }, async (request, reply) => {
    const appInfo = await getAppInfo(request.appId);
    
    return {
      app: appInfo,
      role: request.userRole,
      userId: request.userId,
      email: request.userEmail,
    };
  });
  
  // Get current user/app info
  fastify.get('/me', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    const appInfo = await getAppInfo(request.appId);
    
    let user = null;
    if (request.userId) {
      user = await getUserById(request.userId, request.appId);
    }
    
    return {
      app: appInfo,
      user,
      role: request.userRole,
    };
  });
  
  // Rotate API key (admin only)
  fastify.post('/rotate-key', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin']), rotateKeyRateLimit],
    schema: {
      body: {
        type: 'object',
        required: ['confirm'],
        properties: {
          confirm: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    if (!request.body.confirm) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Confirmation required',
      });
    }
    
    const result = await rotateApiKey(request.appId);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'api_key_rotate',
      resource_type: 'app',
      resource_id: request.appId,
      ip_address: request.ip,
    });
    
    return {
      message: 'API key rotated successfully',
      api_key: result.api_key, // Return plain key only on rotation
    };
  });
  
  // List users (admin only)
  fastify.get('/users', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { page = 1, limit = 20 } = request.query;
    const users = await getUsers(request.appId, { page, limit });
    return users;
  });
  
  // Get user by ID (admin only)
  fastify.get('/users/:id', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserById(request.params.id, request.appId);
    
    if (!user) {
      const { statusCode, response } = handleNotFoundError('User');
      return reply.status(statusCode).send(response);
    }
    
    return user;
  });
  
  // Create user (admin only)
  fastify.post('/users', {
    preHandler: [
      fastify.authenticate, 
      fastify.authorizeRole(['admin']),
      async (request, reply) => {
        // Log raw request body before validation
        fastify.log.info({ 
          rawBody: request.body,
          headers: request.headers,
          url: request.url 
        }, 'User creation request received');
        return;
      }
    ],
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password', 'role'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 12 },
          role: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
          is_active: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    // Log request body for debugging
    fastify.log.info({ body: request.body, appId: request.appId }, 'Creating user');
    
    let { email, password, role, is_active = true } = request.body;
    
    // Sanitize email input
    try {
      email = sanitizeEmail(email);
    } catch (err) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: err.message || 'Invalid email format',
      });
    }
    
    // Validate password strength
    try {
      validatePassword(password);
      fastify.log.debug('Password validation passed');
    } catch (err) {
      fastify.log.warn({ error: err.message, email }, 'Password validation failed');
      return reply.status(400).send({
        error: 'Bad Request',
        message: err.message,
      });
    }
    
    // Check if user already exists
    const existing = await getUserByEmail(email, request.appId);
    if (existing) {
      fastify.log.warn({ email }, 'User already exists');
      return reply.status(409).send({
        error: 'Conflict',
        message: 'User with this email already exists',
      });
    }
    
    try {
      fastify.log.debug({ email, role, is_active }, 'Calling createUser');
      const user = await createUser(request.appId, { email, password, role, is_active });
      fastify.log.info({ userId: user.id, email }, 'User created successfully');
    
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'user_create',
        resource_type: 'user',
        resource_id: user.id,
        new_value: { email, role },
        ip_address: request.ip,
      });
      
      return reply.status(201).send(user);
    } catch (err) {
      fastify.log.error({ error: err, stack: err.stack, email }, 'Error creating user');
      if (err.code && err.code.startsWith('23')) {
        const { statusCode, response } = handleDatabaseError(err);
        return reply.status(statusCode).send(response);
      }
      const { statusCode, response } = handleDatabaseError(err);
      return reply.status(statusCode).send(response);
    }
  });
  
  // Update user (admin only)
  fastify.patch('/users/:id', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
          is_active: { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const oldUser = await getUserById(request.params.id, request.appId);
    
    if (!oldUser) {
      const { statusCode, response } = handleNotFoundError('User');
      return reply.status(statusCode).send(response);
    }
    
    // Sanitize email if provided
    const updates = { ...request.body };
    if (updates.email) {
      try {
        updates.email = sanitizeEmail(updates.email);
      } catch (err) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: err.message || 'Invalid email format',
        });
      }
    }
    
    const user = await updateUser(request.params.id, request.appId, updates);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'user_update',
      resource_type: 'user',
      resource_id: user.id,
      old_value: { email: oldUser.email, role: oldUser.role, is_active: oldUser.is_active },
      new_value: request.body,
      ip_address: request.ip,
    });
    
    return user;
  });
  
  // Delete user (admin only)
  fastify.delete('/users/:id', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserById(request.params.id, request.appId);
    
    if (!user) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }
    
    await deleteUser(request.params.id, request.appId);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'user_delete',
      resource_type: 'user',
      resource_id: request.params.id,
      old_value: { email: user.email },
      ip_address: request.ip,
    });
    
    return { success: true };
  });
  
  // Change user password (admin only)
  fastify.post('/users/:id/password', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
        },
      },
      body: {
        type: 'object',
        required: ['new_password'],
        properties: {
          new_password: { type: 'string', minLength: 12 },
        },
      },
    },
  }, async (request, reply) => {
    const user = await getUserById(request.params.id, request.appId);
    
    if (!user) {
      return reply.status(404).send({
        error: 'Not Found',
        message: 'User not found',
      });
    }
    
    // Validate password strength
    try {
      validatePassword(request.body.new_password);
    } catch (err) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: err.message,
      });
    }
    
    await changePassword(request.params.id, request.appId, request.body.new_password);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'user_password_change',
      resource_type: 'user',
      resource_id: request.params.id,
      ip_address: request.ip,
    });
    
    return { success: true };
  });
}
