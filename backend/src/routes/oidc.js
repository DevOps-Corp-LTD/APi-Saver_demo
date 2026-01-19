import { nanoid } from 'nanoid';
import { 
  getOidcConfig, 
  upsertOidcConfig, 
  deleteOidcConfig, 
  getAuthorizationUrl, 
  handleCallback,
  testOidcConfig,
} from '../services/oidcService.js';
import { upsertOidcUser } from '../services/userService.js';
import { getAppByApiKey } from '../services/appService.js';
import { logAudit } from '../services/auditService.js';
import { handleNotFoundError, handleValidationError, handleAuthError, createErrorResponse } from '../utils/errorHandler.js';

// Store for OIDC state/nonce (in production, use Redis or database)
const stateStore = new Map();

// Clean up old states periodically (5 minute expiry)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of stateStore.entries()) {
    if (now - value.timestamp > 5 * 60 * 1000) {
      stateStore.delete(key);
    }
  }
}, 60 * 1000);

export default async function oidcRoutes(fastify) {
  // Get OIDC config (admin only)
  fastify.get('/oidc/config', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
  }, async (request, reply) => {
    const config = await getOidcConfig(request.appId);
    
    if (!config) {
      // Return empty config instead of 404
      return {
        issuer: '',
        client_id: '',
        redirect_uri: '',
        scopes: 'openid profile email',
        enabled: false,
      };
    }
    
    // Don't return client secret
    delete config.client_secret;
    
    return config;
  });
  
  // Create/Update OIDC config (admin only)
  fastify.put('/oidc/config', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['issuer', 'client_id', 'client_secret', 'redirect_uri'],
        properties: {
          issuer: { type: 'string', format: 'uri' },
          client_id: { type: 'string', minLength: 1 },
          client_secret: { type: 'string', minLength: 1 },
          redirect_uri: { type: 'string', format: 'uri' },
          scopes: { type: 'string', default: 'openid profile email' },
          role_claim: { type: 'string', default: 'role' },
          admin_role_value: { type: 'string', default: 'admin' },
          is_enabled: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const config = await upsertOidcConfig(request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'oidc_config_update',
      resource_type: 'oidc',
      new_value: { 
        issuer: request.body.issuer, 
        client_id: request.body.client_id,
        is_enabled: request.body.is_enabled,
      },
      ip_address: request.ip,
    });
    
    return config;
  });
  
  // Delete OIDC config (admin only)
  fastify.delete('/oidc/config', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
  }, async (request, reply) => {
    const deleted = await deleteOidcConfig(request.appId);
    
    if (!deleted) {
      const { statusCode, response } = handleNotFoundError('OIDC configuration');
      return reply.status(statusCode).send(response);
    }
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'oidc_config_delete',
      resource_type: 'oidc',
      ip_address: request.ip,
    });
    
    return { success: true };
  });
  
  // Test OIDC config (admin only)
  fastify.post('/oidc/test', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['issuer'],
        properties: {
          issuer: { type: 'string', format: 'uri' },
        },
      },
    },
  }, async (request, reply) => {
    const result = await testOidcConfig(request.body);
    return result;
  });
  
  // Initiate OIDC login
  // This route requires X-API-Key header to identify the app
  fastify.get('/oidc/login', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          api_key: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    // Get app from API key (header or query param)
    const apiKey = request.headers['x-api-key'] || request.query.api_key;
    
    if (!apiKey) {
      const { statusCode, response } = handleValidationError('X-API-Key header or api_key query param required');
      return reply.status(statusCode).send(response);
    }
    
    const app = await getAppByApiKey(apiKey);
    
    if (!app) {
      const { statusCode, response } = handleAuthError('Invalid API key');
      return reply.status(statusCode).send(response);
    }
    
    // Generate state and nonce
    const state = nanoid(32);
    const nonce = nanoid(32);
    
    // Store state with app ID and timestamp
    stateStore.set(state, {
      appId: app.id,
      nonce,
      apiKey, // Store for redirect after callback
      timestamp: Date.now(),
    });
    
    // Get authorization URL
    const authUrl = await getAuthorizationUrl(app.id, state, nonce);
    
    if (!authUrl) {
      const { statusCode, response } = handleNotFoundError('OIDC configuration');
      return reply.status(statusCode).send(response);
    }
    
    // Redirect to IdP
    return reply.redirect(authUrl);
  });
  
  // OIDC callback
  fastify.get('/oidc/callback', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          state: { type: 'string' },
          error: { type: 'string' },
          error_description: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { code, state, error, error_description } = request.query;
    
    // Handle IdP errors
    if (error) {
      const { statusCode, response } = handleValidationError(error_description || error);
      return reply.status(statusCode).send(response);
    }
    
    // Validate state
    if (!state || !stateStore.has(state)) {
      const { statusCode, response } = handleValidationError('Invalid or expired state parameter');
      return reply.status(statusCode).send(response);
    }
    
    const stateData = stateStore.get(state);
    stateStore.delete(state);
    
    try {
      // Exchange code for tokens and get claims
      const { claims, roleClaimValue, adminRoleValue } = await handleCallback(
        stateData.appId,
        { code, state },
        state,
        stateData.nonce
      );
      
      // Create or update user from OIDC claims
      const user = await upsertOidcUser(stateData.appId, claims, roleClaimValue, adminRoleValue);
      
      // Get app info
      const appResult = await fastify.pg.query(
        'SELECT id, name FROM apps WHERE id = $1',
        [stateData.appId]
      ).catch(() => ({ rows: [{ id: stateData.appId, name: 'App' }] }));
      
      const app = appResult.rows[0] || { id: stateData.appId, name: 'App' };
      
      // Generate JWT token
      const token = fastify.jwt.sign({
        appId: stateData.appId,
        appName: app.name,
        userId: user.id,
        email: user.email,
        role: user.role,
        loginMethod: 'oidc',
      }, { expiresIn: '24h' });
      
      await logAudit({
        app_id: stateData.appId,
        user_id: user.id,
        action: 'login',
        resource_type: 'auth',
        new_value: { method: 'oidc', role: user.role, email: user.email },
        ip_address: request.ip,
        user_agent: request.headers['user-agent'],
      });
      
      // Return token (in real app, you'd redirect to frontend with token)
      // For now, return JSON with redirect info
      const config = await getOidcConfig(stateData.appId);
      const frontendUrl = config?.redirect_uri?.replace('/api/v1/oidc/callback', '') || '';
      
      // Redirect to frontend with token in URL fragment (more secure than query param)
      return reply.redirect(`${frontendUrl}/login?token=${token}&role=${user.role}`);
    } catch (err) {
      fastify.log.error({ err }, 'OIDC callback failed');
      const { statusCode, response } = createErrorResponse(err, {
        statusCode: 500,
        code: 'OIDCCallbackError',
      });
      return reply.status(statusCode).send(response);
    }
  });
  
  // Get OIDC login URL (for frontend to initiate login)
  fastify.get('/oidc/login-url', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          api_key: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    // Get app from API key (header or query param)
    const apiKey = request.headers['x-api-key'] || request.query.api_key;
    
    if (!apiKey) {
      const { statusCode, response } = handleValidationError('X-API-Key header or api_key query param required');
      return reply.status(statusCode).send(response);
    }
    
    const app = await getAppByApiKey(apiKey);
    
    if (!app) {
      const { statusCode, response } = handleAuthError('Invalid API key');
      return reply.status(statusCode).send(response);
    }
    
    // Check if OIDC is configured
    const config = await getOidcConfig(app.id);
    
    if (!config || !config.is_enabled) {
      return { 
        enabled: false,
        login_url: null,
      };
    }
    
    // Return URL for frontend to redirect to
    return {
      enabled: true,
      login_url: `/api/v1/oidc/login?api_key=${apiKey}`,
    };
  });
}
