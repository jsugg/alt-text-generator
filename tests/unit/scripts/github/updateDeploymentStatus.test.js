const {
  buildStatusBody,
  parseArgs,
  pickLatestDeployment,
} = require('../../../../scripts/github/update-deployment-status');

describe('Unit | Scripts | GitHub | Update Deployment Status', () => {
  describe('parseArgs', () => {
    it('parses supported arguments', () => {
      expect(parseArgs([
        '--repo', 'jsugg/alt-text-generator',
        '--sha', 'abc123',
        '--state', 'success',
        '--environment-url', 'https://wcag.qcraft.com.br',
        '--log-url', 'https://github.com/run/1',
        '--output-file', '/tmp/out.txt',
      ])).toEqual({
        repo: 'jsugg/alt-text-generator',
        sha: 'abc123',
        state: 'success',
        environmentUrl: 'https://wcag.qcraft.com.br',
        logUrl: 'https://github.com/run/1',
        outputFile: '/tmp/out.txt',
      });
    });

    it('rejects invalid states', () => {
      expect(() => parseArgs([
        '--repo', 'r/r', '--sha', 'abc', '--state', 'in_progress',
      ])).toThrow('--state must be one of: success, failure');
    });

    it('requires repo, sha, and state', () => {
      expect(() => parseArgs(['--repo', 'r/r'])).toThrow(
        '--repo, --sha, and --state are required',
      );
    });
  });

  describe('pickLatestDeployment', () => {
    it('picks the newest deployment by creation time', () => {
      expect(pickLatestDeployment([
        { id: 1, created_at: '2026-07-01T00:00:00Z' },
        { id: 3, created_at: '2026-07-02T12:00:00Z' },
        { id: 2, created_at: '2026-07-02T00:00:00Z' },
      ])).toEqual({ id: 3, created_at: '2026-07-02T12:00:00Z' });
    });

    it('returns null for empty listings', () => {
      expect(pickLatestDeployment([])).toBeNull();
      expect(pickLatestDeployment(undefined)).toBeNull();
    });
  });

  describe('buildStatusBody', () => {
    it('marks successes with auto_inactive and URLs', () => {
      expect(buildStatusBody({
        state: 'success',
        environmentUrl: 'https://wcag.qcraft.com.br',
        logUrl: 'https://github.com/run/1',
      })).toEqual({
        state: 'success',
        description: 'Post-deploy Newman verification passed.',
        auto_inactive: true,
        environment_url: 'https://wcag.qcraft.com.br',
        log_url: 'https://github.com/run/1',
      });
    });

    it('keeps failed deployments active and omits absent URLs', () => {
      expect(buildStatusBody({
        state: 'failure',
        environmentUrl: null,
        logUrl: null,
      })).toEqual({
        state: 'failure',
        description: 'Post-deploy Newman verification failed.',
        auto_inactive: false,
      });
    });
  });
});
