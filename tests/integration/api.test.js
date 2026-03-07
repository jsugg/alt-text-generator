const request = require('supertest');

const { createApp } = require('../../src/createApp');
const ImageDescriberFactory = require('../../src/services/ImageDescriberFactory');

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

const secureGet = (app, path) => request(app)
  .get(path)
  .set('X-Forwarded-Proto', 'https');

const buildTestApp = ({
  scraperService = {},
  imageDescriberFactory = new ImageDescriberFactory(),
} = {}) => {
  const appLogger = createAppLogger();
  const requestLogger = createRequestLogger();
  const { app } = createApp({
    appLogger,
    requestLogger,
    scraperService,
    imageDescriberFactory,
  });

  return { app, appLogger, requestLogger };
};

describe('request filter', () => {
  it('redirects direct HTTP traffic to HTTPS', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/api/ping');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\//);
  });

  it('redirects proxy-forwarded HTTP traffic to HTTPS', async () => {
    const { app } = buildTestApp();

    const res = await request(app)
      .get('/api/ping')
      .set('X-Forwarded-Proto', 'http');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\//);
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

describe('GET /api/scrapper/images', () => {
  it('returns 400 when url is missing', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(app, '/api/scrapper/images');

    expect(res.status).toBe(400);
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
      `/api/scrapper/images?url=${encodeURIComponent('https://example.com')}`,
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
      `/api/scrapper/images?url=${encodeURIComponent('https://example.com')}`,
    );

    expect(res.status).toBe(500);
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
});

describe('GET /api/accessibility/descriptions', () => {
  it('returns 400 when url is missing', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(
      app,
      '/api/accessibility/descriptions?model=clip',
    );

    expect(res.status).toBe(400);
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
});

describe('unknown routes', () => {
  it('returns 404 for unregistered paths', async () => {
    const { app } = buildTestApp();

    const res = await secureGet(app, '/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint not found');
  });
});
