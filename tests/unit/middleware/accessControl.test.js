const {
  createAccessControlMiddleware,
  extractApiAuthToken,
  isApiPath,
  isPublicPath,
} = require('../../../src/api/v1/middleware/access-control');
const { ApiError } = require('../../../src/errors/ApiError');

const makeRequest = ({
  path = '/api/accessibility/description',
  headers = {},
} = {}) => ({
  path,
  get: (name) => headers[name.toLowerCase()] ?? null,
});

describe('Unit | Middleware | Access Control', () => {
  it('treats docs and health endpoints as public', () => {
    expect(isApiPath('/')).toBe(false);
    expect(isApiPath('/api/v1/accessibility/description')).toBe(true);
    expect(isPublicPath('/api-docs')).toBe(true);
    expect(isPublicPath('/api-docs/swagger-ui-init.js')).toBe(true);
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/api/v1/ping')).toBe(true);
    expect(isPublicPath('/api/accessibility/description')).toBe(false);
  });

  it('extracts tokens from X-API-Key first', () => {
    const req = makeRequest({
      headers: {
        'x-api-key': 'token-a',
        authorization: 'Bearer token-b',
      },
    });

    expect(extractApiAuthToken(req)).toBe('token-a');
  });

  it('extracts tokens from Bearer authorization', () => {
    const req = makeRequest({
      headers: {
        authorization: 'Bearer token-a',
      },
    });

    expect(extractApiAuthToken(req)).toBe('token-a');
  });

  it('allows requests through when auth is not configured', () => {
    const middleware = createAccessControlMiddleware();
    const req = makeRequest();
    const next = jest.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('allows public requests through when auth is configured', () => {
    const middleware = createAccessControlMiddleware({ enabled: true, tokens: ['token-a'] });
    const req = makeRequest({ path: '/api/health' });
    const next = jest.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects protected requests without a valid token', () => {
    const middleware = createAccessControlMiddleware({ enabled: true, tokens: ['token-a'] });
    const req = makeRequest();
    const next = jest.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'API_AUTHENTICATION_FAILED',
      message: 'Missing or invalid API authentication credentials',
    });
  });

  it('allows protected requests with a matching token', () => {
    const middleware = createAccessControlMiddleware({
      enabled: true,
      tokens: ['dummy-1', 'dummy-2'],
    });
    const req = makeRequest({
      headers: {
        authorization: 'Bearer dummy-2',
      },
    });
    const next = jest.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('rejects protected requests with an invalid configured header token', () => {
    const middleware = createAccessControlMiddleware({
      enabled: true,
      tokens: ['dummy-1', 'dummy-2'],
    });
    const req = makeRequest({
      headers: {
        'x-api-key': 'bogus-token',
      },
    });
    const next = jest.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 401,
      code: 'API_AUTHENTICATION_FAILED',
    });
  });

  it('allows protected requests through when auth is explicitly disabled', () => {
    const middleware = createAccessControlMiddleware({
      enabled: false,
      tokens: ['dummy-1', 'dummy-2'],
    });
    const req = makeRequest();
    const next = jest.fn();

    middleware(req, {}, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('throws when auth is enabled without any configured tokens', () => {
    expect(() => createAccessControlMiddleware({
      enabled: true,
      tokens: [],
    })).toThrow('API auth is enabled but no API_AUTH_TOKENS were configured');
  });
});
