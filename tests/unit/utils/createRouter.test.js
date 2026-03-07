jest.mock('swagger-ui-express', () => {
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
const swaggerUi = require('swagger-ui-express');
const { createRouter } = require('../../../src/utils/createRouter');

const logger = {
  debug: jest.fn(),
};

describe('createRouter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads the swagger spec lazily and caches the UI middleware', async () => {
    const apiRouter = express.Router();
    apiRouter.get('/ping', (req, res) => res.status(200).send('pong'));

    const app = express();
    app.use(createRouter(logger, apiRouter));

    const pingResponse = await request(app).get('/ping');
    expect(pingResponse.status).toBe(200);
    expect(swaggerUi.setup).not.toHaveBeenCalled();

    const docsResponse = await request(app).get('/api-docs');
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.body).toEqual({ ok: true });
    expect(swaggerUi.setup).toHaveBeenCalledTimes(1);

    const cachedDocsResponse = await request(app).get('/api-docs');
    expect(cachedDocsResponse.status).toBe(200);
    expect(swaggerUi.setup).toHaveBeenCalledTimes(1);
  });
});
