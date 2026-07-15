const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkEnvVarCoverage,
  checkImageAlt,
  checkProhibitedReferences,
  collectAnchors,
  listMarkdownFiles,
  parseArgs,
  slugifyHeading,
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

  describe('image alt text', () => {
    it('accepts an img with descriptive alt, and an explicit empty alt', () => {
      expect(checkImageAlt('<img src="a.png" alt="A bar chart">\n', 'x.md')).toEqual([]);
      expect(checkImageAlt('<img src="banner.png" alt="">\n', 'x.md')).toEqual([]);
    });

    it('accepts Markdown image syntax, which always carries the alt slot', () => {
      expect(checkImageAlt('![A bar chart](a.png)\n', 'x.md')).toEqual([]);
      expect(checkImageAlt('![](banner.png)\n', 'x.md')).toEqual([]);
    });

    it('rejects a raw img with no alt attribute', () => {
      expect(checkImageAlt('<div>\n<img src="banner.png" width="1000">\n</div>\n', 'x.md'))
        .toEqual([{
          file: 'x.md',
          line: 2,
          message: 'Image must have an alt attribute (use alt="" if decorative)',
        }]);
    });

    it('ignores an img inside a fenced code block', () => {
      expect(checkImageAlt('```html\n<img src="a.png">\n```\n', 'x.md')).toEqual([]);
    });
  });

  describe('prohibited references', () => {
    it('accepts prose naming a gitignored runtime path', () => {
      // certs/ is gitignored on purpose, and documenting that the app looks
      // there is correct. Only internal working notes are prohibited.
      const content = 'the app tries `certs/localhost-key.pem` and certs/localhost.pem\n';

      expect(checkProhibitedReferences(content, 'x.md')).toEqual([]);
    });

    it.each([
      ['see .local/docs-audit.md for detail', '.local/'],
      ['tracked in docs/typecheck-debt.md', 'docs/typecheck-debt.md'],
      ['see jobs.md', 'jobs.md'],
    ])('rejects a reference to an internal working note (%s)', (line, label) => {
      expect(checkProhibitedReferences(`${line}\n`, 'x.md')).toEqual([{
        file: 'x.md',
        line: 1,
        message: `Documentation must not reference internal working notes (${label})`,
      }]);
    });
  });

  describe('internal links and anchors', () => {
    it('accepts links to tracked files and existing headings', () => {
      const rootDir = createTempDocsRepo();

      try {
        writeDoc(rootDir, 'docs/guide.md', '# Guide\n\n## Deep Section: HTTPS-first\n');
        writeDoc(
          rootDir,
          'README.md',
          [
            '# Readme',
            '',
            '## Local Heading',
            '',
            'See [the guide](docs/guide.md).',
            'See [a section](docs/guide.md#deep-section-https-first).',
            'See [local](#local-heading).',
            'See [external](https://example.com/x).',
            '',
          ].join('\n'),
        );

        expect(validateDocs({ rootDir }).violations).toEqual([]);
      } finally {
        fs.rmSync(rootDir, { force: true, recursive: true });
      }
    });

    it('rejects a link to a path git does not track', () => {
      const rootDir = createTempDocsRepo();

      try {
        writeDoc(rootDir, 'notes.md', '# Notes\n', { track: false });
        writeDoc(rootDir, 'README.md', '# Readme\n\nSee [notes](notes.md).\n');

        expect(validateDocs({ rootDir }).violations).toEqual([{
          file: 'README.md',
          line: 3,
          message: 'Link points at a path git does not track: notes.md',
        }]);
      } finally {
        fs.rmSync(rootDir, { force: true, recursive: true });
      }
    });

    it('rejects a link to a heading that does not exist', () => {
      const rootDir = createTempDocsRepo();

      try {
        writeDoc(rootDir, 'README.md', '# Readme\n\nSee [gone](#no-such-heading).\n');

        expect(validateDocs({ rootDir }).violations).toEqual([{
          file: 'README.md',
          line: 3,
          message: 'Link points at a heading that does not exist: #no-such-heading',
        }]);
      } finally {
        fs.rmSync(rootDir, { force: true, recursive: true });
      }
    });
  });

  describe('heading slugs', () => {
    it('matches how GitHub slugifies punctuation and spacing', () => {
      expect(slugifyHeading('Inbound TLS posture: HTTPS-first vs. edge termination'))
        .toBe('inbound-tls-posture-https-first-vs-edge-termination');
      expect(slugifyHeading('Quick Start (Dev)')).toBe('quick-start-dev');
    });

    it('disambiguates repeated headings the way GitHub does', () => {
      expect([...collectAnchors('## Notes\n\n## Notes\n\n## Notes\n')])
        .toEqual(['notes', 'notes-1', 'notes-2']);
    });
  });

  describe('env var coverage', () => {
    const seedConfig = (rootDir, body) => {
      writeDoc(rootDir, 'config/index.js', body);
    };

    it('accepts a variable documented in both surfaces', () => {
      const rootDir = createTempDocsRepo();

      try {
        seedConfig(rootDir, 'module.exports = { a: process.env.SOME_SETTING };\n');
        writeDoc(rootDir, 'DEVELOPMENT.md', '# Dev\n\n| `SOME_SETTING` | No | unset | Does a thing. |\n');
        writeDoc(rootDir, '.env.example', '# SOME_SETTING=1\n');

        expect(checkEnvVarCoverage(rootDir)).toEqual([]);
      } finally {
        fs.rmSync(rootDir, { force: true, recursive: true });
      }
    });

    it('rejects a variable missing from each surface independently', () => {
      const rootDir = createTempDocsRepo();

      try {
        seedConfig(rootDir, 'module.exports = { a: process.env.SECRET_BYPASS };\n');
        writeDoc(rootDir, 'DEVELOPMENT.md', '# Dev\n\nNothing here.\n');
        writeDoc(rootDir, '.env.example', '# UNRELATED=1\n');

        expect(checkEnvVarCoverage(rootDir)).toEqual([
          {
            file: 'DEVELOPMENT.md',
            line: 1,
            message: 'SECRET_BYPASS is read by config/index.js but is undocumented in the configuration reference',
          },
          {
            file: '.env.example',
            line: 1,
            message: 'SECRET_BYPASS is read by config/index.js but is undocumented in the environment template',
          },
        ]);
      } finally {
        fs.rmSync(rootDir, { force: true, recursive: true });
      }
    });

    it('does not sweep in Jest lane config, whose env is not app configuration', () => {
      const rootDir = createTempDocsRepo();

      try {
        writeDoc(rootDir, 'config/jest/jest.base.cjs', 'const d = process.env.ALLURE_RESULTS_DIR;\n');
        writeDoc(rootDir, 'config/index.js', 'module.exports = {};\n');
        writeDoc(rootDir, 'DEVELOPMENT.md', '# Dev\n');
        writeDoc(rootDir, '.env.example', '# nothing\n');

        expect(checkEnvVarCoverage(rootDir)).toEqual([]);
      } finally {
        fs.rmSync(rootDir, { force: true, recursive: true });
      }
    });
  });
});
