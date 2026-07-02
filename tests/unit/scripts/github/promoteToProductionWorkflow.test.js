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

describe('Unit | Scripts | GitHub | Promote To Production Workflow', () => {
  const workflow = loadWorkflow('promote-to-production.yml');
  const promoteJob = getJob(workflow, 'promote');
  const validationJob = getJob(workflow, 'pre-production-provider-validation');

  it('runs only on manual dispatch with non-cancelable serialized promotion', () => {
    assertDeepEqualInvariant(
      'Promotion triggers on workflow_dispatch only',
      workflow.on,
      { workflow_dispatch: null },
    );
    assertDeepEqualInvariant(
      'Promotion serializes runs without canceling in-flight releases',
      workflow.concurrency,
      {
        group: 'promote-to-production',
        'cancel-in-progress': false,
      },
    );
  });

  it('derives required checks from live main branch protection, never a hardcoded list', () => {
    assertNoRunCommandContainsInvariant(
      workflow,
      '--required-checks',
      'Promotion must not hardcode required checks; the script derives them from branch protection',
    );

    const promoteStep = findStepByName(
      promoteJob,
      'promote',
      'Promote main into production with GitHub App token',
    );

    assertStringContainsInvariant(
      'Promotion invokes the promotion script',
      promoteStep.run,
      'node scripts/github/promote-to-production.js',
    );
    assertStringContainsInvariant(
      'Promotion sources from main',
      promoteStep.run,
      '--source-branch "main"',
    );
    assertStringContainsInvariant(
      'Promotion targets production',
      promoteStep.run,
      '--target-branch "production"',
    );
  });

  it('promotes only with the repository automation GitHub App token', () => {
    const promoteStep = findStepByName(
      promoteJob,
      'promote',
      'Promote main into production with GitHub App token',
    );
    const requireAppStep = findStepByName(
      promoteJob,
      'promote',
      'Require repository automation GitHub App',
    );

    assertExpressionContainsInvariant(
      'Promotion runs only when the GitHub App auth strategy resolves',
      promoteStep.if,
      "steps.promotion-auth.outputs.use_github_app == 'true'",
    );
    assertEqualInvariant(
      'Promotion uses the App installation token as GH_TOKEN',
      promoteStep.env.GH_TOKEN,
      '${{ steps.promotion-app-token.outputs.token }}',
    );
    assertExpressionContainsInvariant(
      'Promotion fails closed when the GitHub App is not configured (no PAT fallback)',
      requireAppStep.if,
      "steps.promotion-auth.outputs.use_github_app != 'true'",
    );
  });

  it('keeps environment-scoped validation and bounded runtimes', () => {
    assertEqualInvariant(
      'Pre-production provider validation runs in the prod-validation environment',
      validationJob.environment,
      'prod-validation',
    );
    assertEqualInvariant(
      'Promotion job runs in the prod-validation environment',
      promoteJob.environment,
      'prod-validation',
    );
    assertEqualInvariant(
      'Provider validation declares a timeout',
      validationJob['timeout-minutes'],
      20,
    );
    assertEqualInvariant(
      'Promotion declares a timeout',
      promoteJob['timeout-minutes'],
      15,
    );
    assertDeepEqualInvariant(
      'Promotion workflow permissions stay limited to contents write',
      workflow.permissions,
      { contents: 'write' },
    );
  });
});
