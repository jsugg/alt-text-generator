const path = require('node:path');

const { parseArgs } = require('../../../../scripts/github/sync-pages-state-branch');

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
});
