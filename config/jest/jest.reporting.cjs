const {
  COMPOSED_LANES,
  ROOT_DIR,
} = require('./jest.base.cjs');

// Reporting lane. ALLURE_RESULTS_DIR makes each composed lane use allure-jest;
// this config intentionally does not add coverage or JUnit output.
module.exports = {
  rootDir: ROOT_DIR,
  projects: COMPOSED_LANES,
  collectCoverage: false,
};
