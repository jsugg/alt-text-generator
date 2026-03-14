let swaggerModuleLoaded = false;

jest.mock('swagger-ui-express', () => {
  swaggerModuleLoaded = true;
  const setup = jest.fn(() => (req, res) => {
    res.status(200).json({ ok: true });
  });

  return {
    serve: (req, res, next) => next(),
    setup,
  };
});

jest.mock('../../../config/swagger', () => ({
  openapi: '3.0.0',
}));

const express = require('express');
const request = require('supertest');
const { createRouter } = require('../../../src/utils/createRouter');

const logger = {
  debug: jest.fn(),
};

describe('Unit | Utils | Create Router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    swaggerModuleLoaded = false;
  });

  it('loads the swagger spec lazily and caches the UI middleware', async () => {
    const apiRouter = express.Router();
    apiRouter.get('/ping', (req, res) => res.status(200).send('pong'));

    const app = express();
    app.use(createRouter(logger, apiRouter));

    const pingResponse = await request(app).get('/ping');
    expect(pingResponse.status).toBe(200);
    expect(swaggerModuleLoaded).toBe(false);

    const docsResponse = await request(app).get('/api-docs');
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.body).toEqual({ ok: true });
    expect(swaggerModuleLoaded).toBe(true);
    // eslint-disable-next-line global-require
    const swaggerUi = require('swagger-ui-express');
    expect(swaggerUi.setup).toHaveBeenCalledTimes(1);

    const cachedDocsResponse = await request(app).get('/api-docs');
    expect(cachedDocsResponse.status).toBe(200);
    expect(swaggerUi.setup).toHaveBeenCalledTimes(1);
  });

  it('serves public provider-validation fixtures before the API router', async () => {
    const apiRouter = express.Router();
    apiRouter.get('/ping', (req, res) => res.status(200).send('pong'));

    const app = express();
    app.use(createRouter(logger, apiRouter));

    const pageResponse = await request(app)
      .get('/provider-validation/page')
      .set('Host', 'wcag.qcraft.com.br');

    expect(pageResponse.status).toBe(200);
    expect(pageResponse.headers['content-type']).toContain('text/html');
    expect(pageResponse.text).toContain('/provider-validation/assets/a.png');
    expect(pageResponse.text).toContain('http://wcag.qcraft.com.br/provider-validation/assets/b.png');

    const assetResponse = await request(app).get('/provider-validation/assets/a.png');
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers['content-type']).toContain('image/png');

    const missingAssetResponse = await request(app).get('/provider-validation/assets/missing.png');
    expect(missingAssetResponse.status).toBe(404);
  });
});
