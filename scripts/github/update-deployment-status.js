#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Updates the GitHub Deployment status for a deployed production commit.
 * Post-deploy verification calls this to mark the deployment created by the
 * promotion workflow as success/failure; when no deployment record exists
 * (for example a direct production push), one is created first so every
 * production deploy stays observable.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const VALID_STATES = ['success', 'failure'];

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv
 * @returns {{
 *   repo: string,
 *   sha: string,
 *   state: string,
 *   environmentUrl: string|null,
 *   logUrl: string|null,
 *   outputFile: string|null,
 * }}
 */
function parseArgs(argv) {
  const args = {
    environmentUrl: null,
    logUrl: null,
    outputFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    index += 1;

    if (value === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case 'repo':
        args.repo = value;
        break;
      case 'sha':
        args.sha = value;
        break;
      case 'state':
        args.state = value;
        break;
      case 'environment-url':
        args.environmentUrl = value;
        break;
      case 'log-url':
        args.logUrl = value;
        break;
      case 'output-file':
        args.outputFile = value;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.repo || !args.sha || !args.state) {
    throw new Error('--repo, --sha, and --state are required');
  }

  if (!VALID_STATES.includes(args.state)) {
    throw new Error(`--state must be one of: ${VALID_STATES.join(', ')}`);
  }

  return args;
}

/**
 * @param {string[]} args
 * @returns {any}
 */
function runGhJson(args) {
  return JSON.parse(execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim());
}

/**
 * @param {string[]} args
 * @param {Record<string, unknown>} body
 * @returns {any}
 */
function runGhJsonWithBody(args, body) {
  return JSON.parse(execFileSync('gh', args.concat(['--input', '-']), {
    encoding: 'utf8',
    env: process.env,
    input: JSON.stringify(body),
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim());
}

/**
 * Picks the most recent deployment record from a deployments listing.
 *
 * @param {{ id: number, created_at: string }[]} deployments
 * @returns {{ id: number, created_at: string }|null}
 */
function pickLatestDeployment(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return null;
  }

  return deployments.reduce((latest, candidate) => (
    new Date(candidate.created_at).getTime() > new Date(latest.created_at).getTime()
      ? candidate
      : latest
  ));
}

/**
 * Finds the production deployment for a commit, creating one when missing.
 *
 * @param {{ repo: string, sha: string }} options
 * @returns {{ id: number, created: boolean }}
 */
function findOrCreateDeployment({ repo, sha }) {
  const deployments = runGhJson([
    'api',
    `repos/${repo}/deployments?sha=${sha}&environment=production&per_page=100`,
  ]);
  const latest = pickLatestDeployment(deployments);

  if (latest) {
    return { id: latest.id, created: false };
  }

  const deployment = runGhJsonWithBody(
    ['api', '--method', 'POST', `repos/${repo}/deployments`],
    {
      ref: sha,
      environment: 'production',
      auto_merge: false,
      required_contexts: [],
      description: 'Deployment record created by post-deploy verification.',
      payload: { source: 'post-deploy-verification' },
    },
  );

  return { id: deployment.id, created: true };
}

/**
 * Builds the deployment-status request body.
 *
 * @param {{
 *   state: string,
 *   environmentUrl: string|null,
 *   logUrl: string|null,
 * }} options
 * @returns {Record<string, unknown>}
 */
function buildStatusBody({ state, environmentUrl, logUrl }) {
  return {
    state,
    description: state === 'success'
      ? 'Post-deploy Newman verification passed.'
      : 'Post-deploy Newman verification failed.',
    auto_inactive: state === 'success',
    ...(environmentUrl ? { environment_url: environmentUrl } : {}),
    ...(logUrl ? { log_url: logUrl } : {}),
  };
}

/**
 * @param {string|null} outputFile
 * @param {string} key
 * @param {string|number|boolean} value
 */
function appendOutput(outputFile, key, value) {
  if (!outputFile) {
    return;
  }

  fs.appendFileSync(outputFile, `${key}=${value}\n`, 'utf8');
}

/**
 * Main entry point.
 */
function main() {
  const options = parseArgs(process.argv.slice(2));
  const { id, created } = findOrCreateDeployment({ repo: options.repo, sha: options.sha });

  runGhJsonWithBody(
    ['api', '--method', 'POST', `repos/${options.repo}/deployments/${id}/statuses`],
    buildStatusBody(options),
  );

  appendOutput(options.outputFile, 'deployment_id', id);
  appendOutput(options.outputFile, 'deployment_created', created);
  console.log(
    `Marked production deployment ${id} (${created ? 'created here' : 'from promotion'}) `
    + `as ${options.state} for ${options.sha}.`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  buildStatusBody,
  findOrCreateDeployment,
  parseArgs,
  pickLatestDeployment,
};
