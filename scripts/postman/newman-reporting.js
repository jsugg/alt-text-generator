const path = require('node:path');

// Subdirectories the harness writes underneath a per-run output directory that
// never contain Newman JSON reports. Report discovery skips them so generated
// metadata and Allure output are not mistaken for Newman results.
const RESERVED_REPORT_SUBDIRS = new Set([
  'meta',
  'diagnostics',
  'allure-results',
  'allure-report',
]);

/**
 * Resolves the optional Allure results directory from the environment.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} rootDir
 * @returns {string | null}
 */
function resolveAllureResultsDir(env = process.env, rootDir = process.cwd()) {
  const resultsDir = env.ALLURE_RESULTS_DIR?.trim();

  if (!resultsDir) {
    return null;
  }

  return path.resolve(rootDir, resultsDir);
}

/**
 * Resolves the base directory that per-run Newman output is nested under.
 * Configurable through POSTMAN_REPORTS_DIR; defaults to <root>/reports/newman.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} rootDir
 * @returns {string}
 */
function resolveReportsBaseDir(env = process.env, rootDir = process.cwd()) {
  const configured = env.POSTMAN_REPORTS_DIR?.trim();

  if (configured) {
    return path.resolve(rootDir, configured);
  }

  return path.join(rootDir, 'reports', 'newman');
}

/**
 * @param {string} value
 * @returns {string}
 */
function sanitizeRunIdSegment(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/**
 * Builds a collision-resistant run identifier. An explicit POSTMAN_RUN_ID wins
 * (after sanitization); otherwise a timestamp + pid + random suffix keeps
 * concurrent runs apart even when they start in the same millisecond.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {{ now?: number, pid?: number }} [options]
 * @returns {string}
 */
function generateRunId(env = process.env, { now = Date.now(), pid = process.pid } = {}) {
  const configured = env.POSTMAN_RUN_ID?.trim();

  if (configured) {
    const sanitized = sanitizeRunIdSegment(configured);

    if (sanitized) {
      return sanitized;
    }
  }

  const timestamp = new Date(now).toISOString().replace(/[:.]/gu, '-');
  const random = Math.random().toString(36).slice(2, 8);

  return `${timestamp}-pid${pid}-${random}`;
}

/**
 * Resolves the full per-run output layout: the run directory plus the report,
 * diagnostics, metadata, and Allure subdirectories nested under it.
 *
 * @param {{ env?: NodeJS.ProcessEnv, rootDir?: string, runId?: string }} [options]
 * @returns {{
 *   allureResultsDir: string,
 *   allureResultsExplicit: boolean,
 *   baseDir: string,
 *   diagnosticsDir: string,
 *   metaDir: string,
 *   reportsDir: string,
 *   runDir: string,
 *   runId: string,
 * }}
 */
function resolveRunLayout({ env = process.env, rootDir = process.cwd(), runId } = {}) {
  const baseDir = resolveReportsBaseDir(env, rootDir);
  const resolvedRunId = runId || generateRunId(env);
  const runDir = path.join(baseDir, resolvedRunId);
  const explicitAllureResultsDir = resolveAllureResultsDir(env, rootDir);

  return {
    allureResultsDir: explicitAllureResultsDir || path.join(runDir, 'allure-results'),
    allureResultsExplicit: Boolean(explicitAllureResultsDir),
    baseDir,
    diagnosticsDir: path.join(runDir, 'diagnostics'),
    metaDir: path.join(runDir, 'meta'),
    reportsDir: runDir,
    runDir,
    runId: resolvedRunId,
  };
}

/**
 * Builds the JSON and JUnit report paths for a Newman run label.
 *
 * @param {{ label: string, reportsDir: string }} options
 * @returns {{ jsonReportPath: string, junitReportPath: string }}
 */
function buildNewmanReportPaths({ label, reportsDir }) {
  return {
    jsonReportPath: path.join(reportsDir, `${label}.json`),
    junitReportPath: path.join(reportsDir, `${label}.xml`),
  };
}

/**
 * Builds reporter arguments for a Newman run.
 *
 * @param {{ allureResultsDir?: string | null, label: string, reportsDir: string }} options
 * @returns {string[]}
 */
function buildNewmanReporterArgs({
  label,
  reportsDir,
  allureResultsDir = null,
}) {
  const { jsonReportPath, junitReportPath } = buildNewmanReportPaths({
    label,
    reportsDir,
  });
  const reporters = ['cli', 'json', 'junit'];
  const args = [
    '-r',
    reporters.join(','),
    '--reporter-json-export',
    jsonReportPath,
    '--reporter-junit-export',
    junitReportPath,
  ];

  if (allureResultsDir) {
    reporters.push('allure');
    args[1] = reporters.join(',');
    args.push('--reporter-allure-resultsDir', allureResultsDir);
  }

  return args;
}

module.exports = {
  RESERVED_REPORT_SUBDIRS,
  buildNewmanReportPaths,
  buildNewmanReporterArgs,
  generateRunId,
  resolveAllureResultsDir,
  resolveReportsBaseDir,
  resolveRunLayout,
};
