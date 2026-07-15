const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  listMarkdownFiles,
  parseArgs,
  validateDocs,
  validateMarkdownFile,
} = require('../../../../scripts/docs/validate-docs');

// The gate enumerates git-tracked files, so a fixture has to be a real
// repository — writing a file to disk is no longer enough to make it visible.
// That is the property under test, not an inconvenience of the harness.
const createTempDocsRepo = () => {
  const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-validate-')));

  execFileSync('git', ['-C', rootDir, 'init', '--quiet']);
  execFileSync('git', ['-C', rootDir, 'config', 'user.email', 'docs-gate@example.test']);
  execFileSync('git', ['-C', rootDir, 'config', 'user.name', 'Docs Gate']);

  return rootDir;
};

/**
 * @param {string} rootDir
 * @param {string} relativePath
 * @param {string} contents
 * @param {{ track?: boolean }} [options]
 */
const writeDoc = (rootDir, relativePath, contents, { track = true } = {}) => {
  const filePath = path.join(rootDir, relativePath);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);

  if (track) {
    execFileSync('git', ['-C', rootDir, 'add', '--', relativePath]);
  }

  return filePath;
};

const relativeTo = (rootDir) => (filePath) => path.relative(rootDir, filePath);

describe('Unit | Scripts | Docs | Validate Docs', () => {
  it('lists the Markdown files git tracks', () => {
    const rootDir = createTempDocsRepo();

    try {
      writeDoc(rootDir, 'README.md', '# Readme\n');
      writeDoc(rootDir, 'docs/guide.md', '# Guide\n');

      expect(listMarkdownFiles(rootDir).map(relativeTo(rootDir)))
        .toEqual(['docs/guide.md', 'README.md']);
    } finally {
      fs.rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it('ignores Markdown that is present on disk but untracked', () => {
    const rootDir = createTempDocsRepo();

    try {
      writeDoc(rootDir, 'README.md', '# Readme\n');
      writeDoc(rootDir, '.local/scratch.md', '# Scratch note\n', { track: false });
      writeDoc(rootDir, 'node_modules/pkg/README.md', '# Package\n', { track: false });

      expect(listMarkdownFiles(rootDir).map(relativeTo(rootDir))).toEqual(['README.md']);
    } finally {
      fs.rmSync(rootDir, { force: true, recursive: true });
    }
  });

  // The concrete local failure this replaces: a scratch note saved with CRLF
  // failed docs:validate on the developer's machine while CI passed, because CI
  // never had the file. The gate must not see it at all.
  it('does not fail on violations in untracked local notes', () => {
    const rootDir = createTempDocsRepo();

    try {
      writeDoc(rootDir, 'README.md', '# Readme\n');
      writeDoc(rootDir, '.local/notes.md', '# Notes\r\n<<<<<<< HEAD\r\n', { track: false });

      expect(validateDocs({ rootDir })).toEqual({
        files: ['README.md'],
        violations: [],
      });
    } finally {
      fs.rmSync(rootDir, { force: true, recursive: true });
    }
  });

  it('accepts non-empty LF Markdown without merge-conflict markers', () => {
    const rootDir = createTempDocsRepo();

    try {
      const docsPath = writeDoc(rootDir, 'README.md', '# Valid\n\nContent.\n');

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
    const rootDir = createTempDocsRepo();

    try {
      writeDoc(rootDir, 'empty.md', '  \n');
      writeDoc(rootDir, 'conflict.md', '# Title\r\n<<<<<<< HEAD\r\n');

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
