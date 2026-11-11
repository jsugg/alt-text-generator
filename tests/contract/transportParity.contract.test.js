const http = require('node:http');
const { randomUUID } = require('node:crypto');

const config = require('../../config');
const { createApp } = require('../../src/createApp');
const { createContractClient } = require('../../scripts/contract/contract-client');

const SECURE_HOST = config.https.port === 443 ? 'localhost' : `localhost:${config.https.port}`;
// The app redirects plain HTTP to HTTPS unless a proxy reports HTTPS, so both
// transports present the same secure-proxy headers.
const SECURE_PROXY_HEADERS = { host: SECURE_HOST, 'x-forwarded-proto': 'https' };

const silentLogger = {
  info: () => {},
  debug: () => {},
  error: () => {},
  warn: () => {},
  fatal: () => {},
};

const requestLogger = (req, res, next) => {
  req.id = randomUUID();
  req.log = silentLogger;
  res.setHeader('X-Request-Id', req.id);
  next();
};

/**
 * @param {import('../../scripts/contract/contract-client').ContractResponse} response
 */
const comparable = (response) => ({
  status: response.status,
  contentType: response.headers['content-type'] ?? null,
  location: response.headers.location ?? null,
  hasRequestId: typeof response.headers['x-request-id'] === 'string',
  hasRateLimit: typeof response.headers['x-ratelimit-limit'] === 'string',
});

describe('Contract | Transport parity', () => {
  let server;
  let inProcess;
  let blackBox;

  beforeAll(async () => {
    const { app } = createApp({ appLogger: silentLogger, requestLogger });
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const resolveTestName = () => expect.getState().currentTestName;
    inProcess = createContractClient({
      app,
      env: { ...process.env, CONTRACT_BASE_URL: '' },
      defaultHeaders: SECURE_PROXY_HEADERS,
      resolveTestName,
    });
    blackBox = createContractClient({
      env: { ...process.env, CONTRACT_BASE_URL: `http://127.0.0.1:${server.address().port}` },
      defaultHeaders: SECURE_PROXY_HEADERS,
      resolveTestName,
    });
  });

  afterAll(async () => {
    await blackBox?.close();
    await inProcess?.close();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it('selects one transport per target', () => {
    expect(inProcess.transport).toBe('supertest');
    expect(blackBox.transport).toBe('undici');
  });

  it('returns identical plain-text responses', async () => {
    const [local, remote] = await Promise.all([
      inProcess.send({ path: '/api/ping' }),
      blackBox.send({ path: '/api/ping' }),
    ]);

    expect(comparable(remote)).toEqual(comparable(local));
    expect(local.status).toBe(200);
    expect(remote.text).toBe(local.text);
  });

  it('returns identical JSON error contracts with query strings', async () => {
    const request = { path: '/api/v1/scraper/images', query: { url: 'not-a-url' } };
    const [local, remote] = await Promise.all([inProcess.send(request), blackBox.send(request)]);
    const withoutRequestId = ({ requestId, ...body }) => body;

    expect(comparable(remote)).toEqual(comparable(local));
    expect(local.status).toBe(400);
    expect(withoutRequestId(remote.json())).toEqual(withoutRequestId(local.json()));
    expect(local.json()).toMatchObject({ code: 'INVALID_PAGE_URL' });
  });

  it('reports redirects without following them', async () => {
    const [local, remote] = await Promise.all([
      inProcess.send({ path: '/api/' }),
      blackBox.send({ path: '/api/' }),
    ]);

    expect(comparable(remote)).toEqual(comparable(local));
    expect(local.status).toBe(302);
    expect(local.headers.location).toMatch(/\/api\/v1\/$/u);
  });
});
