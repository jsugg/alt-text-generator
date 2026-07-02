const { deriveRollbackPlan, parseArgs } = require('../../../../scripts/github/rollback-production');

describe('Unit | Scripts | GitHub | Rollback Production', () => {
  describe('parseArgs', () => {
    it('parses supported arguments with dry-run defaulting to true', () => {
      expect(parseArgs([
        '--repo', 'jsugg/alt-text-generator',
        '--to-sha', 'abc123',
        '--reason', 'deploy regression',
      ])).toEqual({
        repo: 'jsugg/alt-text-generator',
        targetBranch: 'production',
        toSha: 'abc123',
        reason: 'deploy regression',
        dryRun: true,
        outputFile: null,
        summaryFile: null,
      });
    });

    it('parses an explicit real run', () => {
      expect(parseArgs([
        '--repo', 'jsugg/alt-text-generator',
        '--to-sha', 'abc123',
        '--reason', 'deploy regression',
        '--dry-run', 'false',
      ]).dryRun).toBe(false);
    });

    it('rejects non-boolean dry-run values', () => {
      expect(() => parseArgs([
        '--repo', 'r/r', '--to-sha', 'a', '--reason', 'x', '--dry-run', 'yes',
      ])).toThrow('--dry-run must be "true" or "false"');
    });

    it('requires repo, to-sha, and reason', () => {
      expect(() => parseArgs(['--repo', 'r/r'])).toThrow(
        '--repo, --to-sha, and --reason are required',
      );
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs(['--force', 'true'])).toThrow('Unsupported argument: --force');
    });
  });

  describe('deriveRollbackPlan', () => {
    it('is a no-op when production already points to the rollback SHA', () => {
      expect(deriveRollbackPlan({
        currentSha: 'abc123',
        targetBranch: 'production',
        toSha: 'abc123',
      })).toEqual({
        needsUpdate: false,
        reason: 'production already points to abc123; nothing to roll back.',
      });
    });

    it('plans a force reset when the SHAs differ', () => {
      expect(deriveRollbackPlan({
        currentSha: 'def456',
        targetBranch: 'production',
        toSha: 'abc123',
      })).toEqual({
        needsUpdate: true,
        reason: 'Force-resetting production from def456 to abc123.',
      });
    });
  });
});
