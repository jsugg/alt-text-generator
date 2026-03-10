class ApiError extends Error {
  /**
   * @param {object} params
   * @param {number} params.statusCode
   * @param {string} params.code
   * @param {string} params.message
   * @param {Array<object>} [params.details]
   * @param {object} [params.cause]
   */
  constructor({
    statusCode,
    code,
    message,
    details,
    cause,
  }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;

    if (details !== undefined) {
      this.details = details;
    }
  }

  /**
   * @param {object} params
   * @param {string} params.message
   * @param {string} params.code
   * @param {Array<object>} [params.details]
   * @returns {ApiError}
   */
  static badRequest({ message, code, details }) {
    return new ApiError({
      statusCode: 400,
      code,
      message,
      details,
    });
  }

  /**
   * @param {object} params
   * @param {string} params.message
   * @param {string} params.code
   * @returns {ApiError}
   */
  static unauthorized({ message, code }) {
    return new ApiError({
      statusCode: 401,
      code,
      message,
    });
  }

  /**
   * @param {object} params
   * @param {string} params.message
   * @param {string} params.code
   * @returns {ApiError}
   */
  static notFound({ message, code }) {
    return new ApiError({
      statusCode: 404,
      code,
      message,
    });
  }

  /**
   * @param {object} params
   * @param {string} params.message
   * @param {string} params.code
   * @returns {ApiError}
   */
  static tooManyRequests({ message, code }) {
    return new ApiError({
      statusCode: 429,
      code,
      message,
    });
  }

  /**
   * @param {object} params
   * @param {string} params.message
   * @param {string} params.code
   * @param {object} [params.cause]
   * @returns {ApiError}
   */
  static internal({ message, code, cause }) {
    return new ApiError({
      statusCode: 500,
      code,
      message,
      cause,
    });
  }

  /**
   * @param {Error|ApiError} error
   * @returns {ApiError}
   */
  static from(error) {
    if (error instanceof ApiError) {
      return error;
    }

    return ApiError.internal({
      message: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
      cause: error,
    });
  }
}

/**
 * @param {ApiError} error
 * @param {string|undefined} requestId
 * @returns {object}
 */
const buildErrorResponse = (error, requestId) => ({
  error: error.message,
  code: error.code,
  ...(requestId ? { requestId } : {}),
  ...(error.details ? { details: error.details } : {}),
});

module.exports = {
  ApiError,
  buildErrorResponse,
};
