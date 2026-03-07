const { createApp } = require('../../src/createApp');
const { appLogger: defaultAppLogger } = require('../../src/infrastructure/logger');

const createAppLogger = () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  fatal: jest.fn(),
});

const createRequestLogger = () => {
  const requestLogger = jest.fn((req, res, next) => {
    req.log = requestLogger.logger;
    next();
  });

  requestLogger.logger = {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };

  return requestLogger;
};

describe('createApp', () => {
  it('builds the default services when overrides are not supplied', () => {
    const appLogger = createAppLogger();
    const requestLogger = createRequestLogger();
    const httpClient = { get: jest.fn() };
    const replicateClient = { run: jest.fn() };
    const config = {
      replicate: {
        apiToken: 'test-token',
        apiEndpoint: 'https://replicate.example.com',
        userAgent: 'alt-text-generator/test',
        modelOwner: 'owner',
        modelName: 'model',
        modelVersion: 'version',
      },
      scraper: {
        requestTimeoutMs: 1500,
        maxRedirects: 4,
        maxContentLengthBytes: 2048,
      },
    };

    const { app, services } = createApp({
      appLogger,
      requestLogger,
      httpClient,
      replicateClient,
      config,
    });

    expect(app).toBeDefined();
    expect(services.scraperService.httpClient).toBe(httpClient);
    expect(services.scraperService.requestOptions).toEqual({
      timeout: 1500,
      maxRedirects: 4,
      maxContentLength: 2048,
    });
    expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['clip']);
    expect(services.imageDescriberFactory.get('clip').replicate).toBe(replicateClient);
    expect(services.pageDescriptionService.scraperService).toBe(services.scraperService);
    expect(services.pageDescriptionService.imageDescriberFactory)
      .toBe(services.imageDescriberFactory);
  });

  it('falls back to the default loggers and replicate client', () => {
    const config = {
      replicate: {
        apiToken: 'test-token',
        apiEndpoint: 'https://replicate.example.com',
        userAgent: 'alt-text-generator/test',
        modelOwner: 'owner',
        modelName: 'model',
        modelVersion: 'version',
      },
      scraper: {
        requestTimeoutMs: 1500,
        maxRedirects: 4,
        maxContentLengthBytes: 2048,
      },
    };

    const originalLevel = defaultAppLogger.level;
    defaultAppLogger.level = 'silent';

    try {
      const { app, services } = createApp({ config });

      expect(app).toBeDefined();
      expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['clip']);
      expect(services.imageDescriberFactory.get('clip').replicate).toBeDefined();
    } finally {
      defaultAppLogger.level = originalLevel;
    }
  });
});
