const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  listMarkdownFiles,
  parseArgs,
  validateDocs,
  validateMarkdownFile,
} = require('../../../../scripts/docs/validate-docs');

const createTempDocsDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'docs-validate-'));

describe('Unit | Scripts | Docs | Validate Docs', () => {
  it('lists Markdown files while ignoring generated dependency/report directories', () => {
    const rootDir = createTempDocsDir();

    try {
      fs.mkdirSync(path.join(rootDir, 'docs'), { recursive: true });
      fs.mkdirSync(path.join(rootDir, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(rootDir, 'README.md'), '# Readme\n');
      fs.writeFileSync(path.join(rootDir, 'docs', 'guide.md'), '# Guide\n');
      fs.writeFileSync(path.join(rootDir, 'node_modules', 'pkg', 'README.md'), '# Package\n');

      expect(listMarkdownFiles(rootDir).map((filePath) => path.relative(rootDir, filePath)))
        .toEqual(['docs/guide.md', 'README.md']);
    } finally {
      fs.rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it('accepts non-empty LF Markdown without merge-conflict markers', () => {
    const rootDir = createTempDocsDir();
    const docsPath = path.join(rootDir, 'README.md');

    try {
      fs.writeFileSync(docsPath, '# Valid\n\nContent.\n');

      expect(validateMarkdownFile(docsPath, rootDir)).toEqual([]);
      expect(validateDocs({ rootDir })).toEqual({
        files: ['README.md'],
        violations: [],
      });
    } finally {
      fs.rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it('reports empty files, CRLF, and merge-conflict markers', () => {
    const rootDir = createTempDocsDir();
    const emptyPath = path.join(rootDir, 'empty.md');
    const conflictPath = path.join(rootDir, 'conflict.md');

    try {
      fs.writeFileSync(emptyPath, '  \n');
      fs.writeFileSync(conflictPath, '# Title\r\n<<<<<<< HEAD\r\n');

      expect(validateDocs({ rootDir }).violations).toEqual([
        {
          file: 'conflict.md',
          line: 1,
          message: 'Markdown file must use LF line endings',
        },
        {
          file: 'conflict.md',
          line: 2,
          message: 'Markdown file contains a merge-conflict marker',
        },
        {
          file: 'empty.md',
          line: 1,
          message: 'Markdown file must not be empty',
        },
      ]);
    } finally {
      fs.rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it('parses CLI arguments', () => {
    expect(parseArgs(['--json', '--root', 'docs'])).toEqual({
      json: true,
      rootDir: path.resolve('docs'),
    });
    expect(() => parseArgs(['--root'])).toThrow('--root requires a directory argument');
  });
});
