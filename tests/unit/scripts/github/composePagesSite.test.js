const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  composePagesSite,
  listPublishedPrDirectories,
  normalizePublishPath,
  parseArgs,
} = require('../../../../scripts/github/compose-pages-site');

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'compose-pages-site-'));
}

async function writeFile(targetPath, contents) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf8');
}

describe('Unit | Scripts | GitHub | Compose Pages Site', () => {
  it('parses supported CLI arguments', () => {
    expect(parseArgs([
      '--existing-site-dir',
      'reports/pages-site',
      '--output-dir',
      'reports/pages-next',
      '--publish-path',
      '/pr/123/',
      '--report-dir',
      'reports/allure-report',
    ])).toEqual({
      existingSiteDir: path.join(process.cwd(), 'reports/pages-site'),
      outputDir: path.join(process.cwd(), 'reports/pages-next'),
      publishPath: '/pr/123/',
      reportDir: path.join(process.cwd(), 'reports/allure-report'),
    });
  });

  it('rejects missing required CLI arguments', () => {
    expect(() => parseArgs([
      '--output-dir',
      'reports/pages-next',
      '--report-dir',
      'reports/allure-report',
    ])).toThrow('Missing required argument: --existing-site-dir <path>');

    expect(() => parseArgs([
      '--existing-site-dir',
      'reports/pages-site',
      '--report-dir',
      'reports/allure-report',
    ])).toThrow('Missing required argument: --output-dir <path>');

    expect(() => parseArgs([
      '--existing-site-dir',
      'reports/pages-site',
      '--output-dir',
      'reports/pages-next',
    ])).toThrow('Missing required argument: --report-dir <path>');
  });

  it('normalizes safe publish paths and rejects traversal', () => {
    expect(normalizePublishPath('/pr/123/')).toBe('pr/123');
    expect(normalizePublishPath('')).toBe('');
    expect(() => normalizePublishPath('../danger')).toThrow('Invalid publish path');
    expect(() => normalizePublishPath('/pr/../danger')).toThrow('Invalid publish path');
  });

  it('publishes the main report at the site root', async () => {
    const tempDir = await createTempDir();
    const existingSiteDir = path.join(tempDir, 'existing');
    const outputDir = path.join(tempDir, 'output');
    const reportDir = path.join(tempDir, 'report');

    await writeFile(path.join(existingSiteDir, 'index.html'), 'old-main');
    await writeFile(path.join(existingSiteDir, 'history', 'old.json'), '{"history":true}');
    await writeFile(path.join(reportDir, 'index.html'), 'new-main');
    await writeFile(path.join(reportDir, 'data', 'widgets.json'), '{"widgets":true}');

    const result = await composePagesSite({
      existingSiteDir,
      outputDir,
      publishPath: '',
      reportDir,
    });

    await expect(fs.readFile(path.join(outputDir, 'index.html'), 'utf8')).resolves.toBe('new-main');
    await expect(fs.readFile(path.join(outputDir, 'data', 'widgets.json'), 'utf8')).resolves.toBe('{"widgets":true}');
    await expect(fs.readFile(path.join(outputDir, '.nojekyll'), 'utf8')).resolves.toBe('');
    expect(result.publishPath).toBe('');
    expect(result.targetDir).toBe(outputDir);
  });

  it('publishes a PR report without overwriting the root report', async () => {
    const tempDir = await createTempDir();
    const existingSiteDir = path.join(tempDir, 'existing');
    const outputDir = path.join(tempDir, 'output');
    const reportDir = path.join(tempDir, 'report');

    await writeFile(path.join(existingSiteDir, 'index.html'), 'main-root');
    await writeFile(path.join(existingSiteDir, 'pr', '111', 'index.html'), 'old-pr');
    await writeFile(path.join(reportDir, 'index.html'), 'new-pr');
    await writeFile(path.join(reportDir, 'data', 'widgets.json'), '{"failed":true}');

    const result = await composePagesSite({
      existingSiteDir,
      outputDir,
      publishPath: 'pr/222',
      reportDir,
    });

    await expect(fs.readFile(path.join(outputDir, 'index.html'), 'utf8')).resolves.toBe('main-root');
    await expect(fs.readFile(path.join(outputDir, 'pr', '222', 'index.html'), 'utf8')).resolves.toBe('new-pr');
    await expect(fs.readFile(path.join(outputDir, 'pr', '222', 'data', 'widgets.json'), 'utf8')).resolves.toBe('{"failed":true}');
    await expect(fs.readFile(path.join(outputDir, 'pr', '111', 'index.html'), 'utf8')).resolves.toBe('old-pr');
    await expect(fs.readFile(path.join(outputDir, 'pr', 'index.html'), 'utf8')).resolves.toContain('PR #222');
    expect(result.publishPath).toBe('pr/222');
    expect(result.targetDir).toBe(path.join(outputDir, 'pr', '222'));
    await expect(listPublishedPrDirectories(outputDir)).resolves.toEqual(['222', '111']);
  });

  it('creates a fallback root index when publishing a PR report into an empty site', async () => {
    const tempDir = await createTempDir();
    const outputDir = path.join(tempDir, 'output');
    const reportDir = path.join(tempDir, 'report');

    await writeFile(path.join(reportDir, 'index.html'), 'pr-report');

    await composePagesSite({
      existingSiteDir: path.join(tempDir, 'missing'),
      outputDir,
      publishPath: 'pr/333',
      reportDir,
    });

    await expect(fs.readFile(path.join(outputDir, 'index.html'), 'utf8')).resolves.toContain('./pr/333/');
    await expect(fs.readFile(path.join(outputDir, 'pr', '333', 'index.html'), 'utf8')).resolves.toBe('pr-report');
  });

  it('removes the PR index when no PR reports remain in the composed site', async () => {
    const tempDir = await createTempDir();
    const existingSiteDir = path.join(tempDir, 'existing');
    const outputDir = path.join(tempDir, 'output');
    const reportDir = path.join(tempDir, 'report');

    await writeFile(path.join(existingSiteDir, 'index.html'), 'main-root');
    await writeFile(path.join(existingSiteDir, 'pr', 'index.html'), 'stale-index');
    await writeFile(path.join(reportDir, 'index.html'), 'main-report');

    await composePagesSite({
      existingSiteDir,
      outputDir,
      publishPath: '',
      reportDir,
    });

    await expect(fs.readFile(path.join(outputDir, 'index.html'), 'utf8')).resolves.toBe('main-report');
    await expect(fs.access(path.join(outputDir, 'pr', 'index.html'))).rejects.toThrow();
  });
});
