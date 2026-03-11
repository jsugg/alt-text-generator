#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{
 *   historyKey: string,
 *   outputDir: string,
 *   reportDir: string,
 *   reportKind: string,
 * }}
 */
function parseArgs(argv) {
  let historyKey = null;
  let outputDir = null;
  let reportDir = null;
  let reportKind = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--history-key') {
      historyKey = argv[index + 1] || null;
      index += 1;
    } else if (token === '--output-dir') {
      outputDir = argv[index + 1] || null;
      index += 1;
    } else if (token === '--report-dir') {
      reportDir = argv[index + 1] || null;
      index += 1;
    } else if (token === '--report-kind') {
      reportKind = argv[index + 1] || null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!historyKey) {
    throw new Error('Missing required argument: --history-key <key>');
  }

  if (!outputDir) {
    throw new Error('Missing required argument: --output-dir <path>');
  }

  if (!reportDir) {
    throw new Error('Missing required argument: --report-dir <path>');
  }

  if (!reportKind) {
    throw new Error('Missing required argument: --report-kind <kind>');
  }

  return {
    historyKey,
    outputDir: path.resolve(process.cwd(), outputDir),
    reportDir: path.resolve(process.cwd(), reportDir),
    reportKind,
  };
}

/**
 * Builds the manifest that accompanies the history artifact.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   historyKey: string,
 *   now?: string,
 *   reportKind: string,
 * }} options
 * @returns {Record<string, string>}
 */
function buildHistoryArtifactManifest({
  env = process.env,
  historyKey,
  now = new Date().toISOString(),
  reportKind,
}) {
  const manifest = {
    historyKey,
    reportKind,
    workflowName: env.GITHUB_WORKFLOW || 'local',
    runId: env.GITHUB_RUN_ID || 'local',
    runNumber: env.GITHUB_RUN_NUMBER || 'local',
    eventName: env.GITHUB_EVENT_NAME || 'local',
    refName: env.GITHUB_REF_NAME || 'local',
    createdAt: now,
  };

  if (env.ALLURE_NEWMAN_MODE) {
    manifest.newmanMode = env.ALLURE_NEWMAN_MODE;
  }

  if (env.ALLURE_BASE_URL) {
    manifest.baseUrl = env.ALLURE_BASE_URL;
  }

  if (env.ALLURE_PR_NUMBER) {
    manifest.pullRequestNumber = env.ALLURE_PR_NUMBER;
  }

  return manifest;
}

/**
 * Packages the generated Allure report history into a dedicated artifact directory.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   historyKey: string,
 *   outputDir: string,
 *   reportDir: string,
 *   reportKind: string,
 * }} options
 * @returns {Promise<Record<string, string>>}
 */
async function packageAllureHistoryArtifact({
  env = process.env,
  historyKey,
  outputDir,
  reportDir,
  reportKind,
}) {
  const sourceHistoryDir = path.join(reportDir, 'history');
  const destinationHistoryDir = path.join(outputDir, 'history');
  const manifest = buildHistoryArtifactManifest({
    env,
    historyKey,
    reportKind,
  });

  await fs.access(sourceHistoryDir);
  await fs.rm(outputDir, { force: true, recursive: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.cp(sourceHistoryDir, destinationHistoryDir, { recursive: true });
  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return manifest;
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));

  packageAllureHistoryArtifact(options).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildHistoryArtifactManifest,
  packageAllureHistoryArtifact,
  parseArgs,
};
