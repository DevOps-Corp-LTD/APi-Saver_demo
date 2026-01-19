import crypto from 'crypto';
import config from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string value
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Base64 encoded encrypted value (iv:authTag:encrypted)
 */
export function encrypt(text) {
  if (!text) return null;
  
  // Validate encryption key format
  if (!/^[0-9a-fA-F]{64}$/.test(config.encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256)');
  }
  
  const key = Buffer.from(config.encryptionKey, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)');
  }
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string
 * @param {string} encryptedText - Encrypted value (iv:authTag:encrypted format)
 * @returns {string} - Decrypted plain text
 */
export function decrypt(encryptedText) {
  if (!encryptedText) return null;
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format');
  }
  
  const key = Buffer.from(config.encryptionKey, 'hex');
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Hash a value using SHA-256
 * @param {string} value - Value to hash
 * @returns {string} - Hex-encoded hash
 */
export function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Generate a secure random API key
 * @param {string} prefix - Optional prefix for the key
 * @returns {string} - Generated API key
 */
export function generateApiKey(prefix = 'ask') {
  const randomPart = crypto.randomBytes(24).toString('base64url');
  return `${prefix}_${randomPart}`;
}

/**
 * Mask a secret for display (show only first/last few chars)
 * @param {string} secret - Secret to mask
 * @param {number} visibleChars - Number of visible chars at start/end
 * @returns {string} - Masked secret
 */
export function maskSecret(secret, visibleChars = 4) {
  if (!secret || secret.length <= visibleChars * 2) {
    return '****';
  }
  const start = secret.substring(0, visibleChars);
  const end = secret.substring(secret.length - visibleChars);
  return `${start}${'*'.repeat(8)}${end}`;
}

export default { encrypt, decrypt, hash, generateApiKey, maskSecret };

