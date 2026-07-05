// QE-016 / ATG-QE-03A: warning-only performance smoke.
//
// Measures two latency-sensitive paths and compares them to PROVISIONAL route
// budgets:
//   1. page fan-out  - the async page-description flow over a multi-image page
//   2. docs steady-state - warmed /api-docs/ latency (cold first hit excluded)
//
// Budgets are provisional until explicitly accepted, so an over-budget result
// only warns and the smoke still exits 0. Accept a budget by listing its label
// in PERF_BUDGETS_ACCEPTED (comma-separated); an accepted breach then fails the
// run so it can become a real gate. This is intentionally NOT wired into the
// required CI gates yet.
//
// Usage: node scripts/perf/run-perf-smoke.js   (npm run perf:smoke)

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
const {
  summarizePerformanceReport,
  formatSampleLine,
} = require('./performanceBudget');

const PAGE_FAN_OUT_LABEL = 'page-fan-out';
const DOCS_STEADY_STATE_LABEL = 'docs-steady-state';
const PAGE_FAN_OUT_ITERATIONS = 5;
const DOCS_WARMUP_ITERATIONS = 3;
const DOCS_MEASURE_ITERATIONS = 10;

/**
 * @param {unknown} value
 * @param {number} fallback
 */
const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** @param {string | undefined} envValue */
const resolveAcceptedBudgets = (envValue) => new Set(
  (typeof envValue === 'string' ? envValue : '')
    .split(',')
    .map((label) => label.trim())
    .filter(Boolean),
);

/** @param {string} line */
const writeLine = (line) => process.stdout.write(`${line}\n`);

/**
 * @param {import('node:http').Server} server
 * @param {number} port
 * @returns {Promise<void>}
 */
const listen = (server, port) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', () => {
    server.off('error', reject);
    resolve();
  });
});

/**
 * @param {import('node:http').Server} server
 * @returns {Promise<void>}
 */
const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => (error ? reject(error) : resolve()));
});

/** @returns {Promise<number>} */
const reservePort = () => new Promise((resolve, reject) => {
  const server = http.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    server.close((error) => (error ? reject(error) : resolve(port)));
  });
});

/** @param {number[]} values */
const median = (values) => {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

// Stub async describer: settles immediately so the smoke measures orchestration
// and scrape overhead rather than real provider latency.
class FastStubDescriber {
  /** @param {string} imageUrl */
  static buildResult(imageUrl) {
    return { description: 'perf-smoke caption', imageUrl };
  }

  /** @param {string} imageUrl */
  async createDescriptionJob(imageUrl) {
    return {
      providerJobId: 'perf-stub',
      imageUrl,
      status: 'succeeded',
      result: /** @type {typeof FastStubDescriber} */ (this.constructor).buildResult(imageUrl),
    };
  }

  /**
   * @param {string} providerJobId
   * @param {string} imageUrl
   */
  async getDescriptionJob(providerJobId, imageUrl) {
    return {
      providerJobId,
      imageUrl,
      status: 'succeeded',
      result: /** @type {typeof FastStubDescriber} */ (this.constructor).buildResult(imageUrl),
    };
  }
}

const buildPerfApp = () => {
  const imageDescriberFactory = new ImageDescriberFactory();
  imageDescriberFactory.register('replicate', new FastStubDescriber());

  const noopLogger = {
    info() {},
    debug() {},
    warn() {},
    error() {},
    fatal() {},
  };

  const { app } = createApp({
    appLogger: noopLogger,
    requestLogger: (/** @type {any} */ req, /** @type {any} */ res, /** @type {any} */ next) => {
      req.log = noopLogger;
      next();
    },
    imageDescriberFactory,
    descriptionJobStore: createMemoryDescriptionJobStore(),
    outboundUrlPolicy: async () => {},
    runtimeState: createRuntimeState({ initialReady: true }),
    config: {
      ...config,
      auth: { enabled: false, tokens: [] },
      pageDescription: { ...config.pageDescription, concurrency: 3 },
      descriptionJobs: { ...config.descriptionJobs, waitTimeoutMs: 50, pollIntervalMs: 1 },
      scraper: { ...config.scraper, requestTimeoutMs: 5000 },
    },
  });

  return app;
};

/**
 * @param {any} app
 * @param {string} path
 */
const secureGet = (app, path) => request(app)
  .get(path)
  .set('X-Forwarded-Proto', 'https');

/**
 * @param {any} app
 * @param {string} pageUrl
 * @returns {Promise<number>}
 */
const settlePageDescription = async (app, pageUrl) => {
  const start = process.hrtime.bigint();
  const startResponse = await secureGet(
    app,
    `/api/v1/accessibility/descriptions?url=${encodeURIComponent(pageUrl)}&model=replicate`,
  );

  let response = startResponse;
  /**
   * @param {string} statusUrl
   * @param {number} attempt
   */
  const pollUntilTerminal = async (statusUrl, attempt) => {
    if (attempt > 50) {
      throw new Error(`page fan-out did not settle for ${pageUrl}`);
    }

    if (response.status === 200) {
      return;
    }

    if (response.status !== 202) {
      throw new Error(`unexpected page fan-out status ${response.status}`);
    }

    response = await secureGet(app, statusUrl);
    await pollUntilTerminal(statusUrl, attempt + 1);
  };

  await pollUntilTerminal(startResponse.body.statusUrl, 0);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  return elapsedMs;
};

/**
 * @param {any} app
 * @param {string} fixtureBaseUrl
 */
const measurePageFanOut = async (app, fixtureBaseUrl) => {
  /** @type {number[]} */
  const durations = [];

  /** @param {number} iteration */
  const runIteration = async (iteration) => {
    if (iteration >= PAGE_FAN_OUT_ITERATIONS) {
      return;
    }

    // Unique page URL per iteration busts the deterministic job cache so each
    // run does a real scrape + multi-image fan-out instead of a cache hit.
    const pageUrl = `${fixtureBaseUrl}/fixtures/page-with-images?perf=${iteration}`;
    durations.push(await settlePageDescription(app, pageUrl));
    await runIteration(iteration + 1);
  };

  await runIteration(0);
  return median(durations);
};

/** @param {any} app */
const measureDocsSteadyState = async (app) => {
  /** @type {number[]} */
  const durations = [];

  /** @param {number} iteration */
  const warmUp = async (iteration) => {
    if (iteration >= DOCS_WARMUP_ITERATIONS) {
      return;
    }

    await secureGet(app, '/api-docs/');
    await warmUp(iteration + 1);
  };

  /** @param {number} iteration */
  const measure = async (iteration) => {
    if (iteration >= DOCS_MEASURE_ITERATIONS) {
      return;
    }

    const start = process.hrtime.bigint();
    const response = await secureGet(app, '/api-docs/');
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;

    if (response.status !== 200) {
      throw new Error(`docs steady-state returned status ${response.status}`);
    }

    durations.push(elapsedMs);
    await measure(iteration + 1);
  };

  await warmUp(0);
  await measure(0);
  return median(durations);
};

const main = async () => {
  const acceptedBudgets = resolveAcceptedBudgets(process.env.PERF_BUDGETS_ACCEPTED);
  const pageFanOutBudgetMs = toNumber(process.env.PERF_PAGE_FAN_OUT_BUDGET_MS, 2000);
  const docsBudgetMs = toNumber(process.env.PERF_DOCS_BUDGET_MS, 150);

  const fixturePort = await reservePort();
  const fixtureBaseUrl = `http://127.0.0.1:${fixturePort}`;
  const fixtureServer = http.createServer(/** @type {any} */ (createFixtureApp({ baseUrl: fixtureBaseUrl })));
  await listen(fixtureServer, fixturePort);

  try {
    const app = buildPerfApp();
    const pageFanOutMs = await measurePageFanOut(app, fixtureBaseUrl);
    const docsSteadyStateMs = await measureDocsSteadyState(app);

    const report = summarizePerformanceReport([
      {
        label: PAGE_FAN_OUT_LABEL,
        durationMs: pageFanOutMs,
        budgetMs: pageFanOutBudgetMs,
        accepted: acceptedBudgets.has(PAGE_FAN_OUT_LABEL),
      },
      {
        label: DOCS_STEADY_STATE_LABEL,
        durationMs: docsSteadyStateMs,
        budgetMs: docsBudgetMs,
        accepted: acceptedBudgets.has(DOCS_STEADY_STATE_LABEL),
      },
    ]);

    writeLine('Performance smoke (warning-only until budgets are accepted)');
    report.results.forEach((result) => writeLine(formatSampleLine(result)));

    if (report.warnings.length > 0) {
      writeLine(
        `\n${report.warnings.length} provisional budget(s) exceeded. `
        + 'These are warnings only. Accept a budget via '
        + 'PERF_BUDGETS_ACCEPTED="page-fan-out,docs-steady-state" to make it blocking.',
      );
    }

    if (report.blocking) {
      writeLine(`\n${report.failures.length} accepted budget(s) exceeded; failing.`);
      return 1;
    }

    writeLine('\nNo accepted budgets exceeded.');
    return 0;
  } finally {
    await closeServer(fixtureServer);
  }
};

main()
  .then((exitCode) => process.exit(exitCode))
  .catch((error) => {
    process.stderr.write(`perf smoke failed: ${error.stack ?? error}\n`);
    process.exit(1);
  });
