const { createLaneConfig, TEST_MATCH } = require('./jest.base.cjs');

// Fast, deterministic unit lane — the default `npm test`. No coverage, no
// reporters, no external services.
module.exports = createLaneConfig({
  displayName: 'unit',
  testMatch: TEST_MATCH.unit,
});
