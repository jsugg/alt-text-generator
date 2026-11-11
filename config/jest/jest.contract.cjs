const { createLaneConfig, TEST_MATCH } = require('./jest.base.cjs');

// API contract lane: the Jest + Supertest/Undici replacement for the Newman
// collection. It reuses the shared lifecycle and the allure-jest switch
// (ALLURE_RESULTS_DIR), and writes its own JUnit file so contract results stay
// separate from the CI lane's jest-junit output. JEST_JUNIT_* variables still
// override these defaults.
module.exports = {
  ...createLaneConfig({
    displayName: 'contract',
    testMatch: TEST_MATCH.contract,
  }),
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'reports/api-contract',
      outputName: 'junit.xml',
      suiteName: 'api-contract',
    }],
  ],
};
