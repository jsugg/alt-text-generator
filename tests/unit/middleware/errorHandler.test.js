const {
  asyncHandler,
  errorHandler,
  notFoundHandler,
} = require('../../../src/api/v1/middleware/error-handler');
const { ApiError } = require('../../../src/errors/ApiError');

describe('Unit | Middleware | Error Handler', () => {
  it('wraps async handlers and forwards rejected promises', async () => {
    const error = new Error('boom');
    const handler = asyncHandler(async () => {
      throw error;
    });
    const next = jest.fn();

    await handler({}, {}, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it('converts the 404 fallback into a not-found ApiError', () => {
    const next = jest.fn();

    notFoundHandler({}, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 404,
      code: 'ENDPOINT_NOT_FOUND',
      message: 'Endpoint not found',
    });
  });

  it('serializes ApiError instances with request metadata', () => {
    const req = { id: 'request-123' };
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();
    const error = ApiError.badRequest({
      message: 'Invalid image_source URL',
      code: 'INVALID_IMAGE_SOURCE_URL',
      details: [{ field: 'image_source', issue: 'invalid_url' }],
    });

    errorHandler(error, req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Invalid image_source URL',
      code: 'INVALID_IMAGE_SOURCE_URL',
      requestId: 'request-123',
      details: [{ field: 'image_source', issue: 'invalid_url' }],
    });
  });

  it('normalizes unexpected errors into a generic internal response', () => {
    const req = { id: 'request-123' };
    const res = {
      headersSent: false,
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const next = jest.fn();

    errorHandler(new Error('unexpected'), req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
      requestId: 'request-123',
    });
  });
});
