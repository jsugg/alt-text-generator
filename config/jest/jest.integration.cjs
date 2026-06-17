const {
  createLaneConfig,
  TEST_MATCH,
  INTEGRATION_IGNORE_PATTERNS,
} = require('./jest.base.cjs');

// General integration lane: top-level integration specs that exercise the HTTP
// surface with in-memory adapters. Redis-backed and script/git specs run in
// their own lanes.
module.exports = createLaneConfig({
  displayName: 'integration',
  testMatch: TEST_MATCH.integration,
  testPathIgnorePatterns: INTEGRATION_IGNORE_PATTERNS,
});
