const { spawnSync } = require('node:child_process');
const path = require('node:path');

const RedisStoreModule = require('rate-limit-redis');

const {
  createFailOpenStore,
  RATE_LIMIT_STORE_SCOPES,
} = require('../../../src/infrastructure/rateLimitStore');

const RedisStore = RedisStoreModule.default ?? RedisStoreModule;
const PROBE_PATH = path.resolve(__dirname, '../../fixtures/rate-limit/init-failure-probe.js');

describe('Unit | Infrastructure | Rate Limit Store init failure', () => {
  it('returns the store init promise so its rejection reaches the limiter', async () => {
    const store = createFailOpenStore({
      logger: { warn: jest.fn() },
      scope: RATE_LIMIT_STORE_SCOPES.API,
      store: new RedisStore({
        prefix: 'test:',
        sendCommand: async () => {
          throw new Error('Redis connection reset');
        },
      }),
    });

    await expect(store.init({ windowMs: 5_000 }))
      .rejects.toThrow('NOSCRIPT uploading script failed: Error: Redis connection reset');
  });

  it('keeps synchronous init stores working', () => {
    const init = jest.fn();
    const store = createFailOpenStore({
      scope: RATE_LIMIT_STORE_SCOPES.API,
      store: {
        decrement: jest.fn(), increment: jest.fn(), init, resetKey: jest.fn(),
      },
    });

    expect(store.init({ windowMs: 5_000 })).toBeUndefined();
    expect(init).toHaveBeenCalledWith({ windowMs: 5_000 });
  });

  // Reproduces the boot crash: a script-load failure during store init used to
  // become an unhandled rejection, which the app's fatal handler turns into a
  // process shutdown. Run in a child process so the real handlers observe it.
  describe('through express-rate-limit, the Redis store and the app fatal handlers', () => {
    /** @type {any} */
    let report;
    /** @type {string} */
    let stderr;

    beforeAll(() => {
      const result = spawnSync(process.execPath, [PROBE_PATH], {
        cwd: path.resolve(__dirname, '../../..'),
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
        timeout: 20_000,
      });

      stderr = result.stderr;
      expect(result.status).toBe(0);
      report = JSON.parse(result.stdout.trim().split('\n').pop());
    });

    it('does not reach the fatal unhandled-rejection path', () => {
      expect(report.fatal).toEqual([]);
      expect(report.shutdown).toBeUndefined();
    });

    it('lets express-rate-limit log the init failure', () => {
      expect(stderr).toContain('express-rate-limit: async error during store initialization.');
      expect(stderr).toContain('NOSCRIPT uploading script failed');
    });

    it('fails open while Redis is unavailable, as documented', () => {
      expect(report.responses[0]).toEqual({ phase: 'redis-down', status: 200 });
      expect(report.warn).toEqual([
        { operation: 'increment', message: 'Rate-limit store operation failed; allowing request to proceed' },
      ]);
    });

    it('reloads the scripts and counts in Redis again once it recovers', () => {
      expect(report.responses[1]).toMatchObject({ phase: 'redis-recovered', status: 200 });
      expect(report.responses[1].rateLimit).toContain('remaining=4');
      expect(report.commands.slice(-2)).toEqual(['SCRIPT', 'EVALSHA']);
    });
  });
});
