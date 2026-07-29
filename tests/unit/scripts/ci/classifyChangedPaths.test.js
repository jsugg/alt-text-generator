const {
  classifyChangedPaths,
  isDependencyPath,
  isDocsPath,
  parseChangedFiles,
} = require('../../../../scripts/ci/classify-changed-paths');

describe('Unit | Scripts | CI | Classify Changed Paths', () => {
  describe('isDocsPath', () => {
    it.each([
      ['LICENSE'],
      ['README.md'],
      ['DEVELOPMENT.md'],
      ['docs/required-checks.md'],
      ['docs/postman-standards.md'],
      ['.github/assets/alt-text-generator.png'],
    ])('treats %s as documentation', (filePath) => {
      expect(isDocsPath(filePath)).toBe(true);
    });

    it.each([
      ['docs/openapi.base.json'],
      ['src/api/v1/routes/health.js'],
      ['package.json'],
      ['render.yaml'],
      ['.github/workflows/ci.yml'],
      ['config/index.js'],
      ['scripts/ci/classify-changed-paths.js'],
    ])('does not treat %s as documentation', (filePath) => {
      expect(isDocsPath(filePath)).toBe(false);
    });

    // The regression this module exists for: docs/ is not a blanket exemption,
    // but Markdown under docs/ is still documentation.
    it('classifies by extension rather than by the docs/ directory', () => {
      expect(isDocsPath('docs/openapi.base.json')).toBe(false);
      expect(isDocsPath('docs/coverage-thresholds.md')).toBe(true);
    });

    it('does not treat a LICENSE-suffixed path as the LICENSE file', () => {
      expect(isDocsPath('vendor/LICENSE')).toBe(false);
    });

    it('does not exempt .github paths outside assets/', () => {
      expect(isDocsPath('.github/workflows/codeql.yml')).toBe(false);
    });
  });

  describe('isDependencyPath', () => {
    it.each([
      ['.npmrc'],
      ['npm-shrinkwrap.json'],
      ['package-lock.json'],
      ['package.json'],
    ])('treats %s as dependency configuration', (filePath) => {
      expect(isDependencyPath(filePath)).toBe(true);
    });

    it.each([
      ['.github/dependabot.yml'],
      ['docs/dependency-security.md'],
      ['src/app.js'],
    ])('does not audit unrelated path %s', (filePath) => {
      expect(isDependencyPath(filePath)).toBe(false);
    });
  });

  describe('classifyChangedPaths', () => {
    it('runs the gates for a spec-only change', () => {
      expect(classifyChangedPaths(['docs/openapi.base.json'])).toEqual({
        dependenciesChanged: false,
        docsChanged: false,
        docsOnly: false,
      });
    });

    it('runs the gates when a spec change is bundled with documentation', () => {
      expect(classifyChangedPaths(['docs/openapi.base.json', 'README.md'])).toEqual({
        dependenciesChanged: false,
        docsChanged: true,
        docsOnly: false,
      });
    });

    it('runs the gates for a source-only change', () => {
      expect(classifyChangedPaths(['src/api/v1/routes/health.js'])).toEqual({
        dependenciesChanged: false,
        docsChanged: false,
        docsOnly: false,
      });
    });

    it('skips the gates for a genuinely docs-only change', () => {
      expect(classifyChangedPaths(['README.md', 'docs/required-checks.md', 'LICENSE'])).toEqual({
        dependenciesChanged: false,
        docsChanged: true,
        docsOnly: true,
      });
    });

    it('reports docs changed but not docs-only for a mixed change', () => {
      expect(classifyChangedPaths(['README.md', 'src/app.js'])).toEqual({
        dependenciesChanged: false,
        docsChanged: true,
        docsOnly: false,
      });
    });

    // No evidence of what changed must never mean "safe to skip".
    it('never reports docs-only for an empty change set', () => {
      expect(classifyChangedPaths([])).toEqual({
        dependenciesChanged: false,
        docsChanged: false,
        docsOnly: false,
      });
    });

    it('requests a production audit when an npm dependency file changes', () => {
      expect(classifyChangedPaths(['package-lock.json'])).toEqual({
        dependenciesChanged: true,
        docsChanged: false,
        docsOnly: false,
      });
    });
  });

  describe('parseChangedFiles', () => {
    it('trims entries and drops blank lines', () => {
      expect(parseChangedFiles('README.md\n\n  src/app.js  \n')).toEqual([
        'README.md',
        'src/app.js',
      ]);
    });

    it('returns an empty list for empty input', () => {
      expect(parseChangedFiles('')).toEqual([]);
    });
  });
});
