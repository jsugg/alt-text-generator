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

describe('Unit | Application Composition', () => {
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
      azure: {
        apiEndpoint: 'https://azure.example.com/vision/v3.2/describe',
        subscriptionKey: 'azure-key',
        language: 'en',
        maxCandidates: 4,
      },
      scraper: {
        requestTimeoutMs: 1500,
        maxRedirects: 4,
        maxContentLengthBytes: 2048,
      },
      proxy: {
        trustProxyHops: 2,
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
    expect(app.get('trust proxy')).toBe(2);
    expect(services.scraperService.httpClient).toBe(httpClient);
    expect(services.scraperService.requestOptions).toEqual({
      timeout: 1500,
      maxRedirects: 4,
      maxContentLength: 2048,
    });
    expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['replicate', 'azure']);
    expect(services.imageDescriberFactory.get('replicate').replicate).toBe(replicateClient);
    expect(services.imageDescriberFactory.get('azure').httpClient).toBe(httpClient);
    expect(services.pageDescriptionService.scraperService).toBe(services.scraperService);
    expect(services.pageDescriptionService.imageDescriberFactory)
      .toBe(services.imageDescriberFactory);
    expect(services.pageDescriptionJobService.pageDescriptionService)
      .toBe(services.pageDescriptionService);
    expect(services.pageDescriptionJobService.descriptionJobService)
      .toBe(services.descriptionJobService);
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
      expect(app.get('trust proxy')).toBe(1);
      expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['replicate']);
      expect(services.imageDescriberFactory.get('replicate').replicate).toBeDefined();
    } finally {
      defaultAppLogger.level = originalLevel;
    }
  });

  it('registers only azure when Replicate is not configured', () => {
    const config = {
      replicate: {},
      azure: {
        apiEndpoint: 'https://azure.example.com/vision/v3.2/describe',
        subscriptionKey: 'azure-key',
        language: 'en',
        maxCandidates: 4,
      },
      scraper: {
        requestTimeoutMs: 1500,
        maxRedirects: 4,
        maxContentLengthBytes: 2048,
      },
    };
    const httpClient = {
      get: jest.fn(),
      post: jest.fn(),
    };

    const { services } = createApp({
      appLogger: createAppLogger(),
      requestLogger: createRequestLogger(),
      httpClient,
      config,
    });

    expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['azure']);
    expect(services.imageDescriberFactory.get('azure').httpClient).toBe(httpClient);
  });

  it('falls back to the default trust proxy setting when config omits proxy', () => {
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

    const { app } = createApp({
      appLogger: createAppLogger(),
      requestLogger: createRequestLogger(),
      httpClient: { get: jest.fn() },
      replicateClient: { run: jest.fn() },
      config,
    });

    expect(app.get('trust proxy')).toBe(1);
  });

  it('does not register azure when its config is incomplete', () => {
    const config = {
      replicate: {
        apiToken: 'test-token',
        apiEndpoint: 'https://replicate.example.com',
        userAgent: 'alt-text-generator/test',
        modelOwner: 'owner',
        modelName: 'model',
        modelVersion: 'version',
      },
      azure: {
        apiEndpoint: 'https://azure.example.com/vision/v3.2/describe',
      },
      scraper: {
        requestTimeoutMs: 1500,
        maxRedirects: 4,
        maxContentLengthBytes: 2048,
      },
    };

    const { services } = createApp({
      appLogger: createAppLogger(),
      requestLogger: createRequestLogger(),
      httpClient: { get: jest.fn(), post: jest.fn() },
      replicateClient: { run: jest.fn() },
      config,
    });

    expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['replicate']);
  });

  it('does not register azure when provider overrides disable it', () => {
    const config = {
      providerOverrides: {
        azure: { enabled: false },
      },
      replicate: {
        apiToken: 'test-token',
        apiEndpoint: 'https://replicate.example.com',
        userAgent: 'alt-text-generator/test',
        modelOwner: 'owner',
        modelName: 'model',
        modelVersion: 'version',
      },
      azure: {
        enabled: true,
        apiEndpoint: 'https://azure.example.com/vision/v3.2/describe',
        subscriptionKey: 'azure-key',
        language: 'en',
        maxCandidates: 4,
      },
      scraper: {
        requestTimeoutMs: 1500,
        maxRedirects: 4,
        maxContentLengthBytes: 2048,
      },
    };

    const { services } = createApp({
      appLogger: createAppLogger(),
      requestLogger: createRequestLogger(),
      httpClient: { get: jest.fn(), post: jest.fn() },
      replicateClient: { run: jest.fn() },
      config,
    });

    expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['replicate']);
  });

  it('does not register replicate when the Replicate token is missing', () => {
    const config = {
      replicate: {
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

    const { services } = createApp({
      appLogger: createAppLogger(),
      requestLogger: createRequestLogger(),
      httpClient: { get: jest.fn(), post: jest.fn() },
      config,
    });

    expect(services.imageDescriberFactory.getAvailableModels()).toEqual([]);
  });

  it('does not register replicate when Replicate is explicitly disabled', () => {
    const config = {
      replicate: {
        enabled: false,
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

    const { services } = createApp({
      appLogger: createAppLogger(),
      requestLogger: createRequestLogger(),
      httpClient: { get: jest.fn(), post: jest.fn() },
      config,
    });

    expect(services.imageDescriberFactory.getAvailableModels()).toEqual([]);
  });
});
