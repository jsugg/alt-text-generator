const path = require('node:path');

const allureResultsDir = process.env.ALLURE_RESULTS_DIR?.trim();
const resolvedAllureResultsDir = allureResultsDir
  ? path.resolve(__dirname, allureResultsDir)
  : null;

/** @type {import('jest').Config} */
const config = {
  testEnvironment: resolvedAllureResultsDir ? 'allure-jest/node' : 'node',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
    },
  },
  testMatch: [
    '**/tests/**/*.test.js',
  ],
};

if (resolvedAllureResultsDir) {
  config.testEnvironmentOptions = {
    resultsDir: resolvedAllureResultsDir,
  };
}

module.exports = config;
