import fp from 'fastify-plugin';
import { getAppByApiKey } from '../services/appService.js';

async function authPlugin(fastify) {
  // API Key authentication for data endpoints
  fastify.decorate('authenticateApiKey', async function (request, reply) {
    const apiKey = request.headers['x-api-key'] || request.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'API key required',
      });
    }
    
    const app = await getAppByApiKey(apiKey);
    
    if (!app) {
      // Add delay to prevent timing attacks
      await addAuthFailureDelay();
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid API key',
      });
    }
    
    request.app = app;
    request.appId = app.id;
    request.userRole = 'admin'; // API key users are treated as admins
  });
  
  // JWT authentication for UI endpoints
  fastify.decorate('authenticateJwt', async function (request, reply) {
    try {
      await request.jwtVerify();
      request.appId = request.user.appId;
      request.userId = request.user.userId;
      request.userEmail = request.user.email;
      request.userRole = request.user.role || 'viewer';
    } catch (err) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }
  });
  
  // Combined auth - accepts either API key or JWT
  fastify.decorate('authenticate', async function (request, reply) {
    const apiKey = request.headers['x-api-key'];
    const authHeader = request.headers['authorization'];
    
    // Try API key first
    if (apiKey) {
      const app = await getAppByApiKey(apiKey);
      if (app) {
        request.app = app;
        request.appId = app.id;
        request.userRole = 'admin'; // API key users are treated as admins
        return;
      }
    }
    
    // Try JWT
    if (authHeader?.startsWith('Bearer ')) {
      try {
        await request.jwtVerify();
        request.appId = request.user.appId;
        request.userId = request.user.userId;
        request.userEmail = request.user.email;
        request.userRole = request.user.role || 'viewer';
        return;
      } catch {
        // Fall through to error
      }
    }
    
    // Add delay before returning error to prevent timing attacks
    await addAuthFailureDelay();
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Valid API key or JWT required',
    });
  });
  
  // Role-based authorization decorator
  // Usage: preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])]
  fastify.decorate('authorizeRole', function (allowedRoles) {
    return async function (request, reply) {
      const userRole = request.userRole;
      
      if (!userRole || !allowedRoles.includes(userRole)) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
        });
      }
    };
  });
}

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/jwt'],
});

