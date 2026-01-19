import { checkConnection } from '../db/pool.js';
import { createErrorResponse } from '../utils/errorHandler.js';

export default async function healthRoutes(fastify) {
  // Health check - basic liveness
  fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });
  
  // Readiness check - includes DB connectivity
  fastify.get('/ready', async (request, reply) => {
    const dbConnected = await checkConnection();
    
    if (!dbConnected) {
      const { statusCode, response } = createErrorResponse('Database connection failed', {
        statusCode: 503,
        code: 'ServiceUnavailable',
      });
      return reply.status(statusCode).send({
        ...response,
        status: 'not ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'disconnected',
        },
      });
    }
    
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
      checks: {
        database: 'connected',
      },
    };
  });
}

