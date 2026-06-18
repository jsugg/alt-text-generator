const { createLaneConfig, TEST_MATCH } = require('./jest.base.cjs');

// Redis-backed integration lane. The package script marks this lane required;
// broad local sweeps may run it in optional mode, but CI always requires Redis.
module.exports = createLaneConfig({
  displayName: 'redis',
  testMatch: TEST_MATCH.redis,
});
