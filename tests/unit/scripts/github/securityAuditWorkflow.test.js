const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertStepUsesAction,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

describe('Unit | Scripts | GitHub | Security Audit Workflow', () => {
  const workflow = loadWorkflow('security-audit.yml');
  const job = getJob(workflow, 'npm-audit');

  it('runs weekly and on manual dispatch only', () => {
    assertDeepEqualInvariant(
      'Security audit triggers on schedule and workflow_dispatch only',
      workflow.on,
      {
        workflow_dispatch: null,
        schedule: [{ cron: '41 7 * * 1' }],
      },
    );
  });

  it('keeps least-privilege read-only permissions and a job timeout', () => {
    assertDeepEqualInvariant(
      'Security audit workflow keeps contents read-only permissions',
      workflow.permissions,
      { contents: 'read' },
    );
    assertEqualInvariant(
      'Security audit job declares a timeout',
      job['timeout-minutes'],
      15,
    );
  });

  it('audits production dependencies through the repository script', () => {
    const auditStep = findStepByName(job, 'npm-audit', 'Run production dependency audit');

    assertEqualInvariant(
      'Security audit runs the repository audit script',
      auditStep.run,
      'bash scripts/github/run-security-audit.sh',
    );
    assertEqualInvariant(
      'Security audit step exposes outputs under the audit id',
      auditStep.id,
      'audit',
    );
  });

  it('verifies registry signatures as an advisory, never-blocking step', () => {
    const signaturesStep = findStepByName(job, 'npm-audit', 'Verify registry signatures (advisory)');

    assertStringContainsInvariant(
      'Registry signature verification runs npm audit signatures',
      signaturesStep.run,
      'npm audit signatures',
    );
    assertStringContainsInvariant(
      'Registry signature verification downgrades failures to a warning',
      signaturesStep.run,
      '|| echo "::warning::',
    );
  });

  it('uploads audit artifacts with bounded retention even on failure', () => {
    const uploadStep = findStepByName(job, 'npm-audit', 'Upload audit artifacts');

    assertStepUsesAction(
      'Security audit uploads artifacts with actions/upload-artifact',
      uploadStep,
      'actions/upload-artifact',
    );
    assertExpressionContainsInvariant(
      'Security audit uploads artifacts even when the audit fails',
      uploadStep.if,
      'always()',
    );
    assertDeepEqualInvariant(
      'Security audit artifact upload stays scoped with bounded retention',
      uploadStep.with,
      {
        name: 'security-audit-artifacts',
        path: 'reports/security/',
        'if-no-files-found': 'ignore',
        'retention-days': 7,
      },
    );
  });

  it('fails the job only on high or critical production findings', () => {
    const failStep = findStepByName(job, 'npm-audit', 'Fail on high or critical findings');

    assertExpressionContainsInvariant(
      'Security audit failure gate keys off the audit status output',
      failStep.if,
      "steps.audit.outputs.status != '0'",
    );
    assertStringContainsInvariant(
      'Security audit failure gate exits non-zero',
      failStep.run,
      'exit 1',
    );
  });
});
