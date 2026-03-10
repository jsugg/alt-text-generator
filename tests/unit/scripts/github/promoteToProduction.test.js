const {
  ensureRequiredChecksGreen,
  parseArgs,
  resolveRequiredChecks,
} = require('../../../../scripts/github/promote-to-production');

describe('scripts/github/promote-to-production', () => {
  describe('parseArgs', () => {
    it('parses supported CLI arguments including required checks', () => {
      expect(parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--source-branch',
        'main',
        '--target-branch',
        'production',
        '--required-checks',
        'actionlint, lint, newman',
        '--auto-merge',
        'true',
        '--output-file',
        '/tmp/output.txt',
        '--summary-file',
        '/tmp/summary.md',
      ])).toEqual({
        repo: 'jsugg/alt-text-generator',
        sourceBranch: 'main',
        targetBranch: 'production',
        requiredChecks: ['actionlint', 'lint', 'newman'],
        autoMerge: true,
        outputFile: '/tmp/output.txt',
        summaryFile: '/tmp/summary.md',
      });
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--source-branch',
        'main',
        '--target-branch',
        'production',
        '--nope',
        'value',
      ])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('resolveRequiredChecks', () => {
    it('prefers explicitly provided required checks', () => {
      expect(resolveRequiredChecks({
        repo: 'jsugg/alt-text-generator',
        sourceBranch: 'main',
        requiredChecks: ['actionlint', 'lint'],
      })).toEqual(['actionlint', 'lint']);
    });
  });

  describe('ensureRequiredChecksGreen', () => {
    it('accepts successful required checks even when duplicate runs exist', () => {
      expect(() => ensureRequiredChecksGreen(
        'abc123',
        ['lint', 'newman'],
        [
          { name: 'lint', conclusion: 'failure' },
          { name: 'lint', conclusion: 'success' },
          { name: 'newman', conclusion: 'success' },
        ],
      )).not.toThrow();
    });

    it('throws when a required check is missing success', () => {
      expect(() => ensureRequiredChecksGreen(
        'abc123',
        ['lint', 'newman'],
        [
          { name: 'lint', conclusion: 'success' },
          { name: 'newman', conclusion: 'failure' },
        ],
      )).toThrow(
        'Source commit abc123 is missing successful required checks: newman',
      );
    });
  });
});
