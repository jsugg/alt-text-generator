const path = require('node:path');

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
  buildNewmanReportPaths,
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
};
