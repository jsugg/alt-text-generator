#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Creates or reuses a promotion PR from a validated source branch into a target
 * production branch after confirming all required source-branch checks passed.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');

const RETRYABLE_AUTO_MERGE_ERROR_FRAGMENT = 'pull request is in unstable status';

/**
 * Parses a CLI boolean flag value.
 *
 * @param {string} value
 * @param {string} flag
 * @returns {boolean}
 */
function parseBoolean(value, flag) {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  throw new Error(`${flag} must be "true" or "false"`);
}

/**
 * Parses command-line arguments into a key/value object.
 *
 * @param {string[]} argv
 * @returns {{
 *   repo: string,
 *   sourceBranch: string,
 *   targetBranch: string,
 *   requiredChecks: string[]|null,
 *   autoMerge: boolean,
 *   outputFile: string|null,
 *   summaryFile: string|null,
 * }}
 */
function parseArgs(argv) {
  const args = {
    autoMerge: false,
    outputFile: null,
    summaryFile: null,
    requiredChecks: null,
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
      case 'repo':
        args.repo = rawValue;
        break;
      case 'source-branch':
        args.sourceBranch = rawValue;
        break;
      case 'target-branch':
        args.targetBranch = rawValue;
        break;
      case 'required-checks':
        args.requiredChecks = rawValue
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        break;
      case 'auto-merge':
        args.autoMerge = parseBoolean(rawValue, '--auto-merge');
        break;
      case 'output-file':
        args.outputFile = rawValue;
        break;
      case 'summary-file':
        args.summaryFile = rawValue;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.repo || !args.sourceBranch || !args.targetBranch) {
    throw new Error('--repo, --source-branch, and --target-branch are required');
  }

  return args;
}

/**
 * Runs a gh CLI command and returns trimmed stdout.
 *
 * @param {string[]} args
 * @returns {string}
 */
function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Runs a gh CLI command that returns JSON.
 *
 * @param {string[]} args
 * @returns {any}
 */
function runGhJson(args) {
  return JSON.parse(runGh(args));
}

/**
 * Appends a single-line output to a GitHub Actions output file.
 *
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
 * Appends markdown to a GitHub Actions summary file.
 *
 * @param {string|null} summaryFile
 * @param {string[]} lines
 */
function appendSummary(summaryFile, lines) {
  if (!summaryFile) {
    return;
  }

  fs.appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8');
}

/**
 * Returns the current commit SHA for a branch.
 *
 * @param {string} repo
 * @param {string} branch
 * @returns {string}
 */
function getBranchHeadSha(repo, branch) {
  const payload = runGhJson(['api', `repos/${repo}/branches/${branch}`]);
  return payload.commit.sha;
}

/**
 * Returns the required status-check contexts for a protected branch.
 *
 * @param {string} repo
 * @param {string} branch
 * @returns {string[]}
 */
function getRequiredCheckContexts(repo, branch) {
  const payload = runGhJson(['api', `repos/${repo}/branches/${branch}/protection`]);
  return payload.required_status_checks.contexts;
}

/**
 * Resolves the required status checks from explicit CLI input or branch protection.
 *
 * @param {{
 *   repo: string,
 *   sourceBranch: string,
 *   requiredChecks: string[]|null,
 * }} options
 * @returns {string[]}
 */
function resolveRequiredChecks(options) {
  if (options.requiredChecks && options.requiredChecks.length > 0) {
    return options.requiredChecks;
  }

  return getRequiredCheckContexts(options.repo, options.sourceBranch);
}

/**
 * Returns the check runs for a commit.
 *
 * @param {string} repo
 * @param {string} sha
 * @returns {{ name: string, conclusion: string|null }[]}
 */
function getCheckRuns(repo, sha) {
  const payload = runGhJson(['api', `repos/${repo}/commits/${sha}/check-runs`]);
  return payload.check_runs || [];
}

/**
 * Throws when any required status check is not successful on the given SHA.
 *
 * @param {string} sha
 * @param {string[]} requiredChecks
 * @param {{ name: string, conclusion: string|null }[]} checkRuns
 */
function ensureRequiredChecksGreen(sha, requiredChecks, checkRuns) {
  const conclusionsByName = new Map();

  checkRuns.forEach((run) => {
    const conclusions = conclusionsByName.get(run.name) || new Set();
    conclusions.add(run.conclusion);
    conclusionsByName.set(run.name, conclusions);
  });

  const missing = requiredChecks.filter(
    (name) => !conclusionsByName.has(name) || !conclusionsByName.get(name).has('success'),
  );

  if (missing.length > 0) {
    throw new Error(
      `Source commit ${sha} is missing successful required checks: ${missing.join(', ')}`,
    );
  }
}

/**
 * Returns how many commits the source branch is ahead of the target branch.
 *
 * @param {string} repo
 * @param {string} sourceBranch
 * @param {string} targetBranch
 * @returns {number}
 */
function getAheadBy(repo, sourceBranch, targetBranch) {
  const payload = runGhJson(['api', `repos/${repo}/compare/${targetBranch}...${sourceBranch}`]);
  return payload.ahead_by;
}

/**
 * Returns the first open promotion PR from source to target, if one exists.
 *
 * @param {string} repo
 * @param {string} sourceBranch
 * @param {string} targetBranch
 * @returns {{ number: number, url: string }|null}
 */
function findExistingPromotionPr(repo, sourceBranch, targetBranch) {
  const pullRequests = runGhJson([
    'pr',
    'list',
    '--repo',
    repo,
    '--base',
    targetBranch,
    '--head',
    sourceBranch,
    '--state',
    'open',
    '--json',
    'number,url',
  ]);

  return pullRequests[0] || null;
}

/**
 * Creates a promotion PR and returns its number and URL.
 *
 * @param {string} repo
 * @param {string} sourceBranch
 * @param {string} targetBranch
 * @returns {{ number: number, url: string }}
 */
function createPromotionPr(repo, sourceBranch, targetBranch) {
  const body = [
    `Promote the current \`${sourceBranch}\` branch into \`${targetBranch}\`.`,
    '',
    'This PR was created by the `Promote to Production` workflow after verifying that the source branch had all required checks green.',
  ].join('\n');

  const url = runGh([
    'pr',
    'create',
    '--repo',
    repo,
    '--base',
    targetBranch,
    '--head',
    sourceBranch,
    '--title',
    `Promote ${sourceBranch} to ${targetBranch}`,
    '--body',
    body,
  ]);

  const number = Number(url.split('/').pop());

  if (!number) {
    throw new Error(`Unable to parse PR number from URL: ${url}`);
  }

  return { number, url };
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isRetryableAutoMergeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes(RETRYABLE_AUTO_MERGE_ERROR_FRAGMENT);
}

/**
 * Enables auto-merge for a PR.
 *
 * @param {string} repo
 * @param {number} pullRequestNumber
 * @param {{ maxAttempts?: number, retryDelayMs?: number }} [options]
 */
async function enableAutoMerge(
  repo,
  pullRequestNumber,
  { maxAttempts = 5, retryDelayMs = 2000 } = {},
) {
  async function attemptEnable(attempt) {
    try {
      runGh([
        'pr',
        'merge',
        String(pullRequestNumber),
        '--repo',
        repo,
        '--merge',
        '--auto',
      ]);
    } catch (error) {
      if (!isRetryableAutoMergeError(error) || attempt >= maxAttempts) {
        throw error;
      }

      console.warn(
        `Auto-merge enable attempt ${attempt} hit a transient unstable PR status. `
          + `Retrying in ${retryDelayMs}ms...`,
      );
      await sleep(retryDelayMs);
      await attemptEnable(attempt + 1);
    }
  }

  await attemptEnable(1);
}

/**
 * Main entry point.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceSha = getBranchHeadSha(options.repo, options.sourceBranch);
  const requiredChecks = resolveRequiredChecks(options);
  const checkRuns = getCheckRuns(options.repo, sourceSha);

  ensureRequiredChecksGreen(sourceSha, requiredChecks, checkRuns);
  console.log(`Verified ${options.sourceBranch}@${sourceSha} required checks.`);

  const aheadBy = getAheadBy(options.repo, options.sourceBranch, options.targetBranch);
  appendOutput(options.outputFile, 'ahead_by', aheadBy);

  if (aheadBy === 0) {
    appendOutput(options.outputFile, 'up_to_date', true);
    appendSummary(options.summaryFile, [
      '## Promote to Production',
      '',
      `- ${options.targetBranch} is already up to date with ${options.sourceBranch}.`,
    ]);
    console.log(`${options.targetBranch} is already up to date with ${options.sourceBranch}.`);
    return;
  }

  const existingPr = findExistingPromotionPr(
    options.repo,
    options.sourceBranch,
    options.targetBranch,
  );
  const promotionPr = existingPr || createPromotionPr(
    options.repo,
    options.sourceBranch,
    options.targetBranch,
  );

  if (options.autoMerge) {
    await enableAutoMerge(options.repo, promotionPr.number);
  }

  appendOutput(options.outputFile, 'up_to_date', false);
  appendOutput(options.outputFile, 'pr_number', promotionPr.number);
  appendOutput(options.outputFile, 'pr_url', promotionPr.url);
  appendSummary(options.summaryFile, [
    '## Promote to Production',
    '',
    `- Promotion PR: ${promotionPr.url}`,
    `- Auto-merge: ${options.autoMerge ? 'enabled' : 'disabled'}`,
  ]);

  console.log(`Promotion PR ready: ${promotionPr.url}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  enableAutoMerge,
  ensureRequiredChecksGreen,
  isRetryableAutoMergeError,
  parseArgs,
  resolveRequiredChecks,
};
