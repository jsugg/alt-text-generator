const path = require('node:path');

const CONFIG_PATH = path.resolve(__dirname, '../../jest.config.cjs');

function loadJestConfig(allureResultsDir) {
  let config;

  if (typeof allureResultsDir === 'string') {
    process.env.ALLURE_RESULTS_DIR = allureResultsDir;
  } else {
    delete process.env.ALLURE_RESULTS_DIR;
  }

  jest.resetModules();
  jest.isolateModules(() => {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    config = require(CONFIG_PATH);
  });

  return config;
}

describe('Unit | Jest Configuration', () => {
  const originalAllureResultsDir = process.env.ALLURE_RESULTS_DIR;

  afterEach(() => {
    if (typeof originalAllureResultsDir === 'string') {
      process.env.ALLURE_RESULTS_DIR = originalAllureResultsDir;
    } else {
      delete process.env.ALLURE_RESULTS_DIR;
    }

    jest.resetModules();
  });

  it('keeps the standard node environment when Allure is disabled', () => {
    const config = loadJestConfig();

    expect(config.testEnvironment).toBe('node');
    expect(config.testEnvironmentOptions).toBeUndefined();
    expect(config.collectCoverage).toBe(true);
    expect(config.coverageDirectory).toBe('coverage');
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
