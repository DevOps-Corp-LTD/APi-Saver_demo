import { query } from '../db/pool.js';
import { getAllCircuitBreakerStats } from '../utils/circuitBreaker.js';
import { getCostMetrics } from '../services/costService.js';
import { createErrorResponse } from '../utils/errorHandler.js';

export default async function metricsRoutes(fastify) {
  // Get metrics (JSON format for frontend)
  fastify.get('/metrics/json', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const appId = request.appId;
      fastify.log.info({ appId }, 'Metrics endpoint called');
      
      // Get cache statistics
      const cacheStats = await query(
        `SELECT 
           COALESCE(SUM(hit_count), 0)::bigint as total_hits,
           COUNT(*) FILTER (WHERE expires_at > NOW() OR expires_at IS NULL)::bigint as active_entries,
           COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW())::bigint as expired_entries,
           COUNT(*)::bigint as total_entries
         FROM cache_entries
         WHERE app_id = $1`,
        [appId]
      );
      
      const row = cacheStats.rows[0] || {};
      const totalHits = Number(row.total_hits || 0);
      const activeEntries = Number(row.active_entries || 0);
      const expiredEntries = Number(row.expired_entries || 0);
      const totalEntries = Number(row.total_entries || 0);
      
      // Calculate cache misses
      // Each cache entry represents 1 initial request (MISS) that created it
      // So total misses = total entries (the requests that created them)
      const cacheMisses = totalEntries;
      
      // Get circuit breaker stats
      let circuitBreakers = {};
      let errors = 0;
      let totalDuration = 0;
      let totalRequestsWithDuration = 0;
      let totalCircuitBreakerRequests = 0; // Track total requests from circuit breakers
      let foundMatchingSources = false; // Track if we found any matching sources
      let appSourceIds = new Set(); // Track app source IDs for fallback logic
      
      try {
        // Get source IDs for this app to filter circuit breaker stats
        const appSources = await query(
          `SELECT id FROM app_sources WHERE app_id = $1`,
          [appId]
        );
        // Convert to strings to ensure proper comparison with circuit breaker keys
        appSourceIds = new Set(appSources.rows.map(row => String(row.id)));
        
        circuitBreakers = getAllCircuitBreakerStats();
        
        // Debug logging (can be removed later)
        fastify.log.info({ 
          appId, 
          appSourceIds: Array.from(appSourceIds), 
          appSourceIdsCount: appSourceIds.size,
          circuitBreakerKeys: Object.keys(circuitBreakers),
          circuitBreakerCount: Object.keys(circuitBreakers).length,
          circuitBreakerSourceIds: Object.keys(circuitBreakers).map(id => String(id))
        }, 'Circuit breaker stats check');
        
        // Count errors from circuit breaker failures and calculate average duration
        for (const [sourceId, stats] of Object.entries(circuitBreakers)) {
          // Only count stats for sources belonging to this app
          // Ensure sourceId is a string for comparison
          const sourceIdStr = String(sourceId);
          const isInApp = appSourceIds.has(sourceIdStr);
          
          if (!isInApp) {
            fastify.log.info({ 
              sourceId: sourceIdStr, 
              sourceIdType: typeof sourceId,
              appSourceIds: Array.from(appSourceIds),
              matchFound: false
            }, 'Skipping circuit breaker - source not in app');
            continue;
          }
          
          foundMatchingSources = true; // We found at least one matching source
          
          fastify.log.info({ 
            sourceId: sourceIdStr,
            isInApp: true,
            statsExists: !!stats,
            statsStatsExists: !!(stats && stats.stats)
          }, 'Processing circuit breaker for source');
          
          if (stats && stats.stats) {
            const failures = Number(stats.stats.failures || 0);
            const fires = Number(stats.stats.fires || 0);
            const successes = Number(stats.stats.successes || 0);
            errors += failures;
            totalCircuitBreakerRequests += fires; // Sum all requests from circuit breakers
            
            fastify.log.info({ 
              sourceId: sourceIdStr, 
              fires, 
              failures, 
              successes,
              totalCircuitBreakerRequests 
            }, 'Circuit breaker stats for source');
            
            // Calculate average duration from circuit breaker latency stats
            // latencyMean is in milliseconds (already averaged for this source)
            // We need to weight it by the number of requests (fires) to get overall average
            const latencyMean = stats.stats.latencyMean;
            if (latencyMean != null && latencyMean > 0 && fires > 0) {
              // Weight the average by number of requests
              totalDuration += latencyMean * fires;
              totalRequestsWithDuration += fires;
            }
            
            circuitBreakers[sourceId] = {
              state: stats.state || 'closed',
              failures: failures,
              fires: fires,
              successes: successes,
            };
          }
        }
      } catch (err) {
        fastify.log.warn({ err }, 'Error getting circuit breaker stats');
        // Continue without circuit breaker data
      }
      
      // Calculate total requests
      // Priority: Circuit breaker stats > Cache-based stats
      // Circuit breaker tracks ALL requests regardless of caching policies
      // Cache-based: total_entries (misses) + total_hits (hits) = all requests that went through cache
      // Note: This may differ from Cost Savings which uses cache-based calculation only
      const cacheBasedRequests = totalEntries + totalHits;
      const hasCircuitBreakerData = Object.keys(circuitBreakers).length > 0;
      
      // Determine total requests with smart fallback logic
      let totalRequests;
      if (foundMatchingSources && totalCircuitBreakerRequests > 0) {
        // Best case: We found matching sources and have circuit breaker data
        totalRequests = totalCircuitBreakerRequests;
      } else if (hasCircuitBreakerData) {
        // Fallback: We have circuit breaker data (even if source IDs don't match)
        // Sum all circuit breaker fires - this ensures requests are counted when caching is disabled
        let allCircuitBreakerTotal = 0;
        for (const [sourceId, stats] of Object.entries(circuitBreakers)) {
          if (stats && stats.stats) {
            allCircuitBreakerTotal += Number(stats.stats.fires || 0);
          }
        }
        totalRequests = allCircuitBreakerTotal;
        
        if (!foundMatchingSources) {
          fastify.log.warn({ 
            appId,
            appSourceIds: Array.from(appSourceIds),
            circuitBreakerKeys: Object.keys(circuitBreakers),
            allCircuitBreakerTotal,
            totalCircuitBreakerRequests,
            reason: 'Source ID mismatch - using all circuit breaker stats as fallback'
          }, 'Using fallback: all circuit breaker stats');
        }
      } else {
        // Last resort: Use cache-based calculation (only works when caching is enabled)
        totalRequests = cacheBasedRequests;
      }
      
      // Debug logging (can be removed later)
      fastify.log.info({ 
        appId,
        cacheBasedRequests,
        totalCircuitBreakerRequests,
        totalRequests,
        totalEntries,
        totalHits,
        foundMatchingSources,
        hasCircuitBreakerData,
        circuitBreakerCount: Object.keys(circuitBreakers).length,
        calculationMethod: foundMatchingSources ? 'matched_sources' : (hasCircuitBreakerData ? 'all_circuit_breakers' : 'cache_based')
      }, 'Total requests calculation');
      
      const hitRatio = totalRequests > 0 ? (totalHits / totalRequests) : 0;
      
      // Calculate average response time in milliseconds
      const avgDurationMs = totalRequestsWithDuration > 0 
        ? totalDuration / totalRequestsWithDuration 
        : 0;
      
      // Get cost savings
      let costMetrics = null;
      try {
        costMetrics = await getCostMetrics(appId);
      } catch (err) {
        fastify.log.warn({ err }, 'Error getting cost metrics');
        // Continue without cost metrics
      }
      
      return {
        requests: {
          cache_hits: totalHits,
          cache_misses: cacheMisses,
          hit_ratio: hitRatio,
          errors: errors,
          total: totalRequests,
          avg_duration_ms: Math.round(avgDurationMs * 100) / 100, // Round to 2 decimal places
        },
        circuit_breakers: circuitBreakers,
        cache: {
          total_entries: totalEntries,
          active_entries: activeEntries,
          expired_entries: expiredEntries,
          total_hits: totalHits,
        },
        cost: costMetrics ? {
          saved_cost: costMetrics.saved_cost,
          avg_cost_per_call: costMetrics.avg_cost_per_call,
          currency: costMetrics.currency,
          breakdown: costMetrics.cost_breakdown,
        } : null,
      };
    } catch (err) {
      fastify.log.error({ err, appId: request.appId }, 'Error fetching metrics');
      const { statusCode, response } = createErrorResponse(err, {
        statusCode: 500,
        code: 'MetricsError',
      });
      return reply.status(statusCode).send(response);
    }
  });
}
