/**
 * Standardized error handling utilities
 */

/**
 * Create a standardized error response
 * @param {Error|string} error - Error object or message
 * @param {object} options - Additional options
 * @returns {object} - Standardized error object
 */
export function createErrorResponse(error, options = {}) {
  const {
    statusCode = 500,
    code = null,
    details = null,
    requestId = null,
  } = options;

  const isDevelopment = process.env.NODE_ENV === 'development';
  
  let message = 'An unexpected error occurred';
  let errorCode = code;
  
  if (error instanceof Error) {
    message = error.message || message;
    errorCode = errorCode || error.code || error.name;
  } else if (typeof error === 'string') {
    message = error;
  }

  const response = {
    error: errorCode || 'InternalError',
    message,
    ...(isDevelopment && requestId && { requestId }),
    ...(isDevelopment && details && { details }),
  };

  return { statusCode, response };
}

/**
 * Handle database errors
 * @param {Error} error - Database error
 * @returns {object} - Error response
 */
export function handleDatabaseError(error) {
  // PostgreSQL error codes
  const pgErrors = {
    '23505': { // Unique violation
      statusCode: 409,
      message: 'A resource with this value already exists',
    },
    '23503': { // Foreign key violation
      statusCode: 400,
      message: 'Referenced resource does not exist',
    },
    '23502': { // Not null violation
      statusCode: 400,
      message: 'Required field is missing',
    },
    '42P01': { // Undefined table
      statusCode: 500,
      message: 'Database table not found',
    },
  };

  const pgError = pgErrors[error.code];
  if (pgError) {
    return createErrorResponse(new Error(pgError.message), {
      statusCode: pgError.statusCode,
      code: error.code,
    });
  }

  return createErrorResponse(error, {
    statusCode: 500,
    code: 'DatabaseError',
  });
}

/**
 * Handle validation errors
 * @param {Error|string} error - Validation error
 * @returns {object} - Error response
 */
export function handleValidationError(error) {
  return createErrorResponse(error, {
    statusCode: 400,
    code: 'ValidationError',
  });
}

/**
 * Handle authentication errors
 * @param {string} message - Error message
 * @returns {object} - Error response
 */
export function handleAuthError(message = 'Authentication required') {
  return createErrorResponse(new Error(message), {
    statusCode: 401,
    code: 'Unauthorized',
  });
}

/**
 * Handle authorization errors
 * @param {string} message - Error message
 * @returns {object} - Error response
 */
export function handleAuthorizationError(message = 'Insufficient permissions') {
  return createErrorResponse(new Error(message), {
    statusCode: 403,
    code: 'Forbidden',
  });
}

/**
 * Handle not found errors
 * @param {string} resource - Resource name
 * @returns {object} - Error response
 */
export function handleNotFoundError(resource = 'Resource') {
  return createErrorResponse(new Error(`${resource} not found`), {
    statusCode: 404,
    code: 'NotFound',
  });
}

export default {
  createErrorResponse,
  handleDatabaseError,
  handleValidationError,
  handleAuthError,
  handleAuthorizationError,
  handleNotFoundError,
};
