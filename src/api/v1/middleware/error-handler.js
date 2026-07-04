const { ApiError, buildErrorResponse } = require('../../../errors/ApiError');

/**
 * @typedef {object} ErrorRequest
 * @property {string} [id]
 */

/**
 * @typedef {object} ErrorResponse
 * @property {boolean} headersSent
 * @property {(code: number) => ErrorResponse} status
 * @property {(body: unknown) => ErrorResponse} json
 */

/**
 * Wraps an async route handler so rejected promises reach Express error handling.
 *
 * @param {Function} handler
 * @returns {(req: unknown, res: unknown, next: (err?: unknown) => void) => Promise<void>}
 */
const asyncHandler = (handler) => (req, res, next) => Promise
  .resolve(handler(req, res, next))
  .catch(next);

/**
 * @param {object} req
 * @param {object} res
 * @param {Function} next
 * @returns {void}
 */
const notFoundHandler = (req, res, next) => {
  next(ApiError.notFound({
    message: 'Endpoint not found',
    code: 'ENDPOINT_NOT_FOUND',
  }));
};

/**
 * @param {Error} error
 * @param {ErrorRequest} req
 * @param {ErrorResponse} res
 * @param {Function} next
 * @returns {object|void}
 */
const errorHandler = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const apiError = ApiError.from(error);

  return res
    .status(apiError.statusCode)
    .json(buildErrorResponse(apiError, req.id));
};

module.exports = {
  asyncHandler,
  errorHandler,
  notFoundHandler,
};
