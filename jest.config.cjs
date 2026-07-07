const {
  COVERAGE_COLLECTION_PATTERNS,
  COVERAGE_PATH_IGNORE_PATTERNS,
  COVERAGE_THRESHOLD,
  JEST_SETUP_FILE,
  resolveTestEnvironment,
} = require('./config/jest/jest.base.cjs');

// Default Jest config for bare `jest`. Package scripts use lane-scoped configs
// under config/jest/ so fast, CI, coverage, and reporting runs stay explicit.
/** @type {import('jest').Config} */
const config = {
  collectCoverage: true,
  collectCoverageFrom: COVERAGE_COLLECTION_PATTERNS,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: COVERAGE_PATH_IGNORE_PATTERNS,
  coverageThreshold: COVERAGE_THRESHOLD,
  setupFilesAfterEnv: [JEST_SETUP_FILE],
  testMatch: [
    '**/tests/**/*.test.js',
  ],
  ...resolveTestEnvironment(),
};

module.exports = config;
