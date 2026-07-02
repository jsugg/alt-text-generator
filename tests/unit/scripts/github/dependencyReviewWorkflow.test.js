const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertNoRunCommandContainsInvariant,
  assertStepUsesAction,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

describe('Unit | Scripts | GitHub | Dependency Review Workflow', () => {
  const workflow = loadWorkflow('dependency-review.yml');
  const job = getJob(workflow, 'dependency-review');
  const reviewStep = findStepByName(job, 'dependency-review', 'Review dependency changes');

  it('gates pushes and pull requests on main and production plus manual replays', () => {
    assertDeepEqualInvariant(
      'Dependency review triggers on main/production pushes and pull requests',
      { push: workflow.on.push, pull_request: workflow.on.pull_request },
      {
        push: { branches: ['main', 'production'] },
        pull_request: { branches: ['main', 'production'] },
      },
    );
    assertDeepEqualInvariant(
      'Dependency review manual replays require explicit base and head refs',
      Object.keys(workflow.on.workflow_dispatch.inputs),
      ['base_ref', 'head_ref'],
    );
  });

  it('keeps least-privilege read-only permissions and a job timeout', () => {
    assertDeepEqualInvariant(
      'Dependency review workflow keeps contents read-only permissions',
      workflow.permissions,
      { contents: 'read' },
    );
    assertEqualInvariant(
      'Dependency review job declares a timeout',
      job['timeout-minutes'],
      10,
    );
    assertEqualInvariant(
      'Dependency review publishes the stable required check name',
      job.name,
      'dependency-review',
    );
  });

  it('cancels superseded runs per ref', () => {
    assertDeepEqualInvariant(
      'Dependency review cancels superseded runs for the same ref',
      workflow.concurrency,
      {
        group: 'dependency-review-${{ github.ref }}',
        'cancel-in-progress': true,
      },
    );
  });

  it('runs the custom reviewer through env indirection with the workflow token only', () => {
    assertStringContainsInvariant(
      'Dependency review invokes the repository review script',
      reviewStep.run,
      'node scripts/github/review-dependencies.js',
    );
    assertEqualInvariant(
      'Dependency review uses the ephemeral workflow token',
      reviewStep.env.GITHUB_TOKEN,
      '${{ github.token }}',
    );
    assertStringContainsInvariant(
      'Dependency review passes refs through environment indirection',
      reviewStep.run,
      '--base-ref "${DEPENDENCY_REVIEW_BASE_REF}"',
    );
    assertNoRunCommandContainsInvariant(
      workflow,
      '${{ secrets.',
      'Dependency review run commands must not interpolate secrets',
    );
    assertNoRunCommandContainsInvariant(
      workflow,
      '${{ github.event.',
      'Dependency review run commands must not inline event payload expressions',
    );
  });

  it('sets up Node with the pinned actions', () => {
    const checkoutStep = findStepByName(job, 'dependency-review', 'Checkout');
    const setupStep = findStepByName(job, 'dependency-review', 'Setup Node');

    assertStepUsesAction(
      'Dependency review checks out with actions/checkout',
      checkoutStep,
      'actions/checkout',
    );
    assertStepUsesAction(
      'Dependency review sets up Node with actions/setup-node',
      setupStep,
      'actions/setup-node',
    );
  });
});
