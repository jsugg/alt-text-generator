#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Rolls the production branch back to a previous known-good commit.
 * Dry-run by default: prints the plan without moving the ref. The real run
 * force-updates the production ref through the GitHub App token (the same
 * trust boundary as promotion) and records a rollback deployment.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

// gh responses such as `compare/<base>...<head>` include the full diff of every
// commit between the branches and can exceed execFileSync's 1MB default maxBuffer
// (ENOBUFS) when history has diverged widely. Allow generous headroom so a
// rollback never fails on buffer size while an incident is in progress.
const GH_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/**
 * @typedef {object} RollbackArgs
 * @property {string} repo
 * @property {string} targetBranch
 * @property {string} toSha
 * @property {string} reason
 * @property {boolean} dryRun
 * @property {string|null} outputFile
 * @property {string|null} summaryFile
 */

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv
 * @returns {RollbackArgs}
 */
function parseArgs(argv) {
  /** @type {Partial<RollbackArgs>} */
  const args = {
    dryRun: true,
    outputFile: null,
    summaryFile: null,
    targetBranch: 'production',
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
      case 'target-branch':
        args.targetBranch = value;
        break;
      case 'to-sha':
        args.toSha = value;
        break;
      case 'reason':
        args.reason = value;
        break;
      case 'dry-run':
        if (value !== 'true' && value !== 'false') {
          throw new Error('--dry-run must be "true" or "false"');
        }

        args.dryRun = value === 'true';
        break;
      case 'output-file':
        args.outputFile = value;
        break;
      case 'summary-file':
        args.summaryFile = value;
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.repo || !args.toSha || !args.reason) {
    throw new Error('--repo, --to-sha, and --reason are required');
  }

  return /** @type {RollbackArgs} */ (args);
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: GH_MAX_BUFFER_BYTES,
  }).trim();
}

/**
 * @param {string[]} args
 * @returns {any}
 */
function runGhJson(args) {
  return JSON.parse(runGh(args));
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
    maxBuffer: GH_MAX_BUFFER_BYTES,
  }).trim());
}

/**
 * Derives the rollback plan from branch state.
 *
 * @param {{
 *   currentSha: string,
 *   targetBranch: string,
 *   toSha: string,
 * }} options
 * @returns {{ needsUpdate: boolean, reason: string }}
 */
function deriveRollbackPlan({ currentSha, targetBranch, toSha }) {
  if (currentSha === toSha) {
    return {
      needsUpdate: false,
      reason: `${targetBranch} already points to ${toSha}; nothing to roll back.`,
    };
  }

  return {
    needsUpdate: true,
    reason: `Force-resetting ${targetBranch} from ${currentSha} to ${toSha}.`,
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
 * Main entry point.
 */
function main() {
  const options = parseArgs(process.argv.slice(2));

  // Resolves short SHAs and fails fast when the commit is not in this repo.
  const commit = runGhJson(['api', `repos/${options.repo}/commits/${options.toSha}`]);
  const toSha = commit.sha;
  const branch = runGhJson(['api', `repos/${options.repo}/branches/${options.targetBranch}`]);
  const currentSha = branch.commit.sha;
  const plan = deriveRollbackPlan({
    currentSha,
    targetBranch: options.targetBranch,
    toSha,
  });

  appendOutput(options.outputFile, 'dry_run', options.dryRun);
  appendOutput(options.outputFile, 'target_sha_before', currentSha);
  appendOutput(options.outputFile, 'rollback_to_sha', toSha);

  const summaryHeader = [
    '## Rollback Production',
    '',
    `- Target branch: ${options.targetBranch}`,
    `- Current SHA: ${currentSha}`,
    `- Rollback SHA: ${toSha}`,
    `- Reason: ${options.reason}`,
    `- Dry run: ${options.dryRun}`,
  ];

  if (!plan.needsUpdate) {
    appendOutput(options.outputFile, 'rolled_back', false);
    appendSummary(options.summaryFile, summaryHeader.concat([`- ${plan.reason}`]));
    console.log(plan.reason);
    return;
  }

  if (options.dryRun) {
    appendOutput(options.outputFile, 'rolled_back', false);
    appendSummary(options.summaryFile, summaryHeader.concat([
      '- DRY RUN: the production ref was NOT moved. Re-run with dry_run=false to execute.',
    ]));
    console.log(`DRY RUN: would execute — ${plan.reason}`);
    return;
  }

  runGh([
    'api',
    '--method',
    'PATCH',
    `repos/${options.repo}/git/refs/heads/${options.targetBranch}`,
    '-f',
    `sha=${toSha}`,
    '-F',
    'force=true',
  ]);

  const afterSha = runGhJson(
    ['api', `repos/${options.repo}/branches/${options.targetBranch}`],
  ).commit.sha;

  if (afterSha !== toSha) {
    throw new Error(
      `Rollback verification failed: expected ${options.targetBranch} at ${toSha}, found ${afterSha}.`,
    );
  }

  const deployment = runGhJsonWithBody(
    ['api', '--method', 'POST', `repos/${options.repo}/deployments`],
    {
      ref: toSha,
      environment: 'production',
      auto_merge: false,
      required_contexts: [],
      description: `Rollback: ${options.reason}`.slice(0, 140),
      payload: {
        reason: options.reason,
        rollback: true,
        rolled_back_from: currentSha,
      },
    },
  );

  appendOutput(options.outputFile, 'rolled_back', true);
  appendOutput(options.outputFile, 'deployment_id', deployment.id);
  appendSummary(options.summaryFile, summaryHeader.concat([
    `- Production ref moved: ${currentSha} → ${toSha}`,
    `- Rollback deployment: ${deployment.id}`,
    '- Render redeploys the rollback commit from the production push; post-deploy verification will set the final deployment status.',
  ]));
  console.log(`Rolled back ${options.targetBranch} to ${toSha} (deployment ${deployment.id}).`);
}

if (require.main === module) {
  main();
}

module.exports = {
  deriveRollbackPlan,
  parseArgs,
};
