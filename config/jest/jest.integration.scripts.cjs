const { createLaneConfig, TEST_MATCH } = require('./jest.base.cjs');

// Script/git integration lane. Drives real git clone/worktree/push flows, which
// exceed Jest's default 5s timeout under load — hence the extended timeout. The
// package script adds --runInBand to avoid concurrent working trees.
module.exports = createLaneConfig({
  displayName: 'scripts',
  testMatch: TEST_MATCH.scripts,
  testTimeout: 30000,
});
