const {
  aggregateArtifacts,
  formatBytes,
  formatReport,
} = require('../../../../scripts/github/report-actions-storage');
const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

describe('Unit | Scripts | GitHub | Advisory Observability Workflows', () => {
  describe('perf-smoke workflow', () => {
    const workflow = loadWorkflow('perf-smoke.yml');
    const job = getJob(workflow, 'perf-smoke');

    it('runs monthly or manually, read-only, warning-only', () => {
      assertDeepEqualInvariant(
        'Perf smoke triggers on schedule and manual dispatch only',
        workflow.on,
        {
          workflow_dispatch: null,
          schedule: [{ cron: '23 6 1 * *' }],
        },
      );
      assertDeepEqualInvariant(
        'Perf smoke keeps read-only permissions',
        workflow.permissions,
        { contents: 'read' },
      );
      assertEqualInvariant('Perf smoke declares a timeout', job['timeout-minutes'], 15);

      const runStep = findStepByName(job, 'perf-smoke', 'Run warning-only perf smoke');

      assertStringContainsInvariant(
        'Perf smoke runs the warning-only package script',
        runStep.run,
        'npm run perf:smoke',
      );
      assertStringContainsInvariant(
        'Perf smoke publishes its output to the step summary',
        runStep.run,
        'tee -a "$GITHUB_STEP_SUMMARY"',
      );
    });
  });

  describe('actions storage report workflow', () => {
    const workflow = loadWorkflow('actions-storage-report.yml');
    const job = getJob(workflow, 'storage-report');

    it('runs monthly or manually with actions read access only', () => {
      assertDeepEqualInvariant(
        'Storage report triggers on schedule and manual dispatch only',
        workflow.on,
        {
          workflow_dispatch: null,
          schedule: [{ cron: '47 6 1 * *' }],
        },
      );
      assertDeepEqualInvariant(
        'Storage report permissions stay read-only',
        workflow.permissions,
        { contents: 'read', actions: 'read' },
      );
      assertEqualInvariant('Storage report declares a timeout', job['timeout-minutes'], 10);

      const reportStep = findStepByName(job, 'storage-report', 'Report cache and artifact usage');

      assertStringContainsInvariant(
        'Storage report runs the repository script',
        reportStep.run,
        'node scripts/github/report-actions-storage.js',
      );
      assertEqualInvariant(
        'Storage report uses the ephemeral workflow token',
        reportStep.env.GH_TOKEN,
        '${{ github.token }}',
      );
    });
  });

  describe('report-actions-storage script', () => {
    it('aggregates non-expired artifacts by name sorted by size', () => {
      expect(aggregateArtifacts([
        { name: 'allure-report', size_in_bytes: 100 },
        { name: 'allure-report', size_in_bytes: 300 },
        { name: 'jest-results-node-24', size_in_bytes: 50 },
        { name: 'expired-thing', size_in_bytes: 999, expired: true },
      ])).toEqual([
        { count: 2, name: 'allure-report', totalBytes: 400 },
        { count: 1, name: 'jest-results-node-24', totalBytes: 50 },
      ]);
    });

    it('formats byte sizes for humans', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(512)).toBe('512 B');
      expect(formatBytes(2048)).toBe('2.0 KiB');
      expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MiB');
    });

    it('renders a markdown report with cache and artifact tables', () => {
      const report = formatReport({
        cacheUsage: { active_caches_count: 3, active_caches_size_in_bytes: 2048 },
        groups: [{ count: 2, name: 'allure-report', totalBytes: 400 }],
        totalArtifacts: 2,
      });

      expect(report).toContain('## Actions storage report (advisory)');
      expect(report).toContain('Active caches: 3 (2.0 KiB)');
      expect(report).toContain('| allure-report | 2 | 400 B |');
    });
  });
});
