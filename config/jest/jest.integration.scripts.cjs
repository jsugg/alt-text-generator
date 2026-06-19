const { createLaneConfig, TEST_MATCH } = require('./jest.base.cjs');

// Script/git integration lane. The test file owns its extended timeout because
// Jest treats timeouts as global-only in composed project configs. The package
// script adds --runInBand to avoid concurrent working trees.
module.exports = createLaneConfig({
  displayName: 'scripts',
  testMatch: TEST_MATCH.scripts,
});
