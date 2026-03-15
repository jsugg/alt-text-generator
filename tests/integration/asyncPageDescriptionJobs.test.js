const http = require('node:http');

const request = require('supertest');

const config = require('../../config');
const { createApp } = require('../../src/createApp');
const {
  createMemoryDescriptionJobStore,
} = require('../../src/infrastructure/descriptionJobStore');
const { createRuntimeState } = require('../../src/server/runtimeState');
const ImageDescriberFactory = require('../../src/services/ImageDescriberFactory');
const { createFixtureApp } = require('../../scripts/postman-fixture-server');

const TEST_REQUEST_ID = 'test-request-id';
const SECURE_TEST_HOST = config.https.port === 443
  ? 'localhost'
  : `localhost:${config.https.port}`;

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
  .set('Host', SECURE_TEST_HOST)
  .set('X-Forwarded-Proto', 'https');

const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => {
    server.off('error', reject);
    resolve();
  });
});

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => {
    if (error) {
      reject(error);
      return;
    }

    resolve();
  });
});

const reservePort = () => new Promise((resolve, reject) => {
  const server = http.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(port);
    });
  });
});

class StubAsyncClipDescriber {
  constructor() {
    this.jobs = new Map();
    this.nextJobId = 1;
  }

  static buildCaption(imageUrl) {
    if (imageUrl.endsWith('/assets/a.png')) {
      return 'stub caption for asset a';
    }

    if (imageUrl.endsWith('/assets/b.png')) {
      return 'stub caption for asset b';
    }

    return 'stub caption for unknown asset';
  }

  static buildFailureError(imageUrl) {
    const error = new Error(`stub clip provider failure for ${imageUrl}`);
    error.code = 'STUB_CLIP_PROVIDER_FAILURE';
    return error;
  }

  async createDescriptionJob(imageUrl) {
    const jobId = `stub-job-${String(this.nextJobId).padStart(4, '0')}`;
    const job = {
      id: jobId,
      imageUrl,
      pollCount: 0,
      status: 'starting',
      terminalPollCount: imageUrl.endsWith('/assets/provider-error.png') ? 2 : 3,
    };

    this.nextJobId += 1;
    this.jobs.set(jobId, job);

    return {
      providerJobId: job.id,
      imageUrl,
      status: job.status,
    };
  }

  async getDescriptionJob(providerJobId, imageUrl) {
    const job = this.jobs.get(providerJobId);

    if (!job) {
      return {
        providerJobId,
        imageUrl,
        status: 'failed',
        error: this.constructor.buildFailureError(imageUrl),
      };
    }

    job.pollCount += 1;

    if (job.pollCount < job.terminalPollCount) {
      job.status = 'processing';
      return {
        providerJobId,
        imageUrl,
        status: job.status,
      };
    }

    if (imageUrl.endsWith('/assets/provider-error.png')) {
      job.status = 'failed';
      return {
        providerJobId,
        imageUrl,
        status: job.status,
        error: this.constructor.buildFailureError(imageUrl),
      };
    }

    job.status = 'succeeded';
    return {
      providerJobId,
      imageUrl,
      status: job.status,
      result: {
        description: this.constructor.buildCaption(imageUrl),
        imageUrl,
      },
    };
  }
}

describe('Integration | Async Page Description Jobs', () => {
  let fixtureBaseUrl;
  let fixtureServer;

  beforeAll(async () => {
    const fixturePort = await reservePort();
    fixtureBaseUrl = `http://127.0.0.1:${fixturePort}`;
    fixtureServer = http.createServer(createFixtureApp({ baseUrl: fixtureBaseUrl }));
    await listen(fixtureServer, fixturePort);
  });

  afterAll(async () => {
    await closeServer(fixtureServer);
  });

  const buildTestApp = () => {
    const imageDescriberFactory = new ImageDescriberFactory();
    imageDescriberFactory.register('clip', new StubAsyncClipDescriber());

    const appLogger = createAppLogger();
    const requestLogger = createRequestLogger();
    const runtimeState = createRuntimeState({ initialReady: true });
    const descriptionJobStore = createMemoryDescriptionJobStore();
    const { app } = createApp({
      appLogger,
      requestLogger,
      imageDescriberFactory,
      descriptionJobStore,
      runtimeState,
      config: {
        ...config,
        auth: {
          enabled: false,
          tokens: [],
        },
        pageDescription: {
          ...config.pageDescription,
          concurrency: 1,
        },
        descriptionJobs: {
          ...config.descriptionJobs,
          waitTimeoutMs: 5,
          pollIntervalMs: 1,
        },
        scraper: {
          ...config.scraper,
          requestTimeoutMs: 1000,
        },
      },
    });

    return app;
  };

  const pollJobUntilTerminal = async (app, statusUrl) => {
    let latestResponse = null;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      // The background page job keeps progressing between polls.
      // eslint-disable-next-line no-await-in-loop
      latestResponse = await secureGet(app, statusUrl);
      if (latestResponse.status === 200) {
        return latestResponse;
      }

      expect(latestResponse.status).toBe(202);
    }

    throw new Error(`Timed out waiting for terminal job status at ${statusUrl}`);
  };

  it('returns 202, settles the page job, and serves cached results on repeat clip requests', async () => {
    const app = buildTestApp();
    const pageUrl = `${fixtureBaseUrl}/fixtures/page-with-images`;
    const startResponse = await secureGet(
      app,
      `/api/v1/accessibility/descriptions?url=${encodeURIComponent(pageUrl)}&model=clip`,
    );

    expect(startResponse.status).toBe(202);
    expect(startResponse.body).toMatchObject({
      model: 'clip',
      pageUrl,
      status: expect.stringMatching(/^(pending|processing)$/),
      statusUrl: expect.stringMatching(/^\/api\/v1\/accessibility\/page-description-jobs\//),
    });

    const finalResponse = await pollJobUntilTerminal(app, startResponse.body.statusUrl);

    expect(finalResponse.body).toMatchObject({
      model: 'clip',
      pageUrl,
      status: 'succeeded',
      result: {
        pageUrl,
        model: 'clip',
        totalImages: 3,
        uniqueImages: 2,
      },
    });
    expect(finalResponse.body.result.descriptions).toEqual([
      { description: 'stub caption for asset a', imageUrl: `${fixtureBaseUrl}/assets/a.png` },
      { description: 'stub caption for asset b', imageUrl: `${fixtureBaseUrl}/assets/b.png` },
      { description: 'stub caption for asset a', imageUrl: `${fixtureBaseUrl}/assets/a.png` },
    ]);

    const cachedResponse = await secureGet(
      app,
      `/api/v1/accessibility/descriptions?url=${encodeURIComponent(pageUrl)}&model=clip`,
    );

    expect(cachedResponse.status).toBe(200);
    expect(cachedResponse.body).toEqual(finalResponse.body.result);
  });

  it('returns 202 and eventually exposes a terminal failed page job when a clip image job fails', async () => {
    const app = buildTestApp();
    const pageUrl = `${fixtureBaseUrl}/fixtures/page-with-provider-failure`;
    const startResponse = await secureGet(
      app,
      `/api/v1/accessibility/descriptions?url=${encodeURIComponent(pageUrl)}&model=clip`,
    );

    expect(startResponse.status).toBe(202);
    expect(startResponse.body.statusUrl).toMatch(/^\/api\/v1\/accessibility\/page-description-jobs\//);

    const finalResponse = await pollJobUntilTerminal(app, startResponse.body.statusUrl);

    expect(finalResponse.body).toMatchObject({
      model: 'clip',
      pageUrl,
      status: 'failed',
      error: {
        code: 'STUB_CLIP_PROVIDER_FAILURE',
        message: `stub clip provider failure for ${fixtureBaseUrl}/assets/provider-error.png`,
      },
    });
    expect(finalResponse.body).not.toHaveProperty('result');
  });
});
