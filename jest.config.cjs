const {
  COVERAGE_THRESHOLD,
  resolveTestEnvironment,
} = require('./config/jest/jest.base.cjs');

// Default Jest config (bare `jest`) and the reporting lane (`npm run test:allure`,
// `npm run report:allure`). Runs every spec and switches to the Allure
// environment when ALLURE_RESULTS_DIR is set. Lane-scoped configs live in
// config/jest/ and are selected through dedicated package scripts.
/** @type {import('jest').Config} */
const config = {
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThreshold: COVERAGE_THRESHOLD,
  testMatch: [
    '**/tests/**/*.test.js',
  ],
  ...resolveTestEnvironment(),
};

module.exports = config;
