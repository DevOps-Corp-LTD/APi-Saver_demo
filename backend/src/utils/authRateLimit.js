/**
 * Simple in-memory rate limiter for authentication endpoints
 * Note: For production, consider using Redis-based rate limiting
 */
const loginAttempts = new Map();
const rotateKeyAttempts = new Map();

const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of loginAttempts.entries()) {
    if (data.expiresAt < now) {
      loginAttempts.delete(key);
    }
  }
  for (const [key, data] of rotateKeyAttempts.entries()) {
    if (data.expiresAt < now) {
      rotateKeyAttempts.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Rate limit middleware for login endpoint
 * Max 5 attempts per 15 minutes per IP
 */
export function loginRateLimit(request, reply, done) {
  const key = `login:${request.ip}`;
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 5;
  
  const attempt = loginAttempts.get(key);
  
  if (attempt && attempt.expiresAt > now) {
    if (attempt.count >= maxAttempts) {
      const retryAfterSeconds = Math.ceil((attempt.expiresAt - now) / 1000);
      reply.header('Retry-After', retryAfterSeconds);
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Too many login attempts. Please try again later.',
        retryAfter: retryAfterSeconds,
      });
    }
    attempt.count++;
  } else {
    loginAttempts.set(key, {
      count: 1,
      expiresAt: now + windowMs,
    });
  }
  
  done();
}

/**
 * Rate limit middleware for API key rotation
 * Max 3 rotations per hour per user/IP
 */
export function rotateKeyRateLimit(request, reply, done) {
  const key = request.userId ? `rotate:user:${request.userId}` : `rotate:ip:${request.ip}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour
  const maxAttempts = 3;
  
  const attempt = rotateKeyAttempts.get(key);
  
  if (attempt && attempt.expiresAt > now) {
    if (attempt.count >= maxAttempts) {
      const retryAfterSeconds = Math.ceil((attempt.expiresAt - now) / 1000);
      reply.header('Retry-After', retryAfterSeconds);
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Too many API key rotations. Please try again later.',
        retryAfter: retryAfterSeconds,
      });
    }
    attempt.count++;
  } else {
    rotateKeyAttempts.set(key, {
      count: 1,
      expiresAt: now + windowMs,
    });
  }
  
  done();
}

export default {
  loginRateLimit,
  rotateKeyRateLimit,
};
