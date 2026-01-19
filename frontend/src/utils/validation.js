/**
 * Validate URL format
 * @param {string} url - URL to validate
 * @returns {object} - { valid: boolean, error?: string }
 */
export function validateUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  if (url.length > 2048) {
    return { valid: false, error: 'URL exceeds maximum length of 2048 characters' };
  }

  try {
    const parsed = new URL(url);
    
    // Only allow HTTP and HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
    }

    // Basic hostname validation
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return { valid: false, error: 'Invalid hostname' };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {object} - { valid: boolean, error?: string }
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }

  return { valid: true };
}

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} - { valid: boolean, error?: string, strength?: string }
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long' };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Password exceeds maximum length of 128 characters' };
  }

  // Check strength
  let strength = 'weak';
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const strengthScore = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  
  if (strengthScore >= 3 && password.length >= 12) {
    strength = 'strong';
  } else if (strengthScore >= 2) {
    strength = 'medium';
  }

  return { valid: true, strength };
}

/**
 * Validate cron expression
 * @param {string} cron - Cron expression to validate
 * @returns {object} - { valid: boolean, error?: string }
 */
export function validateCron(cron) {
  if (!cron || typeof cron !== 'string') {
    return { valid: false, error: 'Cron expression is required' };
  }

  // Basic cron format: minute hour day month weekday
  const cronRegex = /^(\*|([0-9]|[1-5][0-9])|\*\/([0-9]|[1-5][0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|[12][0-9]|3[01])|\*\/([1-9]|[12][0-9]|3[01])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/;
  
  if (!cronRegex.test(cron.trim())) {
    return { valid: false, error: 'Invalid cron expression format' };
  }

  return { valid: true };
}

/**
 * Validate TTL (time-to-live) in seconds
 * @param {number|string} ttl - TTL value
 * @returns {object} - { valid: boolean, error?: string }
 */
export function validateTTL(ttl) {
  const num = typeof ttl === 'string' ? parseInt(ttl, 10) : ttl;
  
  if (isNaN(num)) {
    return { valid: false, error: 'TTL must be a number' };
  }

  if (num < 0) {
    return { valid: false, error: 'TTL cannot be negative' };
  }

  if (num > 31536000) { // 1 year
    return { valid: false, error: 'TTL cannot exceed 1 year (31536000 seconds)' };
  }

  return { valid: true };
}
