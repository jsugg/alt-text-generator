const request = require('supertest');

const packageMetadata = require('../../package.json');
const { createApp } = require('../../src/createApp');
const ImageDescriberFactory = require('../../src/services/ImageDescriberFactory');
const config = require('../../config');

const TEST_REQUEST_ID = 'test-request-id';

const createAppLogger = () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  fatal: jest.fn(),
});

const createRequestLogger = () => {
  const requestLogger = jest.fn((req, res, next) => {
    req.id = TEST_REQUEST_ID;
    req.log = requestLogger.logger;
    res.setHeader('X-Request-Id', TEST_REQUEST_ID);
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

const secureGet = (app, path) => request(app)
  .get(path)
  .set('X-Forwarded-Proto', 'https');

const buildTestApp = ({
  scraperService = {},
  imageDescriberFactory = new ImageDescriberFactory(),
  config: appConfig,
} = {}) => {
  const appLogger = createAppLogger();
  const requestLogger = createRequestLogger();
  const { app } = createApp({
    appLogger,
    requestLogger,
    scraperService,
    imageDescriberFactory,
    config: appConfig,
  });

  return { app, appLogger, requestLogger };
};

describe('request filter', () => {
  it('redirects direct HTTP traffic to HTTPS', async () => {
    const { app } = buildTestApp();

    const res = await request(app)
      .get('/api/ping')
      .set('Host', 'localhost:8080');

    expect(res.status).toBe(302);
    const expectedHost = config.https.port === 443
      ? 'localhost'
      : `localhost:${config.https.port}`;
    expect(res.headers.location).toBe(`https://${expectedHost}/api/ping`);
  });

  it('redirects proxy-forwarded HTTP traffic to HTTPS', async () => {
    const { app } = buildTestApp();

    const res = await request(app)
      .get('/api/ping')
      .set('Host', 'localhost:8080')
      .set('X-Forwarded-Proto', 'http');

    expect(res.status).toBe(302);
    const expectedHost = config.https.port === 443
      ? 'localhost'
      : `localhost:${config.https.port}`;
    expect(res.headers.location).toBe(`https://${expectedHost}/api/ping`);
  });

  it('redirects /api/ to the versioned route for secure requests', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(app, '/api/');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/api\/v1\/$/);
  });
});

describe('GET /api/ping', () => {
  it('responds with pong and mounts the request logger middleware', async () => {
    const { app, requestLogger } = buildTestApp();

    const res = await secureGet(app, '/api/ping');

    expect(res.status).toBe(200);
    expect(res.text).toBe('pong');
    expect(requestLogger).toHaveBeenCalled();
  });
});

describe('GET /', () => {
  it('responds with a stable public service index', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(app, '/');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['x-request-id']).toBe(TEST_REQUEST_ID);
    expect(Object.keys(res.body).sort()).toEqual([
      'auth',
      'links',
      'name',
      'requestId',
      'status',
      'version',
    ]);
    expect(res.body).toEqual({
      name: packageMetadata.name,
      version: packageMetadata.version,
      status: 'ok',
      links: {
        api: '/api/v1',
        docs: '/api-docs/',
        health: '/api/health',
        ping: '/api/ping',
      },
      auth: {
        schemes: ['X-API-Key', 'Bearer'],
      },
      requestId: TEST_REQUEST_ID,
    });
  });
});

describe('GET /api/health', () => {
  it('responds with health info', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(app, '/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'OK');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('rate limiting', () => {
  const rateLimitedConfig = {
    rateLimit: {
      windowMs: 60 * 1000,
      max: 1,
    },
  };

  it('does not rate limit repeated health checks', async () => {
    const { app } = buildTestApp({ config: rateLimitedConfig });

    const first = await secureGet(app, '/api/health');
    const second = await secureGet(app, '/api/health');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toHaveProperty('message', 'OK');
  });

  it('continues to rate limit normal API traffic', async () => {
    const { app } = buildTestApp({ config: rateLimitedConfig });

    const first = await secureGet(app, '/api/v1/does-not-exist');
    const second = await secureGet(app, '/api/v1/does-not-exist');

    expect(first.status).toBe(404);
    expect(second.status).toBe(429);
    expect(second.text).toContain('Too many requests');
  });
});

describe('GET /api/scraper/images', () => {
  it('returns 400 when url is missing', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(app, '/api/scraper/images');

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Missing required query parameter: url',
      code: 'QUERY_VALIDATION_ERROR',
      requestId: TEST_REQUEST_ID,
      details: [{ field: 'url', issue: 'required' }],
    });
  });

  it('returns image list on success', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: ['https://example.com/a.jpg'],
      }),
    };
    const { app } = buildTestApp({ scraperService });

    const res = await secureGet(
      app,
      `/api/scraper/images?url=${encodeURIComponent('https://example.com')}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.imageSources).toContain('https://example.com/a.jpg');
  });

  it('returns 500 on scraper failure', async () => {
    const scraperService = {
      getImages: jest.fn().mockRejectedValue(new Error('network error')),
    };
    const { app } = buildTestApp({ scraperService });

    const res = await secureGet(
      app,
      `/api/scraper/images?url=${encodeURIComponent('https://example.com')}`,
    );

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      error: 'Error fetching images from the provided URL',
      code: 'SCRAPE_FETCH_FAILED',
      requestId: TEST_REQUEST_ID,
    });
  });
});

describe('GET /api/accessibility/description', () => {
  it('returns 400 when image_source is missing', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(
      app,
      '/api/accessibility/description?model=clip',
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Missing required query parameters: image_source and model',
      code: 'QUERY_VALIDATION_ERROR',
      requestId: TEST_REQUEST_ID,
      details: [{ field: 'image_source', issue: 'required' }],
    });
  });

  it('returns 400 for an unknown model', async () => {
    const factory = new ImageDescriberFactory().register('clip', {
      describeImage: jest.fn(),
    });
    const { app } = buildTestApp({ imageDescriberFactory: factory });

    const res = await secureGet(
      app,
      `/api/accessibility/description?image_source=${
        encodeURIComponent('https://example.com/img.jpg')
      }&model=unknownmodel`,
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown model/);
    expect(res.body.code).toBe('UNKNOWN_MODEL');
    expect(res.body.requestId).toBe(TEST_REQUEST_ID);
  });

  it('returns description array on success', async () => {
    const mockDescriber = {
      describeImage: jest.fn().mockResolvedValue({
        description: 'a cat on a mat',
        imageUrl: 'https://example.com/img.jpg',
      }),
    };
    const factory = new ImageDescriberFactory().register('clip', mockDescriber);
    const { app } = buildTestApp({ imageDescriberFactory: factory });

    const res = await secureGet(
      app,
      `/api/accessibility/description?image_source=${
        encodeURIComponent('https://example.com/img.jpg')
      }&model=clip`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      description: 'a cat on a mat',
      imageUrl: 'https://example.com/img.jpg',
    }]);
  });

  it('serves Azure descriptions through the default runtime composition when configured', async () => {
    const appLogger = createAppLogger();
    const requestLogger = createRequestLogger();
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('azure-image-bytes'),
        headers: {
          'content-type': 'image/jpeg',
        },
      }),
      post: jest.fn().mockResolvedValue({
        data: {
          description: {
            captions: [
              { text: 'an azure-generated caption' },
            ],
          },
        },
      }),
    };
    const replicateClient = { run: jest.fn() };
    const runtimeConfig = {
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
        trustProxyHops: 1,
      },
    };
    const { app, services } = createApp({
      appLogger,
      requestLogger,
      httpClient,
      replicateClient,
      config: runtimeConfig,
    });

    expect(services.imageDescriberFactory.getAvailableModels()).toEqual(['clip', 'azure']);

    const res = await secureGet(
      app,
      `/api/accessibility/description?image_source=${
        encodeURIComponent('https://example.com/azure-image.jpg')
      }&model=azure`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      description: 'an azure-generated caption',
      imageUrl: 'https://example.com/azure-image.jpg',
    }]);
    expect(httpClient.get).toHaveBeenCalledWith('https://example.com/azure-image.jpg', {
      timeout: 1500,
      maxRedirects: 4,
      maxContentLength: 2048,
      maxBodyLength: 2048,
      responseType: 'arraybuffer',
    });
    expect(httpClient.post).toHaveBeenCalledWith(
      'https://azure.example.com/vision/v3.2/describe?maxCandidates=4&language=en&model-version=latest&overload=stream',
      Buffer.from('azure-image-bytes'),
      {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Ocp-Apim-Subscription-Key': 'azure-key',
        },
      },
    );
  });
});

describe('GET /api/accessibility/descriptions', () => {
  it('returns 400 when url is missing', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(
      app,
      '/api/accessibility/descriptions?model=clip',
    );

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: 'Missing required query parameters: url and model',
      code: 'QUERY_VALIDATION_ERROR',
      requestId: TEST_REQUEST_ID,
      details: [{ field: 'url', issue: 'required' }],
    });
  });

  it('preserves duplicate entries while reusing one prediction per unique URL', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/a.jpg',
          'https://example.com/b.jpg',
          'https://example.com/a.jpg',
        ],
      }),
    };
    const mockDescriber = {
      describeImage: jest
        .fn()
        .mockImplementation(async (imageUrl) => ({
          description: `description for ${imageUrl}`,
          imageUrl,
        })),
    };
    const factory = new ImageDescriberFactory().register('clip', mockDescriber);
    const { app } = buildTestApp({
      scraperService,
      imageDescriberFactory: factory,
    });

    const res = await secureGet(
      app,
      `/api/accessibility/descriptions?url=${
        encodeURIComponent('https://example.com/page')
      }&model=clip`,
    );

    expect(res.status).toBe(200);
    expect(mockDescriber.describeImage).toHaveBeenCalledTimes(2);
    expect(res.body).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'clip',
      totalImages: 3,
      uniqueImages: 2,
      descriptions: [
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
        {
          description: 'description for https://example.com/b.jpg',
          imageUrl: 'https://example.com/b.jpg',
        },
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    });
  });

  it('returns partial page descriptions when image-specific Azure failures are skippable', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/a.jpg',
          'https://example.com/missing.jpg',
          'https://example.com/a.jpg',
        ],
      }),
    };
    const imageError = new Error('image timeout');
    const mockDescriber = {
      describeImage: jest.fn().mockImplementation(async (imageUrl) => {
        if (imageUrl === 'https://example.com/missing.jpg') {
          throw imageError;
        }

        return {
          description: `description for ${imageUrl}`,
          imageUrl,
        };
      }),
      shouldSkipDescriptionError: jest.fn((error) => error === imageError),
    };
    const factory = new ImageDescriberFactory().register('azure', mockDescriber);
    const { app } = buildTestApp({
      scraperService,
      imageDescriberFactory: factory,
    });

    const res = await secureGet(
      app,
      `/api/accessibility/descriptions?url=${
        encodeURIComponent('https://example.com/page')
      }&model=azure`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'azure',
      totalImages: 2,
      uniqueImages: 1,
      descriptions: [
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    });
  });
});

describe('unknown routes', () => {
  it('returns 404 for unregistered paths', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(app, '/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint not found');
    expect(res.body.code).toBe('ENDPOINT_NOT_FOUND');
    expect(res.body.requestId).toBe(TEST_REQUEST_ID);
  });
});

describe('API access control', () => {
  const buildAuthConfig = () => ({
    auth: {
      enabled: true,
      tokens: ['dummy-1', 'dummy-2'],
    },
    replicate: {},
    azure: {},
    scraper: {
      requestTimeoutMs: 1500,
      maxRedirects: 4,
      maxContentLengthBytes: 2048,
    },
  });

  it('allows public health endpoints without authentication', async () => {
    const { app } = buildTestApp({ config: buildAuthConfig() });

    const res = await secureGet(app, '/api/health');

    expect(res.status).toBe(200);
  });

  it('keeps the root service index public without authentication', async () => {
    const { app } = buildTestApp({ config: buildAuthConfig() });

    const res = await secureGet(app, '/');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: packageMetadata.name,
      status: 'ok',
      requestId: TEST_REQUEST_ID,
    });
  });

  it('rejects protected endpoints without authentication', async () => {
    const { app } = buildTestApp({ config: buildAuthConfig() });

    const res = await secureGet(
      app,
      `/api/accessibility/description?image_source=${
        encodeURIComponent('https://example.com/img.jpg')
      }&model=clip`,
    );

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'Missing or invalid API authentication credentials',
      code: 'API_AUTHENTICATION_FAILED',
      requestId: TEST_REQUEST_ID,
    });
  });

  it('accepts X-API-Key authentication on protected endpoints', async () => {
    const factory = new ImageDescriberFactory().register('clip', {
      describeImage: jest.fn().mockResolvedValue({
        description: 'authenticated description',
        imageUrl: 'https://example.com/img.jpg',
      }),
    });
    const { app } = buildTestApp({
      config: buildAuthConfig(),
      imageDescriberFactory: factory,
    });

    const res = await secureGet(
      app,
      `/api/accessibility/description?image_source=${
        encodeURIComponent('https://example.com/img.jpg')
      }&model=clip`,
    ).set('X-API-Key', 'dummy-2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      description: 'authenticated description',
      imageUrl: 'https://example.com/img.jpg',
    }]);
  });

  it('accepts Bearer authentication on protected endpoints', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: ['https://example.com/a.jpg'],
      }),
    };
    const { app } = buildTestApp({
      config: buildAuthConfig(),
      scraperService,
    });

    const res = await secureGet(
      app,
      `/api/scraper/images?url=${encodeURIComponent('https://example.com')}`,
    ).set('Authorization', 'Bearer dummy-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      imageSources: ['https://example.com/a.jpg'],
    });
  });

  it('rejects protected endpoints when the token is not in API_AUTH_TOKENS', async () => {
    const { app } = buildTestApp({ config: buildAuthConfig() });

    const res = await secureGet(
      app,
      `/api/scraper/images?url=${encodeURIComponent('https://example.com')}`,
    ).set('Authorization', 'Bearer invalid-token');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      error: 'Missing or invalid API authentication credentials',
      code: 'API_AUTHENTICATION_FAILED',
      requestId: TEST_REQUEST_ID,
    });
  });

  it('allows protected endpoints through when auth is explicitly disabled', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: ['https://example.com/a.jpg'],
      }),
    };
    const { app } = buildTestApp({
      config: {
        ...buildAuthConfig(),
        auth: {
          enabled: false,
          tokens: ['dummy-1', 'dummy-2'],
        },
      },
      scraperService,
    });

    const res = await secureGet(
      app,
      `/api/scraper/images?url=${encodeURIComponent('https://example.com')}`,
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      imageSources: ['https://example.com/a.jpg'],
    });
  });
});
