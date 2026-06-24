const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '../../jest.config.cjs');
const {
  COVERAGE_COLLECTION_PATTERNS,
  COVERAGE_PATH_IGNORE_PATTERNS,
  COVERAGE_THRESHOLD,
} = require('../../config/jest/jest.base.cjs');
const { loadFreshModule } = require('../setup/testEnv');

// tests/setup restores ALLURE_RESULTS_DIR after each test; this loader only
// declares whether it is set for a given config load.
function loadJestConfig(allureResultsDir) {
  return loadFreshModule(
    // eslint-disable-next-line import/no-dynamic-require
    () => require(CONFIG_PATH),
    { ALLURE_RESULTS_DIR: typeof allureResultsDir === 'string' ? allureResultsDir : undefined },
  );
}

describe('Unit | Jest Configuration', () => {
  it('keeps the standard node environment when Allure is disabled', () => {
    const config = loadJestConfig();

    expect(config.testEnvironment).toBe('node');
    expect(config.testEnvironmentOptions).toBeUndefined();
    expect(config.collectCoverage).toBe(true);
    expect(config.collectCoverageFrom).toEqual(COVERAGE_COLLECTION_PATTERNS);
    expect(config.coverageDirectory).toBe('coverage');
    expect(config.coveragePathIgnorePatterns).toEqual(COVERAGE_PATH_IGNORE_PATTERNS);
    expect(config.coverageThreshold).toEqual(COVERAGE_THRESHOLD);
    expect(config.testMatch).toEqual(['**/tests/**/*.test.js']);
  });

  it('switches to the Allure test environment when a results dir is provided', () => {
    const config = loadJestConfig('reports/allure-results');

    expect(config.testEnvironment).toBe('allure-jest/node');
    expect(config.testEnvironmentOptions).toEqual({
      resultsDir: path.resolve(__dirname, '../../reports/allure-results'),
    });
  });
});
