import crypto from 'crypto';

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if strings are equal
 */
export function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  
  // Use crypto.timingSafeEqual for constant-time comparison
  if (a.length !== b.length) {
    // Still compare to prevent timing leaks from length differences
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b + ' '));
    return false;
  }
  
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    // If timingSafeEqual fails (shouldn't happen), fall back to regular comparison
    return a === b;
  }
}

/**
 * Add random delay to authentication failures to prevent timing attacks
 * @param {number} baseDelayMs - Base delay in milliseconds
 * @param {number} maxJitterMs - Maximum random jitter in milliseconds
 * @returns {Promise<void>}
 */
export async function addAuthFailureDelay(baseDelayMs = 100, maxJitterMs = 50) {
  const jitter = Math.random() * maxJitterMs;
  const delay = baseDelayMs + jitter;
  await new Promise(resolve => setTimeout(resolve, delay));
}

export default {
  constantTimeCompare,
  addAuthFailureDelay,
};


