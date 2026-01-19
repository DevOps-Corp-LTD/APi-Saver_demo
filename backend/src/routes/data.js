import { cacheOrFetch, listCacheEntries, getCacheStats, invalidateCacheEntry, purgeCache, bulkUpdateCacheEntries, invalidateCacheByPrefix, invalidateCacheByKeyPrefix, assignTagsToCacheEntries, removeTagsFromCacheEntries, invalidateCacheByTags, fixCacheEntryStoragePools } from '../services/cacheService.js';
import { query } from '../db/pool.js';
import { logAudit } from '../services/auditService.js';
import config from '../config/index.js';
import { createErrorResponse } from '../utils/errorHandler.js';

export default async function dataRoutes(fastify) {
  // Fetch data with caching
  fastify.post('/', {
    preHandler: [fastify.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['method', 'url'],
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] },
          url: { type: 'string' },
          body: { type: ['object', 'string', 'null'] },
          headers: { type: 'object' },
          force_refresh: { type: 'boolean', default: false },
          ttl: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { method, url, body, headers, force_refresh, ttl } = request.body;
    
    fastify.log.info({ method, url, hasBody: !!body }, '[/api/v1/data] Request received');
    
    try {
      const result = await cacheOrFetch(request.appId, {
        method,
        url,
        body,
        headers: headers || {},
        force_refresh,
        ttl,
      });
      
      fastify.log.info({ method, url, cached: result.cached, status: result.response.status }, '[/api/v1/data] Request completed');
      
      // Set cache headers
      reply.header('X-Cache', result.cached ? 'HIT' : 'MISS');
      reply.header('X-Cache-Key', result.cache_key);
      
      if (result.meta) {
        reply.header('X-Cache-Hits', result.meta.hit_count);
        if (result.meta.expires_at) {
          reply.header('X-Cache-Expires', result.meta.expires_at);
        }
      }
      
      // Always return 200 OK for our API response
      // The proxied response status is included in result.response.status
      reply.status(200);
      reply.header('Content-Type', 'application/json');
      
      // Set response headers from proxied response (for reference)
      if (result.response.headers) {
        const safeHeaders = ['content-type', 'cache-control', 'etag', 'last-modified'];
        for (const [key, value] of Object.entries(result.response.headers)) {
          if (safeHeaders.includes(key.toLowerCase())) {
            reply.header(`X-Proxied-${key}`, value);
          }
        }
      }
      
      // Return full result object wrapped in data property
      return {
        data: result
      };
    } catch (err) {
      fastify.log.error({ err, url }, 'Cache fetch failed');
      const { statusCode, response } = createErrorResponse(err, {
        statusCode: 502,
        code: 'BadGateway',
        details: config.nodeEnv === 'development' ? err.message : undefined,
      });
      return reply.status(statusCode).send(response);
    }
  });
  
  // List cache entries
  fastify.get('/cache', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          expired: { type: 'boolean', default: false },
          source_id: { type: 'string', format: 'uuid' },
          storage_pool_id: { 
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'string', enum: [''] }  // Empty string for dedicated mode
            ]
          },
          search: { type: 'string' },
          sort_field: { type: 'string' },
          sort_order: { type: 'string', enum: ['asc', 'desc'] },
          status_code: { type: 'string' },
          method: { type: 'string' },
          content_type: { type: 'string' },
          hit_count_min: { type: 'integer' },
          hit_count_max: { type: 'integer' },
          created_after: { type: 'string' },
          created_before: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { 
        page, 
        limit, 
        expired, 
        source_id, 
        storage_pool_id,
        search,
        sort_field,
        sort_order,
        status_code,
        method,
        content_type,
        hit_count_min,
        hit_count_max,
        created_after,
        created_before,
      } = request.query;
      // Handle storage_pool_id: empty string or '__dedicated__' for dedicated, UUID for pool, undefined/null for all
      // Keep empty string as-is (don't convert to null) so listCacheEntries can distinguish between "all" and "dedicated"
      const poolId = storage_pool_id === '' || storage_pool_id === '__dedicated__' ? '' : (storage_pool_id || undefined);
      
      // Debug logging
      if (storage_pool_id === '' || storage_pool_id === '__dedicated__') {
        fastify.log.debug({ originalStoragePoolId: storage_pool_id, convertedPoolId: poolId }, '[data.js] Dedicated filter requested');
      }
      
      const result = await listCacheEntries(request.appId, {
        page,
        limit,
        expired,
        source_id,
        storage_pool_id: poolId,
        search,
        sort_field,
        sort_order,
        status_code,
        method,
        content_type,
        hit_count_min,
        hit_count_max,
        created_after,
        created_before,
      });
      return result;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error listing cache entries');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve cache entries',
      });
    }
  });
  
  // Get cache statistics
  fastify.get('/stats', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          storage_pool_id: { 
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'string', enum: [''] }  // Empty string for dedicated mode
            ]
          },
          source_id: { type: 'string', format: 'uuid' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { storage_pool_id, source_id } = request.query;
      // Convert empty string to null for dedicated mode filtering
      const poolId = storage_pool_id === '' ? null : storage_pool_id;
      const stats = await getCacheStats(request.appId, {
        storage_pool_id: poolId,
        source_id: source_id || undefined,
      });
      return stats;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error getting cache stats');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve cache statistics',
      });
    }
  });
  
  // Invalidate cache entry
  fastify.delete('/cache', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['cache_key'],
        properties: {
          cache_key: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { cache_key } = request.body;
    const invalidated = await invalidateCacheEntry(request.appId, cache_key);
    
    if (invalidated) {
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'cache_invalidate',
        resource_type: 'cache',
        new_value: { cache_key },
        ip_address: request.ip,
      });
    }
    
    return { success: invalidated };
  });
  
  // Purge all cache entries
  fastify.post('/cache/purge', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
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
    
    const purged = await purgeCache(request.appId);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_purge',
      resource_type: 'cache',
      new_value: { entries_purged: purged },
      ip_address: request.ip,
    });
    
    return { success: true, entries_purged: purged };
  });

  // Invalidate cache entries by URL prefix
  fastify.post('/cache/invalidate/prefix', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['prefix'],
        properties: {
          prefix: { type: 'string' },
          prefix_type: { type: 'string', enum: ['url', 'key'], default: 'url' },
          source_id: { type: 'string', format: 'uuid' },
          storage_pool_id: { 
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'string', enum: [''] }
            ]
          },
        },
      },
    },
  }, async (request, reply) => {
    const { prefix, prefix_type = 'url', source_id, storage_pool_id } = request.body;
    
    const options = {};
    if (source_id) options.source_id = source_id;
    if (storage_pool_id !== undefined) options.storage_pool_id = storage_pool_id === '' ? null : storage_pool_id;
    
    const invalidated = prefix_type === 'key'
      ? await invalidateCacheByKeyPrefix(request.appId, prefix, options)
      : await invalidateCacheByPrefix(request.appId, prefix, options);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_invalidate_prefix',
      resource_type: 'cache',
      new_value: { 
        prefix, 
        prefix_type,
        entries_invalidated: invalidated,
        source_id,
        storage_pool_id,
      },
      ip_address: request.ip,
    });
    
    return { success: true, entries_invalidated: invalidated };
  });

  // Assign tags to cache entries
  fastify.post('/cache/tags/assign', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['entry_ids', 'tags'],
        properties: {
          entry_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
        },
      },
    },
  }, async (request, reply) => {
    const { entry_ids, tags } = request.body;
    
    const updated = await assignTagsToCacheEntries(request.appId, entry_ids, tags);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_tags_assign',
      resource_type: 'cache',
      new_value: { 
        entry_count: updated,
        tags,
      },
      ip_address: request.ip,
    });
    
    return { success: true, entries_updated: updated };
  });

  // Remove tags from cache entries
  fastify.post('/cache/tags/remove', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['entry_ids', 'tags'],
        properties: {
          entry_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
        },
      },
    },
  }, async (request, reply) => {
    const { entry_ids, tags } = request.body;
    
    const updated = await removeTagsFromCacheEntries(request.appId, entry_ids, tags);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_tags_remove',
      resource_type: 'cache',
      new_value: { 
        entry_count: updated,
        tags,
      },
      ip_address: request.ip,
    });
    
    return { success: true, entries_updated: updated };
  });

  // Invalidate cache entries by tags
  fastify.post('/cache/invalidate/tags', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['tags'],
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
          },
          match_all: { type: 'boolean', default: false },
          source_id: { type: 'string', format: 'uuid' },
          storage_pool_id: { 
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'string', enum: [''] }
            ]
          },
        },
      },
    },
  }, async (request, reply) => {
    const { tags, match_all = false, source_id, storage_pool_id } = request.body;
    
    const options = { match_all };
    if (source_id) options.source_id = source_id;
    if (storage_pool_id !== undefined) options.storage_pool_id = storage_pool_id === '' ? null : storage_pool_id;
    
    const invalidated = await invalidateCacheByTags(request.appId, tags, options);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_invalidate_tags',
      resource_type: 'cache',
      new_value: { 
        tags,
        match_all,
        entries_invalidated: invalidated,
        source_id,
        storage_pool_id,
      },
      ip_address: request.ip,
    });
    
    return { success: true, entries_invalidated: invalidated };
  });

  // Bulk update cache entries expiration time
  fastify.patch('/cache/bulk-update', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['entry_ids', 'ttl_seconds'],
        properties: {
          entry_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 1,
          },
          ttl_seconds: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const { entry_ids, ttl_seconds } = request.body;
    
    const updated = await bulkUpdateCacheEntries(request.appId, entry_ids, ttl_seconds);
    
    await logAudit({
      app_id: request.appId,
      user_id: request.userId,
      action: 'cache_bulk_update',
      resource_type: 'cache',
      new_value: { 
        entry_count: updated,
        ttl_seconds,
      },
      ip_address: request.ip,
    });
    
    return { success: true, entries_updated: updated };
  });

  // Revalidate cache entry (stale-while-revalidate)
  fastify.post('/cache/revalidate', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
    schema: {
      body: {
        type: 'object',
        required: ['cache_key'],
        properties: {
          cache_key: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const { cache_key } = request.body;
    
    const { revalidateCacheEntry } = await import('../services/revalidationService.js');
    const result = await revalidateCacheEntry(request.appId, cache_key);
    
    if (result) {
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'cache_revalidate',
        resource_type: 'cache',
        new_value: { cache_key },
        ip_address: request.ip,
      });
    }
    
    return { success: !!result, cached: result?.cached || false };
  });

  // Get advanced analytics
  fastify.get('/cache/analytics', {
    preHandler: [fastify.authenticate],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          time_range: { type: 'string', enum: ['1h', '24h', '7d', '30d'], default: '24h' },
          source_id: { type: 'string', format: 'uuid' },
          storage_pool_id: { 
            oneOf: [
              { type: 'string', format: 'uuid' },
              { type: 'string', enum: [''] }
            ]
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const { time_range = '24h', source_id, storage_pool_id } = request.query;
      
      fastify.log.debug({ time_range, appId: request.appId }, 'Cache analytics request');
      
      // Calculate the cutoff timestamp in milliseconds, then create Date object
      // This ensures we're working with UTC timestamps consistently
      const nowMs = Date.now();
      let hoursAgo = 24; // Default
      
      if (time_range === '1h') {
        hoursAgo = 1;
      } else if (time_range === '24h') {
        hoursAgo = 24;
      } else if (time_range === '7d') {
        hoursAgo = 7 * 24;
      } else if (time_range === '30d') {
        hoursAgo = 30 * 24;
      }
      
      // Calculate the cutoff time in milliseconds
      const sinceMs = nowMs - (hoursAgo * 60 * 60 * 1000);
      const sinceDate = new Date(sinceMs);
      
      fastify.log.info({ 
        time_range, 
        hoursAgo,
        now: new Date(nowMs).toISOString(),
        since: sinceDate.toISOString(),
        sinceMs,
        nowMs
      }, 'Calculated time range');
      
      // Use parameterized query - PostgreSQL will handle the Date object correctly
      let whereClause = 'WHERE ce.app_id = $1 AND ce.created_at >= $2';
      const params = [request.appId, sinceDate];
      let paramIndex = 3;
      
      // Test query to verify date filtering works
      const testQuery = 'SELECT COUNT(*) as count FROM cache_entries ce WHERE ce.app_id = $1 AND ce.created_at >= $2';
      try {
        const testResult = await query(testQuery, [request.appId, sinceDate]);
        const entryCount = parseInt(testResult.rows[0]?.count || 0, 10);
        fastify.log.info({ 
          time_range, 
          since: sinceDate.toISOString(),
          entryCount 
        }, 'Test query: entries in time range');
      } catch (testError) {
        fastify.log.error({ 
          time_range,
          error: testError.message,
          query: testQuery,
          since: sinceDate.toISOString()
        }, 'Test query failed');
      }
      
      if (source_id) {
        whereClause += ` AND ce.source_id = $${paramIndex}`;
        params.push(source_id);
        paramIndex++;
      }
      
      if (storage_pool_id !== null && storage_pool_id !== undefined) {
        if (storage_pool_id === '') {
          whereClause += ' AND ce.storage_pool_id IS NULL';
        } else {
          whereClause += ` AND ce.storage_pool_id = $${paramIndex}`;
          params.push(storage_pool_id);
          paramIndex++;
        }
      }
      
      // Determine bucket size based on time range
      // Use valid PostgreSQL DATE_TRUNC units: minute, hour, day
      let bucketSize = 'hour'; // Default for 24h
      if (time_range === '1h') {
        bucketSize = 'minute';
      } else if (time_range === '7d' || time_range === '30d') {
        bucketSize = 'day';
      }
      
      // Validate bucket size to prevent SQL injection
      const validBucketSizes = ['minute', 'hour', 'day'];
      if (!validBucketSizes.includes(bucketSize)) {
        bucketSize = 'hour'; // Fallback to hour
      }
      
      // Hit rate over time (dynamic buckets based on time range)
      // Build query with validated bucket size
      const hitRateQuery = `SELECT 
           DATE_TRUNC('${bucketSize}', ce.created_at) as time,
           COUNT(*) FILTER (WHERE ce.hit_count > 0) as hits,
           COUNT(*) FILTER (WHERE ce.hit_count = 0) as misses
         FROM cache_entries ce
         ${whereClause}
         GROUP BY DATE_TRUNC('${bucketSize}', ce.created_at)
         ORDER BY time`;
      
      fastify.log.info({ 
        time_range, 
        bucketSize,
        since: sinceDate.toISOString(),
        query: hitRateQuery.substring(0, 300),
        paramCount: params.length
      }, 'Executing hit rate query');
      
      let hitRateResult;
      try {
        hitRateResult = await query(hitRateQuery, params);
        fastify.log.info({ 
          time_range, 
          hitRateRows: hitRateResult.rows?.length || 0,
          sampleRow: hitRateResult.rows?.[0]
        }, 'Hit rate query results');
      } catch (queryError) {
        fastify.log.error({ 
          time_range,
          bucketSize,
          error: queryError.message,
          stack: queryError.stack,
          query: hitRateQuery,
          params: params.map((p, i) => ({ index: i, value: p instanceof Date ? p.toISOString() : p }))
        }, 'Hit rate query failed');
        throw queryError;
      }
      
      // Status code distribution
      const statusResult = await query(
        `SELECT 
           ce.response_status as status,
           COUNT(*) as count
         FROM cache_entries ce
         ${whereClause}
         GROUP BY ce.response_status
         ORDER BY count DESC`,
        params
      );
      
      // Top URLs by hits
      const topUrlsResult = await query(
        `SELECT 
           ce.request_url as url,
           COALESCE(SUM(ce.hit_count), 0) as hits,
           COUNT(*) as entries
         FROM cache_entries ce
         ${whereClause}
         GROUP BY ce.request_url
         ORDER BY hits DESC
         LIMIT 10`,
        params
      );
      
      // Cache size trend (dynamic buckets based on time range)
      let sizeTrendBucketSize = time_range === '1h' ? 'minute' : (time_range === '24h' ? 'hour' : 'day');
      // Validate bucket size
      if (!validBucketSizes.includes(sizeTrendBucketSize)) {
        sizeTrendBucketSize = 'hour'; // Fallback to hour
      }
      
      const sizeTrendQuery = `SELECT 
           DATE_TRUNC('${sizeTrendBucketSize}', ce.created_at) as time,
           COALESCE(SUM(COALESCE(pg_column_size(ce.response_body), 0) + COALESCE(octet_length(COALESCE(ce.response_body_raw, '')), 0)), 0) / 1024.0 / 1024.0 as size_mb
         FROM cache_entries ce
         ${whereClause}
         GROUP BY DATE_TRUNC('${sizeTrendBucketSize}', ce.created_at)
         ORDER BY time`;
      
      fastify.log.info({ 
        time_range, 
        sizeTrendBucketSize,
        query: sizeTrendQuery
      }, 'Executing size trend query');
      
      let sizeTrendResult;
      try {
        sizeTrendResult = await query(sizeTrendQuery, params);
        fastify.log.info({ 
          time_range, 
          sizeTrendRows: sizeTrendResult.rows?.length || 0
        }, 'Size trend query results');
      } catch (queryError) {
        fastify.log.error({ 
          time_range,
          sizeTrendBucketSize,
          error: queryError.message,
          query: sizeTrendQuery
        }, 'Size trend query failed');
        throw queryError;
      }
      
      // Source contribution
      const sourceContributionResult = await query(
        `SELECT 
           src.id as source_id,
           src.name as source,
           COUNT(*) as entries,
           COALESCE(SUM(ce.hit_count), 0) as hits
         FROM cache_entries ce
         LEFT JOIN app_sources src ON ce.source_id = src.id
         ${whereClause}
         GROUP BY src.id, src.name
         ORDER BY entries DESC
         LIMIT 10`,
        params
      );
      
      // Always return a consistent response structure, even if empty
      const response = {
        hit_rate: (hitRateResult?.rows || []).map(r => ({
          time: r.time,
          hits: parseInt(r.hits || 0, 10),
          misses: parseInt(r.misses || 0, 10),
        })),
        status_distribution: (statusResult?.rows || []).map(r => ({
          status: r.status,
          value: parseInt(r.count || 0, 10),
        })),
        top_urls: (topUrlsResult?.rows || []).map(r => ({
          url: r.url,
          hits: parseInt(r.hits || 0, 10),
          entries: parseInt(r.entries || 0, 10),
        })),
        size_trend: (sizeTrendResult?.rows || []).map(r => ({
          time: r.time,
          size: parseFloat(r.size_mb || 0),
        })),
        source_contribution: (sourceContributionResult?.rows || []).map(r => ({
          source: r.source || 'Unknown',
          entries: parseInt(r.entries || 0, 10),
          hits: parseInt(r.hits || 0, 10),
        })),
      };
      
      fastify.log.info({ 
        time_range, 
        hitRateCount: response.hit_rate.length,
        statusCount: response.status_distribution.length,
        topUrlsCount: response.top_urls.length,
        sizeTrendCount: response.size_trend.length,
        sourceContributionCount: response.source_contribution.length,
        hasData: response.hit_rate.length > 0 || response.status_distribution.length > 0 || response.top_urls.length > 0
      }, 'Analytics response summary');
      
      return response;
    } catch (err) {
      fastify.log.error({ 
        err, 
        appId: request.appId, 
        time_range: request.query?.time_range,
        errorMessage: err.message,
        errorStack: err.stack 
      }, 'Error getting cache analytics');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to retrieve cache analytics',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    }
  });

  // Fix cache entries with incorrect storage_pool_id (admin only)
  fastify.post('/cache/fix-storage-pools', {
    preHandler: [fastify.authenticate, fastify.authorizeRole(['admin'])],
  }, async (request, reply) => {
    try {
      const result = await fixCacheEntryStoragePools(request.appId);
      
      await logAudit({
        app_id: request.appId,
        user_id: request.userId,
        action: 'cache_fix_storage_pools',
        resource_type: 'cache',
        new_value: result,
        ip_address: request.ip,
      });
      
      return result;
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error fixing cache storage pools');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message: 'Failed to fix cache storage pools',
      });
    }
  });
}
