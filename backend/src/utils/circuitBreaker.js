import CircuitBreaker from 'opossum';
import logger from './logger.js';

// Store circuit breakers per source
const breakers = new Map();

const defaultOptions = {
  timeout: 30000,           // 30 seconds
  errorThresholdPercentage: 50,
  resetTimeout: 30000,      // 30 seconds before trying again
  volumeThreshold: 5,       // Minimum requests before tripping
};

/**
 * Get or create a circuit breaker for a source
 * @param {string} sourceId - Source ID
 * @param {Function} action - Async function to protect
 * @param {object} options - Circuit breaker options
 * @returns {CircuitBreaker} - Circuit breaker instance
 */
export function getCircuitBreaker(sourceId, action, options = {}) {
  const key = `source:${sourceId}`;
  
  if (!breakers.has(key)) {
    const breaker = new CircuitBreaker(action, {
      ...defaultOptions,
      ...options,
      name: key,
    });
    
    breaker.on('open', () => {
      logger.warn({ sourceId }, 'Circuit breaker OPENED for source');
    });
    
    breaker.on('halfOpen', () => {
      logger.info({ sourceId }, 'Circuit breaker HALF-OPEN for source');
    });
    
    breaker.on('close', () => {
      logger.info({ sourceId }, 'Circuit breaker CLOSED for source');
    });
    
    breaker.on('fallback', () => {
      logger.warn({ sourceId }, 'Circuit breaker FALLBACK triggered for source');
    });
    
    breakers.set(key, breaker);
  }
  
  return breakers.get(key);
}

/**
 * Get circuit breaker stats for a source
 * @param {string} sourceId - Source ID
 * @returns {object|null} - Stats or null if no breaker exists
 */
export function getCircuitBreakerStats(sourceId) {
  const key = `source:${sourceId}`;
  const breaker = breakers.get(key);
  
  if (!breaker) return null;
  
  return {
    state: breaker.isOpen() ? 'open' : (breaker.isHalfOpen() ? 'half-open' : 'closed'),
    stats: breaker.stats,
  };
}

/**
 * Get all circuit breaker stats
 * @returns {object} - Map of sourceId to stats
 */
export function getAllCircuitBreakerStats() {
  const stats = {};
  for (const [key, breaker] of breakers) {
    const sourceId = key.replace('source:', '');
    stats[sourceId] = {
      state: breaker.isOpen() ? 'open' : (breaker.isHalfOpen() ? 'half-open' : 'closed'),
      stats: breaker.stats,
    };
  }
  return stats;
}

/**
 * Reset a circuit breaker
 * @param {string} sourceId - Source ID
 */
export function resetCircuitBreaker(sourceId) {
  const key = `source:${sourceId}`;
  const breaker = breakers.get(key);
  if (breaker) {
    breaker.close();
  }
}

export default {
  getCircuitBreaker,
  getCircuitBreakerStats,
  getAllCircuitBreakerStats,
  resetCircuitBreaker,
};

