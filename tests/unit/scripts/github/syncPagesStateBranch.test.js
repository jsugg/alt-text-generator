const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  hasRemoteBranch,
  hasStagedChanges,
  parseArgs,
  syncPagesStateBranch,
  runGit: runGitCommand,
} = require('../../../../scripts/github/sync-pages-state-branch');

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  }).trim();
}

async function createTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFile(targetPath, contents) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf8');
}

async function createRemoteRepo() {
  const tempDir = await createTempDir('sync-pages-state-branch-');
  const remoteDir = path.join(tempDir, 'remote.git');
  const repoDir = path.join(tempDir, 'repo');
  const siteDir = path.join(tempDir, 'site');

  runGit(tempDir, ['-c', 'init.defaultBranch=main', 'init', '--bare', remoteDir]);
  runGit(tempDir, ['clone', remoteDir, repoDir]);
  runGit(repoDir, ['checkout', '-b', 'main']);
  await writeFile(path.join(repoDir, 'README.md'), '# repo\n');
  runGit(repoDir, ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'add', 'README.md']);
  runGit(repoDir, ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'init']);
  runGit(repoDir, ['push', '--set-upstream', 'origin', 'main']);

  return {
    repoDir,
    rootDir: tempDir,
    siteDir,
  };
}

describe('Unit | Scripts | GitHub | Sync Pages State Branch', () => {
  it('parses supported CLI arguments', () => {
    expect(parseArgs([
      '--site-dir',
      'reports/pages-site',
      '--branch',
      'gh-pages',
      '--commit-message',
      'docs: sync report',
      '--output-file',
      '/tmp/output.txt',
      '--repo-dir',
      '/tmp/repo',
    ])).toEqual({
      branch: 'gh-pages',
      commitMessage: 'docs: sync report',
      outputFile: '/tmp/output.txt',
      repoDir: '/tmp/repo',
      siteDir: path.join(process.cwd(), 'reports/pages-site'),
    });
  });

  it('rejects missing required arguments', () => {
    expect(() => parseArgs([
      '--commit-message',
      'docs: sync report',
    ])).toThrow('--site-dir is required');

    expect(() => parseArgs([
      '--site-dir',
      'reports/pages-site',
    ])).toThrow('--commit-message is required');
  });

  it('supports equals syntax and rejects malformed arguments', () => {
    expect(parseArgs([
      '--site-dir=reports/pages-site',
      '--commit-message=docs: sync report',
      '--branch=preview-pages',
    ])).toEqual({
      branch: 'preview-pages',
      commitMessage: 'docs: sync report',
      outputFile: null,
      repoDir: process.cwd(),
      siteDir: path.join(process.cwd(), 'reports/pages-site'),
    });

    expect(() => parseArgs([
      'reports/pages-site',
    ])).toThrow('Unexpected argument: reports/pages-site');

    expect(() => parseArgs([
      '--site-dir',
      'reports/pages-site',
      '--commit-message',
    ])).toThrow('Missing value for --commit-message');

    expect(() => parseArgs([
      '--site-dir',
      'reports/pages-site',
      '--commit-message',
      'docs: sync report',
      '--unsupported',
      'nope',
    ])).toThrow('Unsupported argument: --unsupported');
  });

  it('exposes git helpers for failure-tolerant checks', async () => {
    const {
      repoDir,
      rootDir,
    } = await createRemoteRepo();

    try {
      expect(hasRemoteBranch({
        branch: 'gh-pages',
        repoDir,
      })).toBe(false);

      expect(hasStagedChanges(repoDir)).toBe(false);
      await writeFile(path.join(repoDir, 'notes.txt'), 'draft');
      runGit(repoDir, ['add', 'notes.txt']);
      expect(hasStagedChanges(repoDir)).toBe(true);

      expect(() => runGitCommand({
        args: ['rev-parse', '--verify', 'refs/heads/does-not-exist'],
        cwd: repoDir,
      })).toThrow('git rev-parse --verify refs/heads/does-not-exist failed');

      const allowFailureResult = runGitCommand({
        allowFailure: true,
        args: ['rev-parse', '--verify', 'refs/heads/does-not-exist'],
        cwd: repoDir,
      });
      expect(allowFailureResult.status).not.toBe(0);
    } finally {
      await fs.rm(rootDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it('creates and updates the state branch', async () => {
    const {
      repoDir,
      rootDir,
      siteDir,
    } = await createRemoteRepo();

    try {
      await writeFile(path.join(siteDir, 'index.html'), 'first-report');
      await writeFile(path.join(siteDir, '.nojekyll'), '');

      const firstSync = await syncPagesStateBranch({
        branch: 'gh-pages',
        commitMessage: 'docs: sync first report',
        repoDir,
        siteDir,
      });

      expect(firstSync.changed).toBe(true);
      expect(firstSync.commitSha).toMatch(/^[a-f0-9]{40}$/u);
      expect(hasRemoteBranch({
        branch: 'gh-pages',
        repoDir,
      })).toBe(true);

      const publishedCloneDir = path.join(rootDir, 'published');
      runGit(rootDir, ['clone', '--branch', 'gh-pages', path.join(rootDir, 'remote.git'), publishedCloneDir]);
      await expect(fs.readFile(path.join(publishedCloneDir, 'index.html'), 'utf8')).resolves.toBe('first-report');

      const secondSync = await syncPagesStateBranch({
        branch: 'gh-pages',
        commitMessage: 'docs: sync first report',
        repoDir,
        siteDir,
      });

      expect(secondSync).toEqual({
        branch: 'gh-pages',
        changed: false,
        commitSha: '',
      });

      await writeFile(path.join(siteDir, 'index.html'), 'second-report');

      const thirdSync = await syncPagesStateBranch({
        branch: 'gh-pages',
        commitMessage: 'docs: sync second report',
        repoDir,
        siteDir,
      });

      expect(thirdSync.changed).toBe(true);

      runGit(publishedCloneDir, ['pull', '--ff-only']);
      await expect(fs.readFile(path.join(publishedCloneDir, 'index.html'), 'utf8')).resolves.toBe('second-report');
    } finally {
      await fs.rm(rootDir, {
        force: true,
        recursive: true,
      });
    }
  });

  it('writes GitHub Actions outputs when executed as a CLI', async () => {
    const {
      repoDir,
      rootDir,
      siteDir,
    } = await createRemoteRepo();

    try {
      const outputFile = path.join(rootDir, 'github-output.txt');
      await writeFile(path.join(siteDir, 'index.html'), 'cli-report');

      execFileSync('node', [
        path.join(process.cwd(), 'scripts/github/sync-pages-state-branch.js'),
        '--repo-dir',
        repoDir,
        '--site-dir',
        siteDir,
        '--commit-message',
        'docs: sync cli report',
        '--output-file',
        outputFile,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      await expect(fs.readFile(outputFile, 'utf8')).resolves.toMatch(
        /^branch=gh-pages\nchanged=true\ncommit_sha=[a-f0-9]{40}\n$/u,
      );
    } finally {
      await fs.rm(rootDir, {
        force: true,
        recursive: true,
      });
    }
  });
});
