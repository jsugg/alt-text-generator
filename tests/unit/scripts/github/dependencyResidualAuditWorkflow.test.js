const {
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

const COMPARE_STEP = 'Compare the full dependency tree against the approved manifest';
const COMPARE_COMMAND = 'node scripts/security/residual-advisories.js --check-audit '
  + '--audit-file reports/security/npm-audit.json --fail-on high '
  + '| tee reports/security/residual.log';

/** @param {any} step */
const normalizeRun = (step) => step.run.replace(/\s+/gu, ' ').trim();

describe('Unit | Scripts | GitHub | Dependency Residual Audit Workflow', () => {
  const workflow = loadWorkflow('dependency-residual-audit.yml');
  const job = getJob(workflow, 'residual-advisories');
  const securityAudit = loadWorkflow('security-audit.yml');
  const ciDependencyAudit = getJob(loadWorkflow('ci.yml'), 'dependency-audit');

  it('runs on its own weekly schedule and manual dispatch, separate from Security Audit', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency.group).toContain('dependency-residual-audit');
    expect(workflow.concurrency.group).not.toBe(securityAudit.concurrency.group);
    expect(Object.keys(securityAudit.jobs)).toEqual(['npm-audit']);
  });

  it('reuses the bounded-retry full-tree audit instead of a second npm audit', () => {
    const auditStep = findStepByName(job, 'residual-advisories', 'Run full dependency audit');

    expect(auditStep.run).toBe('bash scripts/github/run-security-audit.sh');
    expect(auditStep.env).toEqual({ AUDIT_SCOPE: 'full' });
    expect(findStepByName(job, 'residual-advisories', 'Fail when the registry audit is unavailable').if)
      .toBe("steps.audit.outputs.available != 'true'");
  });

  it.each([
    ['the scheduled workflow', job, 'residual-advisories'],
    ['the pull-request dependency-audit job', ciDependencyAudit, 'dependency-audit'],
  ])('fails on the residual policy in %s, never swallowing it', (_label, target, jobId) => {
    const compare = findStepByName(target, jobId, COMPARE_STEP);

    expect(normalizeRun(compare)).toBe(COMPARE_COMMAND);
    expect(compare.shell).toBe('bash');
    expect(compare.if).toBeUndefined();
    expect(compare['continue-on-error']).toBeUndefined();
    target.steps.forEach((step) => {
      expect(String(step.run ?? '')).not.toContain('::warning::');
    });
  });

  it('summarizes the comparison even when it fails', () => {
    [[job, 'Write summary'], [ciDependencyAudit, 'Write residual summary']].forEach(([target, name]) => {
      const summary = target.steps.find((step) => step.name === name);

      expect(summary.if).toBe('always()');
      expect(summary.run).toContain('GITHUB_STEP_SUMMARY');
    });
  });

  it('no longer fails pull requests on raw severity counts that ignore the manifest', () => {
    expect(ciDependencyAudit.steps.map((step) => step.name))
      .not.toContain('Fail on high or critical findings');
  });
});
