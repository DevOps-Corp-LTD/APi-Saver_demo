/**
 * Sanitize user input to prevent XSS and injection attacks
 */

/**
 * Sanitize a string by removing potentially dangerous characters
 * @param {string} input - Input string
 * @returns {string} - Sanitized string
 */
export function sanitizeString(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  // Remove null bytes and control characters
  return input
    .replace(/\0/g, '')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .trim();
}

/**
 * Sanitize email address
 * @param {string} email - Email address
 * @returns {string} - Sanitized email
 */
export function sanitizeEmail(email) {
  if (typeof email !== 'string') {
    return email;
  }
  
  // Basic email validation and sanitization
  const sanitized = sanitizeString(email.toLowerCase());
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!emailRegex.test(sanitized)) {
    throw new Error('Invalid email format');
  }
  
  return sanitized;
}

/**
 * Sanitize a name field (user names, app names, etc.)
 * @param {string} name - Name to sanitize
 * @param {number} maxLength - Maximum length
 * @returns {string} - Sanitized name
 */
export function sanitizeName(name, maxLength = 255) {
  if (typeof name !== 'string') {
    return name;
  }
  
  // Remove HTML tags and dangerous characters
  const sanitized = sanitizeString(name)
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>\"'&]/g, '') // Remove potentially dangerous characters
    .substring(0, maxLength);
  
  return sanitized;
}

/**
 * Sanitize URL (basic sanitization - full validation should use urlValidation.js)
 * @param {string} url - URL to sanitize
 * @returns {string} - Sanitized URL
 */
export function sanitizeUrl(url) {
  if (typeof url !== 'string') {
    return url;
  }
  
  return sanitizeString(url.trim());
}

/**
 * Sanitize an object by sanitizing all string values
 * @param {object} obj - Object to sanitize
 * @returns {object} - Sanitized object
 */
export function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }
  
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

export default {
  sanitizeString,
  sanitizeEmail,
  sanitizeName,
  sanitizeUrl,
  sanitizeObject,
};


