/*
 * Boots the real limiter stack against a Redis whose SCRIPT LOAD fails during
 * store init, then "recovers". Prints one JSON report line on stdout.
 * Run as a child process so unhandled rejections reach the app's real fatal
 * handlers instead of the test runner.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const RedisStoreModule = require('rate-limit-redis');
const request = require('supertest');

const { createFailOpenStore } = require('../../../src/infrastructure/rateLimitStore');
const { registerFatalHandlers } = require('../../../src/server/registerFatalHandlers');

const RedisStore = RedisStoreModule.default ?? RedisStoreModule;
const report = { fatal: [], warn: [], responses: [], commands: [] };
let redisAvailable = false;

registerFatalHandlers({
  getShutdownHandler: () => () => {
    report.shutdown = true;
  },
  logger: {
    fatal: (details, message) => report.fatal.push({ message, error: String(details?.err?.message) }),
    error: () => {},
  },
});

const sendCommand = async (...args) => {
  report.commands.push(args[0]);

  if (!redisAvailable) {
    throw new Error('Redis connection reset');
  }

  if (args[0] === 'SCRIPT') {
    return 'a'.repeat(40);
  }

  if (args[0] === 'EVALSHA') {
    return [1, 60_000];
  }

  return 'OK';
};

const store = createFailOpenStore({
  logger: { warn: (details, message) => report.warn.push({ operation: details.operation, message }) },
  scope: 'api',
  store: new RedisStore({ prefix: 'probe:', sendCommand }),
});

const app = express();
app.use(rateLimit({ windowMs: 60_000, limit: 5, store, standardHeaders: 'draft-7', legacyHeaders: false }));
app.get('/', (_req, res) => res.send('ok'));

const settle = () => new Promise((resolve) => {
  setTimeout(resolve, 50);
});

(async () => {
  await settle();
  const whileDown = await request(app).get('/');
  report.responses.push({ phase: 'redis-down', status: whileDown.status });

  redisAvailable = true;
  const afterRecovery = await request(app).get('/');
  report.responses.push({
    phase: 'redis-recovered',
    status: afterRecovery.status,
    rateLimit: afterRecovery.headers.ratelimit ?? null,
  });

  await settle();
  process.stdout.write(`${JSON.stringify(report)}\n`);
})();
