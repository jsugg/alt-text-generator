const config = require('../../../config');
const createRequestFilter = require('../../../src/api/v1/middleware/request-filter');

const createLogger = () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
});

const buildMiddleware = () => {
  const logger = createLogger();
  const appRouter = { use: jest.fn() };

  const { loadRequestFilter } = createRequestFilter(logger);
  loadRequestFilter(appRouter);

  return {
    logger,
    middleware: appRouter.use.mock.calls[0][0],
  };
};

const invokeMiddleware = ({
  protocol = 'http',
  url = '/api/ping',
  originalUrl = url,
  headers = {},
} = {}) => {
  const { middleware, logger } = buildMiddleware();
  const requestLogger = createLogger();
  const req = {
    protocol,
    url,
    originalUrl,
    headers: {
      host: 'localhost:8080',
      ...headers,
    },
    log: requestLogger,
  };
  const res = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
    redirect: jest.fn(),
  };
  const next = jest.fn();

  middleware(req, res, next);

  return {
    logger,
    next,
    requestLogger,
    res,
  };
};

describe('Unit | Middleware | Request Filter', () => {
  it('redirects direct HTTP requests to HTTPS using the validated host header', () => {
    const { next, res } = invokeMiddleware();

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      `https://localhost:${config.https.port}/api/ping`,
    );
  });

  it('redirects forwarded HTTP requests using the validated forwarded host', () => {
    const { next, res } = invokeMiddleware({
      headers: {
        host: 'internal.render:10000',
        'x-forwarded-host': 'wcag.qcraft.dev',
        'x-forwarded-proto': 'http',
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('https://wcag.qcraft.dev/api/ping');
  });

  it('rejects malformed forwarded host headers instead of constructing a redirect target', () => {
    const { next, requestLogger, res } = invokeMiddleware({
      headers: {
        host: 'internal.render:10000',
        'x-forwarded-host': 'wcag.qcraft.dev, attacker.test',
        'x-forwarded-proto': 'http',
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(requestLogger.warn).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Bad request. Invalid redirect host.');
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('rejects malformed direct host headers instead of redirecting', () => {
    const { next, requestLogger, res } = invokeMiddleware({
      headers: {
        host: 'localhost:8080, attacker.test',
      },
    });

    expect(next).not.toHaveBeenCalled();
    expect(requestLogger.warn).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith('Bad request. Invalid redirect host.');
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('normalizes the bare /api/ route with a relative redirect', () => {
    const { next, res } = invokeMiddleware({
      protocol: 'https',
      url: '/api/',
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/api/v1/');
  });

  it('passes secure requests through so endpoint validation can handle query semantics', () => {
    const { next, res } = invokeMiddleware({
      protocol: 'https',
      url: '/api/accessibility/description?image_source=not-a-url&model=clip',
    });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
