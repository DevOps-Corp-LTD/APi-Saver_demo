import { getAllConfigs, setConfigValue, deleteConfigValue, setMultipleConfigs, getConfigValue } from '../services/configService.js';
import { logAudit } from '../services/auditService.js';

export default async function configRoutes(fastify) {
  // Get all configs (admin only)
  fastify.get('/config', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
  }, async (request, reply) => {
    const configs = await getAllConfigs(request.appId);
    return { configs };
  });
  
  // Set a config value (admin only)
  fastify.post('/config', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[a-z0-9_]+$' },
          value: { type: 'string' },
          is_secret: { type: 'boolean', default: false },
        },
      },
    },
  }, async (request, reply) => {
    const { key, value, is_secret } = request.body;
    
    const config = await setConfigValue(request.appId, key, value, is_secret);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'config_update',
      resource_type: 'config',
      new_value: { key, is_secret },
      ip_address: request.ip,
    });
    
    return config;
  });
  
  // Set multiple configs at once (admin only)
  fastify.put('/config', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        additionalProperties: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: {
                value: { type: 'string' },
                isSecret: { type: 'boolean' },
              },
            },
          ],
        },
      },
    },
  }, async (request, reply) => {
    const configs = await setMultipleConfigs(request.appId, request.body);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'config_bulk_update',
      resource_type: 'config',
      new_value: { keys: Object.keys(request.body) },
      ip_address: request.ip,
    });
    
    return { configs };
  });
  
  // Delete a config value (admin only)
  fastify.delete('/config/:key', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      params: {
        type: 'object',
        properties: {
          key: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const deleted = await deleteConfigValue(request.appId, request.params.key);
    
    if (deleted) {
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'config_delete',
        resource_type: 'config',
        old_value: { key: request.params.key },
        ip_address: request.ip,
      });
    }
    
    return { success: deleted };
  });

  // Kill switch endpoint (admin only)
  fastify.get('/config/kill-switch', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
  }, async (request, reply) => {
    const { query } = await import('../db/pool.js');
    
    // Get app-level kill switch from config
    const appKillSwitchConfig = await getConfigValue(request.appId, 'kill_switch_enabled');
    const appKillSwitch = appKillSwitchConfig === 'true' || appKillSwitchConfig === true;
    
    // Get source-level kill switches
    const sourcesResult = await query(
      `SELECT id, name, kill_switch_enabled FROM app_sources WHERE app_id = $1`,
      [request.appId]
    );
    
    return {
      enabled: appKillSwitch,
      app_level: appKillSwitch,
      sources: sourcesResult.rows.map(s => ({
        id: s.id,
        name: s.name,
        enabled: s.kill_switch_enabled || false,
      })),
    };
  });

  // Toggle kill switch (admin only)
  fastify.post('/config/kill-switch', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: {
          enabled: { type: 'boolean' },
          source_id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    const { enabled, source_id } = request.body;
    const { query } = await import('../db/pool.js');
    
    if (source_id) {
      // Update source-level kill switch
      await query(
        `UPDATE app_sources SET kill_switch_enabled = $1 WHERE id = $2 AND app_id = $3`,
        [enabled, source_id, request.appId]
      );
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'kill_switch_update',
        resource_type: 'source',
        resource_id: source_id,
        new_value: { enabled, level: 'source' },
        ip_address: request.ip,
      });
      
      return { enabled, source_id, level: 'source' };
    } else {
      // Update app-level kill switch via config
      await setConfigValue(request.appId, 'kill_switch_enabled', enabled.toString(), false);
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'kill_switch_update',
        resource_type: 'app',
        new_value: { enabled, level: 'app' },
        ip_address: request.ip,
      });
      
      return { enabled, level: 'app' };
    }
  });
}

