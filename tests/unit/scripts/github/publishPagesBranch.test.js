const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  parseArgs,
  publishPagesBranch,
} = require('../../../../scripts/github/publish-pages-branch');

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
  const tempDir = await createTempDir('publish-pages-branch-');
  const remoteDir = path.join(tempDir, 'remote.git');
  const repoDir = path.join(tempDir, 'repo');
  const siteDir = path.join(tempDir, 'site');

  runGit(tempDir, ['init', '--bare', remoteDir]);
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

describe('Unit | Scripts | GitHub | Publish Pages Branch', () => {
  it('parses supported CLI arguments', () => {
    expect(parseArgs([
      '--site-dir',
      'reports/pages-site',
      '--branch',
      'gh-pages',
      '--commit-message',
      'docs: publish report',
      '--output-file',
      '/tmp/output.txt',
      '--repo-dir',
      '/tmp/repo',
    ])).toEqual({
      branch: 'gh-pages',
      commitMessage: 'docs: publish report',
      outputFile: '/tmp/output.txt',
      repoDir: '/tmp/repo',
      siteDir: path.join(process.cwd(), 'reports/pages-site'),
    });
  });

  it('rejects missing required arguments', () => {
    expect(() => parseArgs([
      '--commit-message',
      'docs: publish report',
    ])).toThrow('--site-dir is required');

    expect(() => parseArgs([
      '--site-dir',
      'reports/pages-site',
    ])).toThrow('--commit-message is required');
  });

  it('creates and updates the published branch', async () => {
    const {
      repoDir,
      rootDir,
      siteDir,
    } = await createRemoteRepo();

    try {
      await writeFile(path.join(siteDir, 'index.html'), 'first-report');
      await writeFile(path.join(siteDir, '.nojekyll'), '');

      const firstPublish = await publishPagesBranch({
        branch: 'gh-pages',
        commitMessage: 'docs: publish first report',
        repoDir,
        siteDir,
      });

      expect(firstPublish.changed).toBe(true);
      expect(firstPublish.commitSha).toMatch(/^[a-f0-9]{40}$/u);

      const publishedCloneDir = path.join(rootDir, 'published');
      runGit(rootDir, ['clone', '--branch', 'gh-pages', path.join(rootDir, 'remote.git'), publishedCloneDir]);
      await expect(fs.readFile(path.join(publishedCloneDir, 'index.html'), 'utf8')).resolves.toBe('first-report');

      const secondPublish = await publishPagesBranch({
        branch: 'gh-pages',
        commitMessage: 'docs: publish first report',
        repoDir,
        siteDir,
      });

      expect(secondPublish).toEqual({
        branch: 'gh-pages',
        changed: false,
        commitSha: '',
      });

      await writeFile(path.join(siteDir, 'index.html'), 'second-report');

      const thirdPublish = await publishPagesBranch({
        branch: 'gh-pages',
        commitMessage: 'docs: publish second report',
        repoDir,
        siteDir,
      });

      expect(thirdPublish.changed).toBe(true);

      runGit(publishedCloneDir, ['pull', '--ff-only']);
      await expect(fs.readFile(path.join(publishedCloneDir, 'index.html'), 'utf8')).resolves.toBe('second-report');
    } finally {
      await fs.rm(rootDir, {
        force: true,
        recursive: true,
      });
    }
  });
});
