module.exports = (serverLogger) => {

  // Allowed URI formats and file types
  const allowedURIFormatRegex = /(?:http:\/\/)?(?:www\.)?(.*?)\/(.+?)(?:\/|\?|\#|$|\n)/;

  // Validate if the requested URI format is allowed
  function isAllowedURIFormat(url, allowedURIFormatRegex) {
    const allowedURIFormat = new RegExp(allowedURIFormatRegex.toString().slice(1, -1));
    return allowedURIFormat.exec(url);
  }

  // HTTP(S) request filter
  function loadRequestFilter(serverLogger, httpServerLogger, appRouter) {
    serverLogger.info('Loading request-filter...');

    appRouter.use((req, res, next) => {
      httpServerLogger.startTime = Date.now();
      httpServerLogger.logger.info('HTTP(S) Request received');
      httpServerLogger(req, res);

      // Validate the requested URI format
      if (!isAllowedURIFormat(`${req.protocol}://${req.headers.host}${req.originalUrl}`, allowedURIFormatRegex)) { 
        serverLogger.debug({ req, 'message': 'Denying resource - Disallowed URI format' }, '403 FORBIDEN Status response sent');
        res.status(400).send('Bad request. URI format not allowed.'); 
      }
      // Redirect from HTTP to HTTPS requests coming from a proxy server
      else if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https') {
        serverLogger.debug({ req, 'message': 'Redirecting from HTTP to HTTPS' }, 'Redirecting Proxy-forwarded request');
        res.redirect(`https://${req.headers.host}${req.url}`);
      }
      // Redirect from HTTP to HTTPS any other request
      else if (!req.headers['x-forwarded-proto'] && req.protocol !== 'https') {
        serverLogger.debug({ req, 'message': 'Redirecting from HTTP to HTTPS' }, 'Redirecting request');
        res.redirect(`https://${req.headers.host}${req.url}`);
      }
      else if (`${req.url}` == '/api/') {
        serverLogger.debug({ req, 'message': 'Redirecting /api to api/v1' }, 'Redirecting request');
        res.redirect(`https://${req.headers.host}${req.url}v1/`);
      }
      // Else
      else { 
        next();
      } 
    });

    serverLogger.info('Request-filter loaded');
  }

  setImmediate(() => { serverLogger.debug('[MODULE] api/v1/middleware/request-filter loaded') });

  return {
    loadRequestFilter
  }
};