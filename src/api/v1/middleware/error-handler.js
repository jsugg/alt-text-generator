const { ApiError, buildErrorResponse } = require('../../../errors/ApiError');

/**
 * Wraps an async route handler so rejected promises reach Express error handling.
 *
 * @param {Function} handler
 * @returns {Function}
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
 * @param {object} req
 * @param {object} res
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
