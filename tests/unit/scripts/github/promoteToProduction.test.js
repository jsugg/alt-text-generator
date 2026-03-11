const {
  derivePromotionPlan,
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
        '--output-file',
        '/tmp/output.txt',
        '--summary-file',
        '/tmp/summary.md',
      ])).toEqual({
        repo: 'jsugg/alt-text-generator',
        sourceBranch: 'main',
        targetBranch: 'production',
        requiredChecks: ['actionlint', 'lint', 'newman'],
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

  describe('derivePromotionPlan', () => {
    it('returns no-op when both branches already share the same tip SHA', () => {
      expect(derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceTreeSha: 'tree-1',
        sourceAheadBy: 0,
        targetAheadBy: 0,
        targetBranch: 'production',
        targetSha: 'abc123',
        targetTreeSha: 'tree-1',
      })).toEqual({
        force: false,
        mode: 'already-aligned',
        needsUpdate: false,
        reason: 'production already points to main@abc123.',
      });
    });

    it('uses a fast-forward update when target has no unique commits', () => {
      expect(derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceTreeSha: 'tree-2',
        sourceAheadBy: 2,
        targetAheadBy: 0,
        targetBranch: 'production',
        targetSha: 'def456',
        targetTreeSha: 'tree-1',
      })).toEqual({
        force: false,
        mode: 'fast-forward',
        needsUpdate: true,
        reason: 'Advancing production to main@abc123.',
      });
    });

    it('uses a force realignment when only branch-only history differs', () => {
      expect(derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceTreeSha: 'tree-1',
        sourceAheadBy: 0,
        targetAheadBy: 4,
        targetBranch: 'production',
        targetSha: 'def456',
        targetTreeSha: 'tree-1',
      })).toEqual({
        force: true,
        mode: 'history-realignment',
        needsUpdate: true,
        reason: 'production only differs by branch-only history. Resetting it to main@abc123 keeps both branches on the exact same commit.',
      });
    });

    it('fails when target has unique content not present in source', () => {
      expect(() => derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceTreeSha: 'tree-1',
        sourceAheadBy: 0,
        targetAheadBy: 1,
        targetBranch: 'production',
        targetSha: 'def456',
        targetTreeSha: 'tree-2',
      })).toThrow(
        'production contains commits that are not present in main and its tree differs from main. Merge those changes back into main before promoting.',
      );
    });
  });
});
