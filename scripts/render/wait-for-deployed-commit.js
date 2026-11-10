#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Polls a deployed service's `/api/health` until it reports the expected commit.
 *
 * Render keeps serving the previous build until the new one passes its health
 * check, so post-deploy verification started straight after a `production` push
 * can exercise the build being replaced. This gate holds verification back until
 * the pushed commit is the one actually serving traffic.
 *
 * A build that predates commit reporting (no `commit` field) or a service that
 * does not expose one (`commit: null`) is treated as "not yet serving" and keeps
 * polling until the timeout, so the first deploy that introduces the field works.
 */

const { requestDeployProbe } = require('../run-postman-deploy');
const { DEFAULT_BASE_URL, normalizeBaseUrl } = require('../postman/live-provider-validation');

const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_INTERVAL_SECONDS = 15;
const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * @typedef {object} WaitArgs
 * @property {string} baseUrl
 * @property {string} expectedCommit
 * @property {number} timeoutMs
 * @property {number} pollIntervalMs
 */

/**
 * @typedef {object} HealthProbe
 * @property {Error} [error]
 * @property {unknown} [jsonBody]
 * @property {number} [status]
 */

/**
 * @param {string} key
 * @param {string} rawValue
 * @returns {number}
 */
function parsePositiveSeconds(key, rawValue) {
  if (!/^\d+$/.test(rawValue.trim()) || Number(rawValue) < 1) {
    throw new Error(`--${key} must be a whole number of seconds >= 1`);
  }

  return Number(rawValue) * 1000;
}

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv
 * @returns {WaitArgs}
 */
function parseArgs(argv) {
  /** @type {Partial<WaitArgs>} */
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    timeoutMs: DEFAULT_TIMEOUT_SECONDS * 1000,
    pollIntervalMs: DEFAULT_INTERVAL_SECONDS * 1000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const separatorIndex = token.indexOf('=');
    const key = separatorIndex >= 0 ? token.slice(2, separatorIndex) : token.slice(2);
    const rawValue = separatorIndex >= 0 ? token.slice(separatorIndex + 1) : argv[index + 1];

    if (separatorIndex < 0) {
      index += 1;
    }

    if (rawValue === undefined) {
      throw new Error(`Missing value for --${key}`);
    }

    switch (key) {
      case 'base-url':
        args.baseUrl = rawValue;
        break;
      case 'expected-commit':
        args.expectedCommit = rawValue.trim().toLowerCase();
        break;
      case 'timeout-seconds':
        args.timeoutMs = parsePositiveSeconds(key, rawValue);
        break;
      case 'interval-seconds':
        args.pollIntervalMs = parsePositiveSeconds(key, rawValue);
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.expectedCommit || !FULL_COMMIT_SHA_PATTERN.test(args.expectedCommit)) {
    throw new Error('--expected-commit must be a full 40-character commit SHA');
  }

  return /** @type {WaitArgs} */ (args);
}

/**
 * Decides whether a health probe shows the expected commit serving traffic, and
 * describes what was observed otherwise.
 *
 * @param {HealthProbe} probe
 * @param {string} expectedCommit - lowercase full SHA
 * @returns {{ matched: boolean, observation: string }}
 */
function evaluateHealthProbe(probe, expectedCommit) {
  if (probe.error) {
    return { matched: false, observation: `health request failed: ${probe.error.message}` };
  }

  if (probe.status !== 200) {
    return { matched: false, observation: `health returned HTTP ${probe.status}` };
  }

  const body = probe.jsonBody;

  if (!body || typeof body !== 'object') {
    return { matched: false, observation: 'health returned a non-JSON body' };
  }

  if (!('commit' in body)) {
    return {
      matched: false,
      observation: 'health payload has no commit field (build predates commit reporting)',
    };
  }

  const { commit } = /** @type {{ commit: unknown }} */ (body);

  if (typeof commit !== 'string' || commit.length === 0) {
    return {
      matched: false,
      observation: `health reports commit ${JSON.stringify(commit)} `
        + '(is RENDER_GIT_COMMIT exposed to the service?)',
    };
  }

  return {
    matched: commit.toLowerCase() === expectedCommit,
    observation: `serving commit ${commit}`,
  };
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Polls `<baseUrl>/api/health` until it serves the expected commit.
 *
 * @param {{
 *   baseUrl: string,
 *   expectedCommit: string,
 *   timeoutMs: number,
 *   pollIntervalMs: number,
 *   fetchFn?: typeof fetch,
 *   nowFn?: () => number,
 *   sleepFn?: (ms: number) => Promise<void>,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<number>} the number of probes it took
 */
async function waitForDeployedCommit({
  baseUrl,
  expectedCommit,
  timeoutMs,
  pollIntervalMs,
  fetchFn = fetch,
  nowFn = Date.now,
  sleepFn = delay,
  log = console.log,
}) {
  const healthUrl = new URL('/api/health', `${normalizeBaseUrl(baseUrl)}/`).toString();
  const deadline = nowFn() + timeoutMs;

  // Recursion (rather than an await-in-loop) keeps each poll sequential while
  // satisfying the repo's lint posture, mirroring waitForStableDeploy.
  /**
   * @param {number} attempt
   * @returns {Promise<number>}
   */
  const poll = async (attempt) => {
    const probe = await requestDeployProbe(fetchFn, healthUrl);
    const { matched, observation } = evaluateHealthProbe(probe, expectedCommit);

    if (matched) {
      log(`[deploy] ${healthUrl} is serving ${expectedCommit} (probe ${attempt}).`);
      return attempt;
    }

    const remainingMs = deadline - nowFn();

    if (remainingMs <= 0) {
      throw new Error(
        `Timed out after ${timeoutMs / 1000}s waiting for ${healthUrl} to serve commit `
        + `${expectedCommit}. Last observation: ${observation}. Check the Render deploy for `
        + 'this commit: it may still be building, or it failed and the previous build is live.',
      );
    }

    log(`[deploy] waiting for ${expectedCommit} (probe ${attempt}): ${observation}`);
    await sleepFn(Math.min(pollIntervalMs, remainingMs));
    return poll(attempt + 1);
  };

  return poll(1);
}

/**
 * Main entry point.
 */
async function main() {
  await waitForDeployedCommit(parseArgs(process.argv.slice(2)));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  evaluateHealthProbe,
  parseArgs,
  waitForDeployedCommit,
};
