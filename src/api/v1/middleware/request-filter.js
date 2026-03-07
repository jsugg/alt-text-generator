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
        return res.redirect(`https://${req.headers.host}${req.url}`);
      }

      // Redirect direct HTTP to HTTPS
      if (!req.headers['x-forwarded-proto'] && req.protocol !== 'https') {
        requestLogger.debug({ req }, 'Redirecting HTTP to HTTPS');
        return res.redirect(`https://${req.headers.host}${req.url}`);
      }

      // Redirect bare /api/ to versioned /api/v1/
      if (req.url === '/api/') {
        requestLogger.debug({ req }, 'Redirecting /api/ to /api/v1/');
        return res.redirect(`https://${req.headers.host}${req.url}v1/`);
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
