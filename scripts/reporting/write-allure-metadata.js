#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Escapes a value for a Java properties file.
 *
 * @param {string} value
 * @returns {string}
 */
function escapePropertiesValue(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

/**
 * Resolves the installed version for a dependency.
 *
 * @param {string} packageName
 * @param {string} rootDir
 * @returns {string}
 */
function getInstalledPackageVersion(packageName, rootDir = ROOT) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(require.resolve(`${packageName}/package.json`, {
      paths: [rootDir],
    })).version;
  } catch {
    return 'unknown';
  }
}

/**
 * Converts an object to Java properties file content.
 *
 * @param {Record<string, string>} values
 * @returns {string}
 */
function toPropertiesFile(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${escapePropertiesValue(value)}`)
    .join('\n')}\n`;
}

/**
 * Builds the launch-wide environment properties.
 *
 * @param {{ env?: NodeJS.ProcessEnv, rootDir?: string }} options
 * @returns {Record<string, string>}
 */
function buildEnvironmentProperties({ env = process.env, rootDir = ROOT } = {}) {
  const environmentProperties = {
    node_version: process.version,
    jest_version: getInstalledPackageVersion('jest', rootDir),
    newman_version: getInstalledPackageVersion('newman', rootDir),
    workflow: env.GITHUB_WORKFLOW || 'local',
    branch: env.GITHUB_REF_NAME || 'local',
    commit_sha: env.GITHUB_SHA || 'local',
  };

  if (env.ALLURE_HISTORY_KEY) {
    environmentProperties.history_stream = env.ALLURE_HISTORY_KEY;
  }

  if (env.ALLURE_REPORT_KIND) {
    environmentProperties.report_kind = env.ALLURE_REPORT_KIND;
  }

  if (env.GITHUB_EVENT_NAME) {
    environmentProperties.github_event_name = env.GITHUB_EVENT_NAME;
  }

  if (env.ALLURE_PR_NUMBER) {
    environmentProperties.pr_number = env.ALLURE_PR_NUMBER;
  }

  if (env.ALLURE_NEWMAN_MODE) {
    environmentProperties.newman_mode = env.ALLURE_NEWMAN_MODE;
  }

  if (env.ALLURE_WORKFLOW_KIND) {
    environmentProperties.workflow_kind = env.ALLURE_WORKFLOW_KIND;
  }

  if (env.ALLURE_BASE_URL) {
    environmentProperties.base_url = env.ALLURE_BASE_URL;
  }

  return environmentProperties;
}

/**
 * Builds executor metadata for GitHub Actions or local runs.
 *
 * @param {{ env?: NodeJS.ProcessEnv }} options
 * @returns {Record<string, string | number>}
 */
function buildExecutorMetadata({ env = process.env } = {}) {
  const runId = env.GITHUB_RUN_ID || '';
  const repository = env.GITHUB_REPOSITORY || '';
  const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com';
  const workflowName = env.GITHUB_WORKFLOW || 'Local';
  const runNumber = Number(env.GITHUB_RUN_NUMBER);
  const hasGitHubRunUrl = serverUrl && repository && runId;

  const executor = {
    name: 'GitHub Actions',
    type: 'github',
    buildName: runId ? `${workflowName} #${runId}` : `${workflowName} local`,
    reportName: `${workflowName} Allure Report`,
  };

  if (Number.isFinite(runNumber)) {
    executor.buildOrder = runNumber;
  }

  if (hasGitHubRunUrl) {
    executor.buildUrl = `${serverUrl}/${repository}/actions/runs/${runId}`;
  }

  return executor;
}

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{ resultsDir: string }}
 */
function parseArgs(argv) {
  let resultsDir = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--results-dir') {
      resultsDir = argv[index + 1] || null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!resultsDir) {
    throw new Error('Missing required argument: --results-dir <path>');
  }

  return {
    resultsDir: path.resolve(process.cwd(), resultsDir),
  };
}

/**
 * Writes Allure launch metadata files into the given results directory.
 *
 * @param {{ env?: NodeJS.ProcessEnv, resultsDir: string, rootDir?: string }} options
 * @returns {Promise<{
 *   environmentProperties: Record<string, string>,
 *   executor: Record<string, string | number>,
 * }>}
 */
async function writeAllureMetadata({ resultsDir, env = process.env, rootDir = ROOT }) {
  const environmentProperties = buildEnvironmentProperties({ env, rootDir });
  const executor = buildExecutorMetadata({ env });

  await fs.mkdir(resultsDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(resultsDir, 'environment.properties'),
      toPropertiesFile(environmentProperties),
      'utf8',
    ),
    fs.writeFile(
      path.join(resultsDir, 'executor.json'),
      `${JSON.stringify(executor, null, 2)}\n`,
      'utf8',
    ),
  ]);

  return {
    environmentProperties,
    executor,
  };
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));

  writeAllureMetadata(options).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildEnvironmentProperties,
  buildExecutorMetadata,
  escapePropertiesValue,
  parseArgs,
  toPropertiesFile,
  writeAllureMetadata,
};
