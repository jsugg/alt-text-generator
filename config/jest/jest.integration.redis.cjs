const { createLaneConfig, TEST_MATCH } = require('./jest.base.cjs');

// Redis-backed integration lane. Requires a redis-server binary on PATH; the
// spec skips locally when it is absent and is mandatory in CI.
module.exports = createLaneConfig({
  displayName: 'redis',
  testMatch: TEST_MATCH.redis,
  testTimeout: 15000,
});
