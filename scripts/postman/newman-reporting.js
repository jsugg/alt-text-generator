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
  const reporters = ['cli', 'json', 'junit'];
  const args = [
    '-r',
    reporters.join(','),
    '--reporter-json-export',
    path.join(reportsDir, `${label}.json`),
    '--reporter-junit-export',
    path.join(reportsDir, `${label}.xml`),
  ];

  if (allureResultsDir) {
    reporters.push('allure');
    args[1] = reporters.join(',');
    args.push('--reporter-allure-resultsDir', allureResultsDir);
  }

  return args;
}

module.exports = {
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
};
