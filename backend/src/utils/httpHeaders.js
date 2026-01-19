/**
 * Utility functions for HTTP request headers and response detection
 */

/**
 * Default browser-like User-Agent string to help bypass bot detection
 * Using a common Chrome user agent to make requests appear more legitimate
 */
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Add browser-like headers to request headers
 * This helps bypass basic bot detection mechanisms
 * @param {object} headers - Existing headers object
 * @returns {object} - Headers with browser-like defaults added
 */
export function addBrowserHeaders(headers = {}) {
  const browserHeaders = {
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  };
  
  // Merge with existing headers, but don't override if already set
  return {
    ...browserHeaders,
    ...headers,
  };
}

/**
 * Check if response is HTML (often indicates a challenge page)
 * @param {string} contentType - Content-Type header value
 * @param {string|object} data - Response data
 * @returns {boolean} - True if response is HTML
 */
export function isHtmlResponse(contentType, data) {
  if (contentType && contentType.includes('text/html')) {
    return true;
  }
  
  if (data && typeof data === 'string') {
    // Check for HTML tags
    return /<html|<head|<body|<!DOCTYPE html/i.test(data);
  }
  
  return false;
}

/**
 * Detect challenge pages from various bot detection providers
 * @param {string|object} data - Response data (can be string or object)
 * @param {string} contentType - Content-Type header value
 * @param {number} statusCode - HTTP status code
 * @returns {object} - { isChallenge: boolean, provider: string, message: string }
 */
export function detectChallengePage(data, contentType, statusCode = 200) {
  if (!data) return { isChallenge: false, provider: null, message: null };
  
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  
  // Check for HTML when expecting API response
  const isHtml = isHtmlResponse(contentType, dataStr);
  
  // If not HTML and status is not 200, likely not a challenge
  if (!isHtml && statusCode !== 200) {
    return { isChallenge: false, provider: null, message: null };
  }
  
  // Cloudflare
  if (/cf-challenge|_cf_chl_opt|challenge-platform|DDoS protection by Cloudflare|Just a moment/i.test(dataStr)) {
    return { 
      isChallenge: true, 
      provider: 'Cloudflare',
      message: 'Cloudflare challenge detected'
    };
  }
  
  // AWS WAF
  if (/aws-waf|aws.*waf|Request blocked.*AWS|Access Denied.*AWS/i.test(dataStr)) {
    return { 
      isChallenge: true, 
      provider: 'AWS WAF',
      message: 'AWS WAF challenge detected'
    };
  }
  
  // Akamai Bot Manager
  if (/akamai.*bot|bot.*manager.*akamai|You are being redirected.*Akamai|Access Denied.*Akamai/i.test(dataStr)) {
    return { 
      isChallenge: true, 
      provider: 'Akamai',
      message: 'Akamai Bot Manager challenge detected'
    };
  }
  
  // Imperva/Incapsula
  if (/incapsula|imperva|Request unsuccessful.*Incapsula/i.test(dataStr)) {
    return { 
      isChallenge: true, 
      provider: 'Imperva/Incapsula',
      message: 'Imperva/Incapsula challenge detected'
    };
  }
  
  // Sucuri
  if (/sucuri|Access Denied.*Sucuri|Checking your browser.*Sucuri/i.test(dataStr)) {
    return { 
      isChallenge: true, 
      provider: 'Sucuri',
      message: 'Sucuri challenge detected'
    };
  }
  
  // Generic bot detection patterns
  if (/bot.*detection|access.*denied.*bot|blocked.*request.*bot|verify.*browser|challenge.*page/i.test(dataStr)) {
    return { 
      isChallenge: true, 
      provider: 'Generic',
      message: 'Bot detection challenge detected'
    };
  }
  
  // If HTML but no specific pattern, still flag as potential challenge (especially if status 200)
  if (isHtml && statusCode === 200) {
    const titleMatch = dataStr.match(/<title[^>]*>([^<]+)<\/title>/i);
    return { 
      isChallenge: true, 
      provider: 'Unknown',
      message: titleMatch ? `HTML challenge page: ${titleMatch[1]}` : 'HTML challenge page detected'
    };
  }
  
  return { isChallenge: false, provider: null, message: null };
}

/**
 * Extract error message from challenge page
 * @param {object} challenge - Challenge detection result from detectChallengePage()
 * @param {string|object} data - Response data
 * @param {boolean} bypassEnabled - Whether bypass_bot_detection is enabled
 * @returns {string} - Error message
 */
export function extractChallengeError(challenge, data, bypassEnabled = false) {
  if (!challenge.isChallenge) {
    return 'Unexpected response format';
  }
  
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  const titleMatch = dataStr.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1] : null;
  
  let message = `${challenge.message}. The target API is protected and requires browser verification.`;
  
  if (bypassEnabled) {
    message += ' Browser headers were attempted but challenge persists.';
  } else {
    message += ' Enable bypass_bot_detection to attempt automatic retry with browser headers.';
  }
  
  if (title && challenge.provider === 'Unknown') {
    message = `Received HTML response instead of API data: ${title}. ${message}`;
  }
  
  return message;
}

