/**
 * Loads the request filter middleware into the appRouter.
 *
 * @param {Object} serverLogger - An object that provides logging functionality.
 * @returns {Object} An object with the `loadRequestFilter` function.
 */
module.exports = (serverLogger) => {
  // Validate if the requested URI format is allowed
  function isAllowedURIFormat(url) {
    const allowedURIFormatRegex = /(?:http:\/\/)?(?:www\.)?(.*?)\/(.+?)(?:\/|\?|#|$|\n)/;
    const allowedURIFormat = new RegExp(
      allowedURIFormatRegex.toString().slice(1, -1),
    );
    return allowedURIFormat.exec(url);
  }

  /**
   * Loads the request filter middleware into the appRouter.
   *
   * @param {Object} logger - The logger object used for logging.
   * @param {Object} appRouter - The appRouter object that handles routing for the application.
   */
  function loadRequestFilter(logger, appRouter) {
    appRouter.use((req, res, next) => {
      req.log = logger;
      next();
    });

    serverLogger.logger.info('Loading request-filter...');

    appRouter.use((req, res, next) => {
      req.log.startTime = Date.now();
      req.log.logger.info('HTTP(S) Request received');
      req.log(req, res);

      // Validate the requested URI format
      if (
        !isAllowedURIFormat(
          `${req.protocol}://${req.headers.host}${req.originalUrl}`,
        )
      ) {
        serverLogger.logger.debug(
          { req, message: 'Denying resource - Disallowed URI format' },
          '403 FORBIDEN Status response sent',
        );
        res.status(400).send('Bad request. URI format not allowed.');
      } else if (
      // -- In prod, it's handled by prod server
      // Redirect from HTTP to HTTPS requests coming from a proxy server
        req.headers['x-forwarded-proto']
        && req.headers['x-forwarded-proto'] !== 'https'
      ) {
        serverLogger.logger.debug(
          { req, message: 'Redirecting from HTTP to HTTPS' },
          'Redirecting Proxy-forwarded request',
        );
        res.redirect(`https://${req.headers.host}${req.url}`);
      } else if (!req.headers['x-forwarded-proto'] && req.protocol !== 'https') {
        // Redirect from HTTP to HTTPS any other request
        serverLogger.logger.debug(
          { req, message: 'Redirecting from HTTP to HTTPS' },
          'Redirecting request',
        );
        res.redirect(`https://${req.headers.host}${req.url}`);
      } else if (`${req.url}` === '/api/') {
        serverLogger.logger.debug(
          { req, message: 'Redirecting /api to api/v1' },
          'Redirecting request',
        );
        res.redirect(`https://${req.headers.host}${req.url}v1/`);
      } else {
        // Else
        next();
      }
    });

    serverLogger.logger.info('Request-filter loaded');
  }

  setImmediate(() => {
    serverLogger.logger.debug(
      '[MODULE] api/v1/middleware/request-filter loaded',
    );
  });

  return {
    loadRequestFilter,
  };
};
