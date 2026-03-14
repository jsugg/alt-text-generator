const path = require('node:path');

const {
  buildNewmanReportPaths,
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
} = require('../../scripts/postman/newman-reporting');
const {
  DEFAULT_MAX_RESPONSE_TIME_MS,
  PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS,
  PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS,
  PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS,
  resolveMaxResponseTimeMs,
  resolveNewmanTimeoutRequestMs,
} = require('../../scripts/postman/harness-timeouts');

describe('Unit | Postman Harness Reporting', () => {
  it('uses provider-validation budgets only for provider-validation runs', () => {
    expect(resolveMaxResponseTimeMs()).toBe(DEFAULT_MAX_RESPONSE_TIME_MS);
    expect(resolveMaxResponseTimeMs({ providerValidationModeEnabled: true }))
      .toBe(PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS);
    expect(resolveNewmanTimeoutRequestMs()).toBe(10000);
    expect(resolveNewmanTimeoutRequestMs({ providerValidationModeEnabled: true }))
      .toBe(PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS);
    expect(PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS).toBe(90000);
  });

  it('keeps the existing CLI, JSON, and JUnit reporters by default', () => {
    const args = buildNewmanReporterArgs({
      label: 'smoke',
      reportsDir: path.join(process.cwd(), 'reports', 'newman'),
    });

    expect(args).toEqual([
      '-r',
      'cli,json,junit',
      '--reporter-json-export',
      path.join(process.cwd(), 'reports', 'newman', 'smoke.json'),
      '--reporter-junit-export',
      path.join(process.cwd(), 'reports', 'newman', 'smoke.xml'),
    ]);
  });

  it('derives stable JSON and JUnit report paths from the run label', () => {
    expect(buildNewmanReportPaths({
      label: 'provider-integration-openai',
      reportsDir: path.join(process.cwd(), 'reports', 'newman'),
    })).toEqual({
      jsonReportPath: path.join(
        process.cwd(),
        'reports',
        'newman',
        'provider-integration-openai.json',
      ),
      junitReportPath: path.join(
        process.cwd(),
        'reports',
        'newman',
        'provider-integration-openai.xml',
      ),
    });
  });

  it('adds the Allure reporter when a results directory is configured', () => {
    const args = buildNewmanReporterArgs({
      label: 'core',
      reportsDir: path.join(process.cwd(), 'reports', 'newman'),
      allureResultsDir: '/tmp/allure-results',
    });

    expect(args).toEqual([
      '-r',
      'cli,json,junit,allure',
      '--reporter-json-export',
      path.join(process.cwd(), 'reports', 'newman', 'core.json'),
      '--reporter-junit-export',
      path.join(process.cwd(), 'reports', 'newman', 'core.xml'),
      '--reporter-allure-resultsDir',
      '/tmp/allure-results',
    ]);
  });

  it('resolves and trims the Allure results directory from the environment', () => {
    expect(resolveAllureResultsDir({
      ALLURE_RESULTS_DIR: ' reports/allure-results ',
    }, process.cwd())).toBe(path.join(process.cwd(), 'reports', 'allure-results'));
    expect(resolveAllureResultsDir({}, process.cwd())).toBeNull();
  });
});
