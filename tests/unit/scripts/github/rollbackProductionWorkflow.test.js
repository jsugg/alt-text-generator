const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertNoRunCommandContainsInvariant,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

describe('Unit | Scripts | GitHub | Rollback Production Workflow', () => {
  const workflow = loadWorkflow('rollback-production.yml');
  const job = getJob(workflow, 'rollback');

  it('runs only on manual dispatch with a dry-run default of true', () => {
    const { inputs } = workflow.on.workflow_dispatch;

    assertDeepEqualInvariant(
      'Rollback exposes exactly the to_sha, reason, and dry_run inputs',
      Object.keys(inputs),
      ['to_sha', 'reason', 'dry_run'],
    );
    assertEqualInvariant('Rollback requires a target SHA', inputs.to_sha.required, true);
    assertEqualInvariant('Rollback requires a reason', inputs.reason.required, true);
    assertEqualInvariant(
      'Rollback defaults to a dry run so a mistaken dispatch cannot move production',
      inputs.dry_run.default,
      true,
    );
  });

  it('serializes with promotion so a rollback never interleaves with a release', () => {
    assertDeepEqualInvariant(
      'Rollback shares the promotion concurrency group without cancellation',
      workflow.concurrency,
      {
        group: 'promote-to-production',
        'cancel-in-progress': false,
      },
    );
  });

  it('keeps the promotion trust boundary: App token only, prod-validation environment', () => {
    const rollbackStep = findStepByName(job, 'rollback', 'Roll back production with GitHub App token');
    const requireAppStep = findStepByName(job, 'rollback', 'Require repository automation GitHub App');

    assertEqualInvariant(
      'Rollback runs in the prod-validation environment',
      job.environment,
      'prod-validation',
    );
    assertExpressionContainsInvariant(
      'Rollback executes only when the GitHub App auth strategy resolves',
      rollbackStep.if,
      "steps.promotion-auth.outputs.use_github_app == 'true'",
    );
    assertEqualInvariant(
      'Rollback uses the App installation token as GH_TOKEN',
      rollbackStep.env.GH_TOKEN,
      '${{ steps.promotion-app-token.outputs.token }}',
    );
    assertExpressionContainsInvariant(
      'Rollback fails closed without the GitHub App (no PAT fallback)',
      requireAppStep.if,
      "steps.promotion-auth.outputs.use_github_app != 'true'",
    );
    assertDeepEqualInvariant(
      'Rollback workflow permissions stay limited to contents write',
      workflow.permissions,
      { contents: 'write' },
    );
    assertEqualInvariant('Rollback declares a timeout', job['timeout-minutes'], 10);
  });

  it('passes free-text inputs through environment indirection', () => {
    const rollbackStep = findStepByName(job, 'rollback', 'Roll back production with GitHub App token');

    assertEqualInvariant(
      'Rollback reason flows through an env var, never inline shell interpolation',
      rollbackStep.env.ROLLBACK_REASON,
      '${{ inputs.reason }}',
    );
    assertStringContainsInvariant(
      'Rollback script reads the reason from the environment',
      rollbackStep.run,
      '--reason "${ROLLBACK_REASON}"',
    );
    assertStringContainsInvariant(
      'Rollback script reads the dry-run flag from the environment',
      rollbackStep.run,
      '--dry-run "${ROLLBACK_DRY_RUN}"',
    );
    assertNoRunCommandContainsInvariant(
      workflow,
      '${{ inputs.',
      'Rollback run commands must not inline dispatch inputs',
    );
  });
});
