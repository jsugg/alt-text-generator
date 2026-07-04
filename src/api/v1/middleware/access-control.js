const { ApiError } = require('../../../errors/ApiError');

/**
 * @typedef {object} AccessRequest
 * @property {string} path
 * @property {(name: string) => string | undefined} get
 */

const PUBLIC_PATHS = new Set([
  '/api',
  '/api/',
  '/api/v1',
  '/api/ping',
  '/api/v1/ping',
  '/api/health',
  '/api/v1/health',
]);

const isApiPath = (path = '') => path === '/api' || path.startsWith('/api/');

/**
 * @param {unknown} authorizationHeader
 * @returns {string | null}
 */
const extractBearerToken = (authorizationHeader) => {
  if (typeof authorizationHeader !== 'string') {
    return null;
  }

  const [scheme, token, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (!scheme || !token || rest.length > 0 || !/^Bearer$/i.test(scheme)) {
    return null;
  }

  return token;
};

/**
 * @param {AccessRequest} req
 * @returns {string | null}
 */
const extractApiAuthToken = (req) => {
  const apiKey = req.get('x-api-key');
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return apiKey.trim();
  }

  return extractBearerToken(req.get('authorization'));
};

const isPublicPath = (path = '') => path.startsWith('/api-docs')
  || PUBLIC_PATHS.has(path);

/**
 * @param {object} authConfig
 * @param {boolean} [authConfig.enabled]
 * @param {string[]} [authConfig.tokens]
 * @returns {(req: AccessRequest, res: object, next: (err?: unknown) => void) => unknown}
 */
const createAccessControlMiddleware = (authConfig = {}) => {
  const allowedTokens = new Set(authConfig.tokens ?? []);
  const authEnabled = typeof authConfig.enabled === 'boolean'
    ? authConfig.enabled
    : allowedTokens.size > 0;

  if (authEnabled && allowedTokens.size === 0) {
    throw new Error('API auth is enabled but no API_AUTH_TOKENS were configured');
  }

  return (req, res, next) => {
    if (!authEnabled || !isApiPath(req.path) || isPublicPath(req.path)) {
      return next();
    }

    const token = extractApiAuthToken(req);
    if (token && allowedTokens.has(token)) {
      return next();
    }

    return next(ApiError.unauthorized({
      message: 'Missing or invalid API authentication credentials',
      code: 'API_AUTHENTICATION_FAILED',
    }));
  };
};

module.exports = {
  createAccessControlMiddleware,
  extractApiAuthToken,
  isApiPath,
  isPublicPath,
};
