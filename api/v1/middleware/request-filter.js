"use strict"
module.exports = (serverLogger) => {

  // Allowed URI formats and file types
  const allowedURIFormatRegex = /(?:http:\/\/)?(?:www\.)?(.*?)\/(.+?)(?:\/|\?|\#|$|\n)/;

  // Validate if the requested URI format is allowed
  function isAllowedURIFormat(url, allowedURIFormatRegex) {
    const allowedURIFormat = new RegExp(allowedURIFormatRegex.toString().slice(1, -1));
    return allowedURIFormat.exec(url);
  }

  // HTTP(S) request filter
  function loadRequestFilter(serverLogger, appRouter) {

    appRouter.use((req, res, next) => {
      req.log = serverLogger;
      next();
    });

    serverLogger.logger.info('Loading request-filter...');

    appRouter.use((req, res, next) => {
      req.log.startTime = Date.now();
      req.log.logger.info('HTTP(S) Request received');
      req.log(req, res);

      // Validate the requested URI format
      if (!isAllowedURIFormat(`${req.protocol}://${req.headers.host}${req.originalUrl}`, allowedURIFormatRegex)) { 
        serverLogger.logger.debug({ req, 'message': 'Denying resource - Disallowed URI format' }, '403 FORBIDEN Status response sent');
        res.status(400).send('Bad request. URI format not allowed.'); 
      }
      //-- In prod, it's handled by prod server
      // Redirect from HTTP to HTTPS requests coming from a proxy server
      else if (process.env.NODE_ENV != 'production' && req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        serverLogger.logger.debug({ req, 'message': 'Redirecting from HTTP to HTTPS' }, 'Redirecting Proxy-forwarded request');
        res.redirect(`https://${req.headers.host}${req.url}`);
      }
      // Redirect from HTTP to HTTPS any other request
      else if (process.env.NODE_ENV != 'production' && !req.headers['x-forwarded-proto'] && req.protocol !== 'https') {
        serverLogger.logger.debug({ req, 'message': 'Redirecting from HTTP to HTTPS' }, 'Redirecting request');
        res.redirect(`https://${req.headers.host}${req.url}`);
      }
      else if (process.env.NODE_ENV != 'production' && (`${req.url}` == '/api/')) {
        serverLogger.logger.debug({ req, 'message': 'Redirecting /api to api/v1' }, 'Redirecting request');
        res.redirect(`https://${req.headers.host}${req.url}v1/`);
      }
      else if (process.env.NODE_ENV === 'production' && (`${req.url}` == '/api/')) {
        serverLogger.logger.debug({ req, 'message': 'Redirecting /api to api/v1' }, 'Redirecting request');
        res.redirect(`http://${req.headers.host}${req.url}v1/`);
      }
      // Else
      else { 
        next();
      } 
    });

    serverLogger.logger.info('Request-filter loaded');
  }

  setImmediate(() => { serverLogger.logger.debug('[MODULE] api/v1/middleware/request-filter loaded') });

  return {
    loadRequestFilter
  }
};