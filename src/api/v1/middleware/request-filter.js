/**
 * Request filter middleware factory.
 *
 * - Redirects HTTP → HTTPS
 * - Normalizes the bare /api/ entrypoint
 *
 * @param {object} logger - app logger instance
 * @returns {{ loadRequestFilter: function }}
 */
const config = require('../../../../config');

const INVALID_REDIRECT_HOST_MESSAGE = 'Bad request. Invalid redirect host.';

const parseRedirectHost = (headerValue) => {
  if (typeof headerValue !== 'string') {
    return null;
  }

  const candidate = headerValue.trim();
  if (
    !candidate
    || candidate.includes(',')
    || /[\s/?#@\\]/.test(candidate)
  ) {
    return null;
  }

  try {
    const parsedHost = new URL(`http://${candidate}`);
    if (!parsedHost.hostname) {
      return null;
    }

    return {
      hostname: parsedHost.hostname,
      port: parsedHost.port,
    };
  } catch {
    return null;
  }
};

const resolveRedirectHost = (req) => {
  const forwardedHost = req.headers['x-forwarded-host'];
  if (forwardedHost !== undefined) {
    return parseRedirectHost(forwardedHost);
  }

  return parseRedirectHost(req.headers.host);
};

const buildHttpsRedirectUrl = (req) => {
  const redirectHost = resolveRedirectHost(req);
  if (!redirectHost) {
    return null;
  }

  const location = new URL(
    req.originalUrl || req.url || '/',
    `https://${redirectHost.hostname}/`,
  );

  const httpPort = String(config.http?.port ?? 8080);
  const httpsPort = String(config.https?.port ?? 8443);

  // If the incoming Host explicitly targets the HTTP listener, rewrite to the HTTPS listener.
  if (redirectHost.port && redirectHost.port === httpPort) {
    location.port = httpsPort === '443' ? '' : httpsPort;
  } else if (!req.headers['x-forwarded-proto'] && !redirectHost.port && httpsPort !== '443') {
    // Direct HTTP requests on default ports omit :80; ensure we redirect to the actual HTTPS port.
    location.port = httpsPort;
  } else if (redirectHost.port) {
    location.port = redirectHost.port;
  }

  location.protocol = 'https:';
  return location.toString();
};

module.exports = (logger) => {
  /**
   * Registers the request filter on appRouter.
   * The logger comes from the outer factory closure.
   * @param {object} appRouter - Express application or router
   */
  function loadRequestFilter(appRouter) {
    logger.info('Loading request-filter...');

    appRouter.use((req, res, next) => {
      const requestLogger = req.log ?? logger;

      // Redirect proxy-forwarded HTTP to HTTPS (handled by prod server in production)
      if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        const redirectUrl = buildHttpsRedirectUrl(req);
        if (!redirectUrl) {
          requestLogger.warn({ req }, 'Rejecting proxy redirect with invalid host header');
          return res.status(400).send(INVALID_REDIRECT_HOST_MESSAGE);
        }

        requestLogger.debug({ req }, 'Redirecting proxy-forwarded HTTP to HTTPS');
        return res.redirect(redirectUrl);
      }

      // Redirect direct HTTP to HTTPS
      if (!req.headers['x-forwarded-proto'] && req.protocol !== 'https') {
        const redirectUrl = buildHttpsRedirectUrl(req);
        if (!redirectUrl) {
          requestLogger.warn({ req }, 'Rejecting direct redirect with invalid host header');
          return res.status(400).send(INVALID_REDIRECT_HOST_MESSAGE);
        }

        requestLogger.debug({ req }, 'Redirecting HTTP to HTTPS');
        return res.redirect(redirectUrl);
      }

      // Redirect bare /api/ to versioned /api/v1/
      if (req.url === '/api/') {
        requestLogger.debug({ req }, 'Redirecting /api/ to /api/v1/');
        return res.redirect('/api/v1/');
      }

      return next();
    });

    logger.info('Request-filter loaded');
  }

  setImmediate(() => {
    logger.debug('[MODULE] api/v1/middleware/request-filter loaded');
  });

  return { loadRequestFilter };
};
