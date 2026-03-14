const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { readPageMetadata, writePageMetadata } = require('../../../../scripts/github/page-metadata');
const { parseArgs: parseReadArgs, writeGitHubOutputs } = require('../../../../scripts/github/read-pages-metadata');
const { parseArgs: parseWriteArgs } = require('../../../../scripts/github/write-pages-metadata');

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'page-metadata-'));
}

describe('Unit | Scripts | GitHub | Page Metadata', () => {
  it('writes and reads page metadata', async () => {
    const tempDir = await createTempDir();
    const metadataPath = path.join(tempDir, 'metadata', 'page.json');

    writePageMetadata({
      metadataPath,
      pagePath: 'pr/149',
      pageUrl: 'https://jsugg.github.io/alt-text-generator/pr/149',
      reportKind: 'ci-pr',
    });

    expect(readPageMetadata(metadataPath)).toEqual({
      pagePath: 'pr/149',
      pageUrl: 'https://jsugg.github.io/alt-text-generator/pr/149',
      reportKind: 'ci-pr',
    });
  });

  it('parses write-pages-metadata CLI arguments', () => {
    expect(parseWriteArgs([
      '--metadata-path',
      'reports/pages-metadata/page-metadata.json',
      '--page-path',
      'pr/149',
      '--page-url',
      'https://jsugg.github.io/alt-text-generator/pr/149',
      '--report-kind',
      'ci-pr',
    ])).toEqual({
      metadataPath: 'reports/pages-metadata/page-metadata.json',
      pagePath: 'pr/149',
      pageUrl: 'https://jsugg.github.io/alt-text-generator/pr/149',
      reportKind: 'ci-pr',
    });
  });

  it('rejects invalid write-pages-metadata CLI arguments', () => {
    expect(() => parseWriteArgs([
      '--page-path',
      'pr/149',
    ])).toThrow('Missing required argument: --metadata-path <path>');

    expect(() => parseWriteArgs([
      '--metadata-path',
      'reports/pages-metadata/page-metadata.json',
      '--page-path',
      'pr/149',
      '--page-url',
      'https://jsugg.github.io/alt-text-generator/pr/149',
    ])).toThrow('Missing required argument: --report-kind <kind>');

    expect(() => parseWriteArgs([
      '--metadata-path',
      'reports/pages-metadata/page-metadata.json',
      '--page-path',
      'pr/149',
      '--page-url',
      'https://jsugg.github.io/alt-text-generator/pr/149',
      '--report-kind',
      'ci-pr',
      '--unsupported',
      'value',
    ])).toThrow('Unknown argument: --unsupported');
  });

  it('parses read-pages-metadata CLI arguments', () => {
    expect(parseReadArgs([
      '--metadata-path',
      'reports/pages-metadata/page-metadata.json',
      '--github-output',
      'reports/pages-metadata/github-output.txt',
    ])).toEqual({
      githubOutput: 'reports/pages-metadata/github-output.txt',
      metadataPath: 'reports/pages-metadata/page-metadata.json',
    });
  });

  it('rejects invalid read-pages-metadata CLI arguments', () => {
    expect(() => parseReadArgs([
      '--metadata-path',
      'reports/pages-metadata/page-metadata.json',
    ])).toThrow('Missing required argument: --github-output <path>');

    expect(() => parseReadArgs([
      '--github-output',
      'reports/pages-metadata/github-output.txt',
      '--unsupported',
      'value',
    ])).toThrow('Unknown argument: --unsupported');
  });

  it('writes page metadata fields to GitHub outputs', async () => {
    const tempDir = await createTempDir();
    const metadataPath = path.join(tempDir, 'metadata.json');
    const githubOutput = path.join(tempDir, 'github-output.txt');

    writePageMetadata({
      metadataPath,
      pagePath: '',
      pageUrl: 'https://jsugg.github.io/alt-text-generator',
      reportKind: 'ci-main',
    });

    writeGitHubOutputs({
      githubOutput,
      metadataPath,
    });

    await expect(fs.readFile(githubOutput, 'utf8')).resolves.toBe(
      'page_path=\npage_url=https://jsugg.github.io/alt-text-generator\nreport_kind=ci-main\n',
    );
  });
});
