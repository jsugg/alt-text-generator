#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

/**
 * @param {string[]} argv
 * @returns {{
 *   branch: string,
 *   commitMessage?: string,
 *   outputFile: string | null,
 *   repoDir: string,
 *   siteDir?: string,
 * }}
 */
function parseArgs(argv) {
  const args = {
    branch: 'gh-pages',
    outputFile: null,
    repoDir: process.cwd(),
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
      case 'branch':
        args.branch = rawValue;
        break;
      case 'commit-message':
        args.commitMessage = rawValue;
        break;
      case 'output-file':
        args.outputFile = rawValue;
        break;
      case 'repo-dir':
        args.repoDir = path.resolve(process.cwd(), rawValue);
        break;
      case 'site-dir':
        args.siteDir = path.resolve(process.cwd(), rawValue);
        break;
      default:
        throw new Error(`Unsupported argument: --${key}`);
    }
  }

  if (!args.siteDir) {
    throw new Error('--site-dir is required');
  }

  if (!args.commitMessage) {
    throw new Error('--commit-message is required');
  }

  return args;
}

/**
 * @param {string | null} outputFile
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function appendOutput(outputFile, key, value) {
  if (!outputFile) {
    return;
  }

  fs.appendFileSync(outputFile, `${key}=${value}\n`);
}

/**
 * @param {{
 *   args: string[],
 *   cwd: string,
 *   allowFailure?: boolean,
 *   env?: Record<string, string>,
 * }} options
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function runGit({
  args,
  cwd,
  allowFailure = false,
  env = {},
}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 && !allowFailure) {
    const details = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${details}`);
  }

  return result;
}

/**
 * @param {string} branch
 * @returns {string}
 */
function remoteBranchRef(branch) {
  return `refs/remotes/origin/${branch}`;
}

/**
 * @param {{
 *   branch: string,
 *   repoDir: string,
 * }} options
 * @returns {boolean}
 */
function hasRemoteBranch({
  branch,
  repoDir,
}) {
  return runGit({
    allowFailure: true,
    args: ['rev-parse', '--verify', remoteBranchRef(branch)],
    cwd: repoDir,
  }).status === 0;
}

/**
 * @param {{
 *   destinationDir: string,
 *   sourceDir: string,
 * }} options
 * @returns {Promise<void>}
 */
async function replaceDirectoryContents({
  destinationDir,
  sourceDir,
}) {
  const entries = await fsp.readdir(destinationDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (entry.name === '.git') {
      return;
    }

    await fsp.rm(path.join(destinationDir, entry.name), {
      force: true,
      recursive: true,
    });
  }));

  await fsp.cp(sourceDir, destinationDir, {
    force: true,
    recursive: true,
  });
}

/**
 * @param {string} cwd
 * @returns {boolean}
 */
function hasStagedChanges(cwd) {
  const result = runGit({
    allowFailure: true,
    args: ['diff', '--cached', '--quiet'],
    cwd,
  });

  if (result.status === 0) {
    return false;
  }

  if (result.status === 1) {
    return true;
  }

  const details = (result.stderr || result.stdout || `exit code ${result.status}`).trim();
  throw new Error(`Unable to determine staged Git changes in ${cwd}: ${details}`);
}

/**
 * @param {{
 *   actorEmail?: string,
 *   actorName?: string,
 *   branch: string,
 *   commitMessage: string,
 *   repoDir: string,
 *   siteDir: string,
 * }} options
 * @returns {Promise<{ branch: string, changed: boolean, commitSha: string }>}
 */
async function syncPagesStateBranch({
  actorEmail = '41898282+github-actions[bot]@users.noreply.github.com',
  actorName = 'github-actions[bot]',
  branch,
  commitMessage,
  repoDir,
  siteDir,
}) {
  const worktreeDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sync-pages-state-branch-'));
  const remoteBranchExists = hasRemoteBranch({
    branch,
    repoDir,
  });

  try {
    if (remoteBranchExists) {
      runGit({
        args: ['worktree', 'add', '--detach', worktreeDir, remoteBranchRef(branch)],
        cwd: repoDir,
      });
      runGit({
        args: ['checkout', '-B', branch, remoteBranchRef(branch)],
        cwd: worktreeDir,
      });
    } else {
      runGit({
        args: ['worktree', 'add', '--detach', worktreeDir],
        cwd: repoDir,
      });
      runGit({
        args: ['checkout', '--orphan', branch],
        cwd: worktreeDir,
      });
    }

    await replaceDirectoryContents({
      destinationDir: worktreeDir,
      sourceDir: siteDir,
    });

    runGit({
      args: ['add', '--all'],
      cwd: worktreeDir,
    });

    if (!hasStagedChanges(worktreeDir)) {
      return {
        branch,
        changed: false,
        commitSha: '',
      };
    }

    runGit({
      args: [
        '-c',
        `user.name=${actorName}`,
        '-c',
        `user.email=${actorEmail}`,
        'commit',
        '--message',
        commitMessage,
      ],
      cwd: worktreeDir,
    });

    runGit({
      args: ['push', 'origin', `HEAD:${branch}`],
      cwd: worktreeDir,
    });

    return {
      branch,
      changed: true,
      commitSha: runGit({
        args: ['rev-parse', 'HEAD'],
        cwd: worktreeDir,
      }).stdout.trim(),
    };
  } finally {
    runGit({
      allowFailure: true,
      args: ['worktree', 'remove', '--force', worktreeDir],
      cwd: repoDir,
    });
    await fsp.rm(worktreeDir, {
      force: true,
      recursive: true,
    });
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await syncPagesStateBranch(args);

  appendOutput(args.outputFile, 'branch', result.branch);
  appendOutput(args.outputFile, 'changed', result.changed ? 'true' : 'false');
  appendOutput(args.outputFile, 'commit_sha', result.commitSha);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  hasRemoteBranch,
  hasStagedChanges,
  parseArgs,
  runGit,
  syncPagesStateBranch,
};
