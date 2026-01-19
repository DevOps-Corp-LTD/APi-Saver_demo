import { URL } from 'url';

/**
 * Check if a hostname is a private/internal IP address
 * @param {string} hostname - Hostname or IP address
 * @returns {boolean} - True if private/internal IP
 */
export function isPrivateIP(hostname) {
  if (!hostname) return false;
  
  // Normalize hostname (remove brackets from IPv6)
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  
  // Check for localhost variations
  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }
  
  // Check for IPv4 private ranges
  const ipv4Patterns = [
    /^127\./,                    // 127.0.0.0/8 - Loopback
    /^10\./,                     // 10.0.0.0/8 - Private
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12 - Private
    /^192\.168\./,               // 192.168.0.0/16 - Private
    /^169\.254\./,               // 169.254.0.0/16 - Link-local
    /^0\./,                      // 0.0.0.0/8 - Invalid
  ];
  
  if (ipv4Patterns.some(pattern => pattern.test(normalized))) {
    return true;
  }
  
  // Check for IPv6 private ranges
  const ipv6Patterns = [
    /^::1$/,                     // IPv6 loopback
    /^fc00:/,                    // fc00::/7 - Unique local address
    /^fe80:/,                    // fe80::/10 - Link-local
    /^::ffff:0:0/,                // IPv4-mapped IPv6
  ];
  
  if (ipv6Patterns.some(pattern => pattern.test(normalized))) {
    return true;
  }
  
  // Check for IPv4-mapped IPv6 addresses (::ffff:192.168.x.x)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.substring(7);
    if (ipv4Patterns.some(pattern => pattern.test(ipv4Part))) {
      return true;
    }
  }
  
  return false;
}

/**
 * Validate and sanitize a URL to prevent SSRF attacks
 * @param {string} urlString - URL string to validate
 * @param {string} baseUrl - Optional base URL for relative URLs
 * @returns {string} - Validated and normalized URL
 * @throws {Error} - If URL is invalid or blocked
 */
export function validateUrl(urlString, baseUrl = null) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('URL is required and must be a string');
  }
  
  // Limit URL length to prevent DoS
  if (urlString.length > 2048) {
    throw new Error('URL exceeds maximum length of 2048 characters');
  }
  
  let parsed;
  try {
    // Parse URL (baseUrl is used for relative URLs)
    parsed = baseUrl ? new URL(urlString, baseUrl) : new URL(urlString);
  } catch (err) {
    throw new Error('Invalid URL format');
  }
  
  // Only allow HTTP and HTTPS protocols
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }
  
  // Block private/internal IP addresses
  if (isPrivateIP(parsed.hostname)) {
    throw new Error('Private/internal IP addresses are not allowed');
  }
  
  // Block common dangerous ports
  const dangerousPorts = [22, 23, 25, 53, 80, 135, 139, 445, 1433, 1521, 3306, 3389, 5432, 6379, 27017];
  if (parsed.port && dangerousPorts.includes(parseInt(parsed.port, 10))) {
    // Allow port 80 and 443 for HTTP/HTTPS
    if (parsed.port !== '80' && parsed.port !== '443') {
      throw new Error('Access to this port is not allowed');
    }
  }
  
  // Return normalized URL
  return parsed.href;
}

/**
 * Validate URL for data routes (stricter validation)
 * @param {string} urlString - URL string to validate
 * @returns {string} - Validated URL
 * @throws {Error} - If URL is invalid or blocked
 */
export function validateDataUrl(urlString) {
  return validateUrl(urlString);
}

export default {
  isPrivateIP,
  validateUrl,
  validateDataUrl,
};
