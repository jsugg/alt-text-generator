const {
  COMPOSED_LANES,
  ROOT_DIR,
} = require('./jest.base.cjs');

// Composite lane for compatibility checks. Runs every tier without coverage,
// JUnit, or reporting adapters; those stay in test:coverage/test:ci/test:allure.
module.exports = {
  rootDir: ROOT_DIR,
  projects: COMPOSED_LANES,
  collectCoverage: false,
};
