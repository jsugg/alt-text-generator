const path = require('node:path');

const {
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
} = require('../../scripts/postman/newman-reporting');

describe('run-postman-harness reporting helpers', () => {
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
