/**
 * Integration tests for the API routes.
 *
 * The Express app is built with mocked services so no real HTTP calls are made.
 */
const express = require('express');
const request = require('supertest');

const buildApiRouter = require('../../src/api/v1/routes/api');
const healthController = require('../../src/api/v1/controllers/healthController');
const ScraperController = require('../../src/api/v1/controllers/scraperController');
const DescriptionController = require('../../src/api/v1/controllers/descriptionController');
const ImageDescriberFactory = require('../../src/services/ImageDescriberFactory');

const mockLogger = {
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
};

const buildTestApp = ({ scraperService, imageDescriberFactory }) => {
  const scraperController = new ScraperController({
    scraperService,
    logger: mockLogger.logger,
  });
  const descriptionController = new DescriptionController({
    imageDescriberFactory,
    logger: mockLogger.logger,
  });

  const apiRouter = buildApiRouter(
    { health: healthController, scraper: scraperController, description: descriptionController },
    mockLogger,
  );

  const app = express();
  app.use(apiRouter);
  return app;
};

describe('GET /api/ping', () => {
  it('responds with pong', async () => {
    const app = buildTestApp({
      scraperService: {},
      imageDescriberFactory: new ImageDescriberFactory(),
    });
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.text).toBe('pong');
  });
});

describe('GET /api/health', () => {
  it('responds with health info', async () => {
    const app = buildTestApp({
      scraperService: {},
      imageDescriberFactory: new ImageDescriberFactory(),
    });
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message', 'OK');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('GET /api/scrapper/images', () => {
  it('returns 400 when url is missing', async () => {
    const app = buildTestApp({
      scraperService: {},
      imageDescriberFactory: new ImageDescriberFactory(),
    });
    const res = await request(app).get('/api/scrapper/images');
    expect(res.status).toBe(400);
  });

  it('returns image list on success', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({ imageSources: ['https://example.com/a.jpg'] }),
    };
    const app = buildTestApp({
      scraperService,
      imageDescriberFactory: new ImageDescriberFactory(),
    });
    const res = await request(app).get(
      `/api/scrapper/images?url=${encodeURIComponent('https://example.com')}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.imageSources).toContain('https://example.com/a.jpg');
  });

  it('returns 500 on scraper failure', async () => {
    const scraperService = {
      getImages: jest.fn().mockRejectedValue(new Error('network error')),
    };
    const app = buildTestApp({
      scraperService,
      imageDescriberFactory: new ImageDescriberFactory(),
    });
    const res = await request(app).get(
      `/api/scrapper/images?url=${encodeURIComponent('https://example.com')}`,
    );
    expect(res.status).toBe(500);
  });
});

describe('GET /api/accessibility/description', () => {
  it('returns 400 when image_source is missing', async () => {
    const app = buildTestApp({
      scraperService: {},
      imageDescriberFactory: new ImageDescriberFactory(),
    });
    const res = await request(app).get('/api/accessibility/description?model=clip');
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown model', async () => {
    const factory = new ImageDescriberFactory().register('clip', { describeImage: jest.fn() });
    const app = buildTestApp({
      scraperService: {},
      imageDescriberFactory: factory,
    });
    const res = await request(app).get(
      `/api/accessibility/description?image_source=${encodeURIComponent('https://example.com/img.jpg')}&model=unknownmodel`,
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
    const app = buildTestApp({
      scraperService: {},
      imageDescriberFactory: factory,
    });
    const res = await request(app).get(
      `/api/accessibility/description?image_source=${encodeURIComponent('https://example.com/img.jpg')}&model=clip`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{
      description: 'a cat on a mat',
      imageUrl: 'https://example.com/img.jpg',
    }]);
  });
});

describe('unknown routes', () => {
  it('returns 404 for unregistered paths', async () => {
    const app = buildTestApp({
      scraperService: {},
      imageDescriberFactory: new ImageDescriberFactory(),
    });
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint not found');
  });
});
