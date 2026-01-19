/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @throws {Error} - If password doesn't meet requirements
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }
  
  // Minimum length: 12 characters (stronger requirement)
  if (password.length < 12) {
    throw new Error('Password must be at least 12 characters long');
  }
  
  // Maximum length: 128 characters (prevent DoS)
  if (password.length > 128) {
    throw new Error('Password must not exceed 128 characters');
  }
  
  // Require at least one uppercase letter
  if (!/[A-Z]/.test(password)) {
    throw new Error('Password must contain at least one uppercase letter');
  }
  
  // Require at least one lowercase letter
  if (!/[a-z]/.test(password)) {
    throw new Error('Password must contain at least one lowercase letter');
  }
  
  // Require at least one number
  if (!/[0-9]/.test(password)) {
    throw new Error('Password must contain at least one number');
  }
  
  // Require at least one special character
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new Error('Password must contain at least one special character');
  }
  
  // Check for common weak passwords
  const commonPasswords = [
    'password', 'password123', '12345678', 'qwerty', 'abc123',
    'letmein', 'welcome', 'admin', 'monkey', '1234567890',
  ];
  
  const passwordLower = password.toLowerCase();
  if (commonPasswords.some(common => passwordLower.includes(common))) {
    throw new Error('Password is too common or easily guessable');
  }
  
  // Check for repeated characters (e.g., "aaaaaa")
  if (/(.)\1{4,}/.test(password)) {
    throw new Error('Password contains too many repeated characters');
  }
  
  return true;
}

export default { validatePassword };
