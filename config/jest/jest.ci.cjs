const {
  COMPOSED_LANES,
  COVERAGE_THRESHOLD,
  ROOT_DIR,
} = require('./jest.base.cjs');

// CI lane: composes every tier explicitly and is the only Jest entry point that
// emits JUnit (via jest-junit) alongside coverage. Allure results are emitted
// too when ALLURE_RESULTS_DIR is set, because each composed lane resolves that
// environment. jest-junit reads its output location from JEST_JUNIT_*
// environment variables.
module.exports = {
  rootDir: ROOT_DIR,
  projects: COMPOSED_LANES,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThreshold: COVERAGE_THRESHOLD,
  reporters: ['default', 'jest-junit'],
};
