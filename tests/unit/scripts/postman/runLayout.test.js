const path = require('node:path');

const {
  generateRunId,
  resolveReportsBaseDir,
  resolveRunLayout,
} = require('../../../../scripts/postman/newman-reporting');

const ROOT = path.join(path.sep, 'tmp', 'harness-root');

describe('Unit | Scripts | Postman | Run Layout', () => {
  it('defaults the reports base dir to reports/newman and honors POSTMAN_REPORTS_DIR', () => {
    expect(resolveReportsBaseDir({}, ROOT)).toBe(path.join(ROOT, 'reports', 'newman'));
    expect(resolveReportsBaseDir({ POSTMAN_REPORTS_DIR: 'custom/out' }, ROOT))
      .toBe(path.join(ROOT, 'custom', 'out'));

    const absolute = path.join(path.sep, 'var', 'reports');
    expect(resolveReportsBaseDir({ POSTMAN_REPORTS_DIR: absolute }, ROOT)).toBe(absolute);
  });

  it('sanitizes an explicit run id and otherwise builds a collision-resistant one', () => {
    expect(generateRunId({ POSTMAN_RUN_ID: 'My Run #1' })).toBe('My-Run-1');

    const generated = generateRunId({}, { now: 0, pid: 123 });
    expect(generated).toMatch(/^1970-01-01T00-00-00-000Z-pid123-[a-z0-9]{1,6}$/u);

    expect(generateRunId({})).not.toBe(generateRunId({}));
  });

  it('nests every per-run artifact directory under the run directory', () => {
    const layout = resolveRunLayout({ env: {}, rootDir: ROOT, runId: 'run1' });
    const runDir = path.join(ROOT, 'reports', 'newman', 'run1');

    expect(layout).toMatchObject({
      baseDir: path.join(ROOT, 'reports', 'newman'),
      runId: 'run1',
      runDir,
      reportsDir: runDir,
      diagnosticsDir: path.join(runDir, 'diagnostics'),
      metaDir: path.join(runDir, 'meta'),
      allureResultsDir: path.join(runDir, 'allure-results'),
      allureResultsExplicit: false,
    });
  });

  it('keeps an explicit ALLURE_RESULTS_DIR for cross-run aggregation', () => {
    const layout = resolveRunLayout({
      env: { ALLURE_RESULTS_DIR: 'reports/allure-results' },
      rootDir: ROOT,
      runId: 'run1',
    });

    expect(layout.allureResultsExplicit).toBe(true);
    expect(layout.allureResultsDir).toBe(path.join(ROOT, 'reports', 'allure-results'));
  });

  it('roots the run directory at POSTMAN_REPORTS_DIR when provided', () => {
    const layout = resolveRunLayout({
      env: { POSTMAN_REPORTS_DIR: 'artifacts/newman' },
      rootDir: ROOT,
      runId: 'run9',
    });

    expect(layout.baseDir).toBe(path.join(ROOT, 'artifacts', 'newman'));
    expect(layout.runDir).toBe(path.join(ROOT, 'artifacts', 'newman', 'run9'));
  });
});
