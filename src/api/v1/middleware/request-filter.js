/**
 * Request filter middleware factory.
 *
 * - Validates URI format
 * - Redirects HTTP → HTTPS
 * - Attaches the logger to req.log (single injection point)
 *
 * @param {object} logger - app logger instance
 * @returns {{ loadRequestFilter: function }}
 */
const config = require('../../../../config');

const buildHttpsRedirectUrl = (req, pathOverride) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const hostHeader = forwardedHost || req.headers.host;

  const base = new URL('https://localhost/');
  if (hostHeader) {
    try {
      const parsedHost = new URL(`http://${hostHeader}`);
      base.hostname = parsedHost.hostname;
      if (parsedHost.port) {
        base.port = parsedHost.port;
      }
    } catch {
      // Keep localhost fallback.
    }
  }

  const location = new URL(pathOverride || req.originalUrl || req.url || '/', base);

  const httpPort = String(config.http?.port ?? 8080);
  const httpsPort = String(config.https?.port ?? 8443);

  // If the incoming Host explicitly targets the HTTP listener, rewrite to the HTTPS listener.
  if (location.port && location.port === httpPort) {
    location.port = httpsPort === '443' ? '' : httpsPort;
  } else if (!forwardedProto && !location.port && httpsPort !== '443') {
    // Direct HTTP requests on default ports omit :80; ensure we redirect to the actual HTTPS port.
    location.port = httpsPort;
  }

  location.protocol = 'https:';
  return location.toString();
};

module.exports = (logger) => {
  /**
   * Returns a match if the URL matches the expected path format, null otherwise.
   * @param {string} url
   * @returns {RegExpExecArray|null}
   */
  function isAllowedURIFormat(url) {
    const pattern = /(?:http:\/\/)?(?:www\.)?(.*?)\/(.+?)(?:\/|\?|#|$|\n)/;
    return pattern.exec(url);
  }

  /**
   * Registers the request filter on appRouter.
   * The logger comes from the outer factory closure.
   * @param {object} appRouter - Express application or router
   */
  function loadRequestFilter(appRouter) {
    logger.info('Loading request-filter...');

    appRouter.use((req, res, next) => {
      const fullUrl = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
      const requestLogger = req.log ?? logger;

      if (!isAllowedURIFormat(fullUrl)) {
        requestLogger.debug(
          { req, message: 'Denying resource - Disallowed URI format' },
          '400 Bad Request - Disallowed URI format',
        );
        return res.status(400).send('Bad request. URI format not allowed.');
      }

      // Redirect proxy-forwarded HTTP to HTTPS (handled by prod server in production)
      if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        requestLogger.debug({ req }, 'Redirecting proxy-forwarded HTTP to HTTPS');
        return res.redirect(buildHttpsRedirectUrl(req));
      }

      // Redirect direct HTTP to HTTPS
      if (!req.headers['x-forwarded-proto'] && req.protocol !== 'https') {
        requestLogger.debug({ req }, 'Redirecting HTTP to HTTPS');
        return res.redirect(buildHttpsRedirectUrl(req));
      }

      // Redirect bare /api/ to versioned /api/v1/
      if (req.url === '/api/') {
        requestLogger.debug({ req }, 'Redirecting /api/ to /api/v1/');
        return res.redirect(buildHttpsRedirectUrl(req, '/api/v1/'));
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
