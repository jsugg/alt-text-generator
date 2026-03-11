#!/usr/bin/env node
/* eslint-disable no-console */

/** Syncs a validated source branch to a target branch by updating the target ref. */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

/**
 * Parses command-line arguments into a key/value object.
 *
 * @param {string[]} argv
 * @returns {{
 *   repo: string,
 *   sourceBranch: string,
 *   targetBranch: string,
 *   requiredChecks: string[]|null,
 *   outputFile: string|null,
 *   summaryFile: string|null,
 * }}
 */
function parseArgs(argv) {
  const args = {
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
 * Derives a safe promotion plan from branch state.
 *
 * @param {{
 *   sourceBranch: string,
 *   sourceSha: string,
 *   sourceAheadBy: number,
  *   targetAheadBy: number,
 *   targetBranch: string,
 *   targetSha: string,
 * }} options
 * @returns {{
 *   force: boolean,
 *   mode: 'already-aligned'|'fast-forward'|'history-realignment',
 *   needsUpdate: boolean,
 *   reason: string,
 * }}
 */
function derivePromotionPlan({
  sourceBranch,
  sourceSha,
  sourceAheadBy,
  targetAheadBy,
  targetBranch,
  targetSha,
}) {
  if (sourceSha === targetSha) {
    return {
      force: false,
      mode: 'already-aligned',
      needsUpdate: false,
      reason: `${targetBranch} already points to ${sourceBranch}@${sourceSha}.`,
    };
  }

  if (targetAheadBy > 0) {
    return {
      force: true,
      mode: 'history-realignment',
      needsUpdate: true,
      reason: `${targetBranch} contains branch-only history. Resetting it to `
        + `${sourceBranch}@${sourceSha} keeps both branches on the exact same commit.`,
    };
  }

  if (sourceAheadBy > 0) {
    return {
      force: false,
      mode: 'fast-forward',
      needsUpdate: true,
      reason: `Advancing ${targetBranch} to ${sourceBranch}@${sourceSha}.`,
    };
  }

  return {
    force: true,
    mode: 'history-realignment',
    needsUpdate: true,
    reason: `${targetBranch} has a different tip commit. Resetting it to `
      + `${sourceBranch}@${sourceSha} keeps both branches aligned.`,
  };
}

/**
 * Updates a branch ref to the requested commit SHA.
 *
 * @param {string} repo
 * @param {string} branch
 * @param {string} sha
 * @param {{ force?: boolean }} [options]
 */
function updateBranchRef(
  repo,
  branch,
  sha,
  { force = false } = {},
) {
  runGh([
    'api',
    '--method',
    'PATCH',
    `repos/${repo}/git/refs/heads/${branch}`,
    '-f',
    `sha=${sha}`,
    '-F',
    `force=${force}`,
  ]);
}

/**
 * Main entry point.
 */
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceSha = getBranchHeadSha(options.repo, options.sourceBranch);
  const targetSha = getBranchHeadSha(options.repo, options.targetBranch);
  const requiredChecks = resolveRequiredChecks(options);
  const checkRuns = getCheckRuns(options.repo, sourceSha);

  ensureRequiredChecksGreen(sourceSha, requiredChecks, checkRuns);
  console.log(`Verified ${options.sourceBranch}@${sourceSha} required checks.`);

  const sourceAheadBy = getAheadBy(options.repo, options.sourceBranch, options.targetBranch);
  const targetAheadBy = getAheadBy(options.repo, options.targetBranch, options.sourceBranch);
  const plan = derivePromotionPlan({
    sourceBranch: options.sourceBranch,
    sourceSha,
    sourceAheadBy,
    targetAheadBy,
    targetBranch: options.targetBranch,
    targetSha,
  });

  appendOutput(options.outputFile, 'source_sha', sourceSha);
  appendOutput(options.outputFile, 'target_sha_before', targetSha);
  appendOutput(options.outputFile, 'promotion_mode', plan.mode);
  appendOutput(options.outputFile, 'source_ahead_by', sourceAheadBy);
  appendOutput(options.outputFile, 'target_ahead_by', targetAheadBy);

  if (!plan.needsUpdate) {
    appendOutput(options.outputFile, 'up_to_date', true);
    appendSummary(options.summaryFile, [
      '## Promote to Production',
      '',
      `- ${plan.reason}`,
    ]);
    console.log(plan.reason);
    return;
  }

  updateBranchRef(options.repo, options.targetBranch, sourceSha, { force: plan.force });
  const targetShaAfter = getBranchHeadSha(options.repo, options.targetBranch);
  if (targetShaAfter !== sourceSha) {
    throw new Error(
      `Promotion verification failed: expected ${options.targetBranch} to point to ${sourceSha}, `
        + `but found ${targetShaAfter}.`,
    );
  }

  appendOutput(options.outputFile, 'up_to_date', false);
  appendOutput(options.outputFile, 'target_sha_after', targetShaAfter);
  appendSummary(options.summaryFile, [
    '## Promote to Production',
    '',
    `- Source branch: ${options.sourceBranch}`,
    `- Target branch: ${options.targetBranch}`,
    `- Source SHA: ${sourceSha}`,
    `- Target SHA before: ${targetSha}`,
    `- Target SHA after: ${targetShaAfter}`,
    `- Mode: ${plan.mode}`,
    `- ${plan.reason}`,
  ]);

  console.log(
    `Promoted ${options.sourceBranch}@${sourceSha} to ${options.targetBranch} `
      + `using ${plan.mode}.`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  derivePromotionPlan,
  ensureRequiredChecksGreen,
  parseArgs,
  resolveRequiredChecks,
};
