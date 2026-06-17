const {
  COMPOSED_LANES,
  COVERAGE_THRESHOLD,
  ROOT_DIR,
} = require('./jest.base.cjs');

// Coverage lane: runs every tier as a Jest project and enforces the shared
// coverage gate. Coverage options are root-level only, so they live here rather
// than in the individual lane configs.
module.exports = {
  rootDir: ROOT_DIR,
  projects: COMPOSED_LANES,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThreshold: COVERAGE_THRESHOLD,
};
