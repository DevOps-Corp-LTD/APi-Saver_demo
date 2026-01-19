import 'dotenv/config';

// Construct DATABASE_URL from individual components if not set
// Docker Compose doesn't recursively expand variables in default values
function getDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  
  // Construct from individual environment variables (set by docker-compose)
  const user = process.env.POSTGRES_USER || 'apisaver';
  const password = process.env.POSTGRES_PASSWORD || 'apisaver';
  const host = process.env.POSTGRES_HOST || 'postgres';
  const port = process.env.POSTGRES_PORT || '5432';
  const database = process.env.POSTGRES_DB || 'apisaver';
  
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

export const config = {
  // Database
  databaseUrl: getDatabaseUrl(),
  
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // JWT
  jwtSecret: process.env.JWT_SECRET || 'change-me-to-a-strong-secret-key',
  
  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  
  // Cache
  defaultCacheTtl: parseInt(process.env.DEFAULT_CACHE_TTL || '0', 10), // 0 = forever
  sourceSelectionMode: process.env.SOURCE_SELECTION_MODE || 'priority',
  
  // Rate limiting
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  
  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(s => s.trim()),
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Redis (optional - for HA deployments)
  redisUrl: process.env.REDIS_URL || null,
};

// Validate production secrets
// Only validate if explicitly set to production (not just default)
if (process.env.NODE_ENV === 'production') {
  const defaultJwtSecret = 'change-me-to-a-strong-secret-key';
  const defaultEncryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const devJwtSecret = 'dev-jwt-secret-change-me-in-production';
  
  // Require JWT_SECRET in production
  if (!process.env.JWT_SECRET || 
      config.jwtSecret === defaultJwtSecret || 
      config.jwtSecret === devJwtSecret) {
    throw new Error('JWT_SECRET environment variable must be set to a strong secret in production');
  }
  
  // Require ENCRYPTION_KEY in production
  if (!process.env.ENCRYPTION_KEY || config.encryptionKey === defaultEncryptionKey) {
    throw new Error('ENCRYPTION_KEY environment variable must be set in production');
  }
  
  // Validate ENCRYPTION_KEY format (64 hex characters)
  if (!/^[0-9a-f]{64}$/i.test(config.encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hexadecimal characters in production');
  }
  
  // Warn if encryption key appears weak or predictable
  const keyBytes = Buffer.from(config.encryptionKey, 'hex');
  // Check for patterns that might indicate weak keys
  const allSame = keyBytes.every(byte => byte === keyBytes[0]);
  const sequential = keyBytes.every((byte, i) => i === 0 || byte === (keyBytes[i - 1] + 1) % 256);
  if (allSame || sequential) {
    throw new Error('ENCRYPTION_KEY appears weak or predictable. Use a cryptographically random key.');
  }
  
  // Check entropy (basic check - should have good distribution)
  const byteCounts = new Array(256).fill(0);
  keyBytes.forEach(byte => byteCounts[byte]++);
  const maxCount = Math.max(...byteCounts);
  // If any byte appears more than 4 times in a 32-byte key, it's suspicious
  if (maxCount > 4) {
    // Use console.warn here since config loads before logger is initialized
    // This is acceptable for early initialization warnings
    console.warn('WARNING: ENCRYPTION_KEY may have low entropy. Consider regenerating with cryptographically secure random bytes.');
  }
  
  // Require DATABASE_URL or POSTGRES_* variables in production
  // If DATABASE_URL is not set, POSTGRES_* variables will be used to construct it
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_PASSWORD) {
    throw new Error('Either DATABASE_URL or POSTGRES_PASSWORD (and related POSTGRES_* variables) must be set in production');
  }
}

export default config;

