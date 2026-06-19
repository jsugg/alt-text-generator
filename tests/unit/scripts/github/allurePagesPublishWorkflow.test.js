const {
  assertDeepEqualInvariant,
  assertEnvContainsInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertNoConditionContainsInvariant,
  assertStepUsesAction,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

describe('Unit | Workflows | Allure Pages Publish', () => {
  it('deploys prepared Pages artifacts from main CI runs and supports dispatch-based PR/manual backfills', () => {
    const workflow = loadWorkflow('allure-pages-publish.yml');
    const publishJob = getJob(workflow, 'publish-allure-pages');
    const checkoutStep = findStepByName(publishJob, 'publish-allure-pages', 'Checkout');
    const resolveSourceStep = findStepByName(
      publishJob,
      'publish-allure-pages',
      'Resolve source workflow run',
    );
    const downloadSiteStep = findStepByName(
      publishJob,
      'publish-allure-pages',
      'Download prepared GitHub Pages site',
    );
    const downloadMetadataStep = findStepByName(
      publishJob,
      'publish-allure-pages',
      'Download GitHub Pages metadata',
    );
    const readMetadataStep = findStepByName(
      publishJob,
      'publish-allure-pages',
      'Read GitHub Pages metadata',
    );
    const uploadPagesStep = findStepByName(
      publishJob,
      'publish-allure-pages',
      'Upload GitHub Pages deployment artifact',
    );
    const deployPagesStep = findStepByName(
      publishJob,
      'publish-allure-pages',
      'Deploy to GitHub Pages',
    );
    const syncBranchStep = findStepByName(
      publishJob,
      'publish-allure-pages',
      'Sync Pages state branch',
    );

    assertDeepEqualInvariant(
      'Allure Pages Publish triggers only after completed main CI workflow runs and manual backfills',
      workflow.on,
      {
        workflow_run: {
          workflows: ['CI'],
          branches: ['main'],
          types: ['completed'],
        },
        workflow_dispatch: {
          inputs: {
            run_id: {
              description: 'CI workflow run ID that contains the prepared Allure Pages artifacts',
              required: true,
              type: 'string',
            },
          },
        },
      },
    );
    assertDeepEqualInvariant(
      'Allure Pages Publish has the Pages deployment token permissions',
      workflow.permissions,
      {
        actions: 'read',
        contents: 'write',
        'id-token': 'write',
        pages: 'write',
      },
    );
    assertDeepEqualInvariant(
      'Allure Pages Publish exposes only the Pages deployment job',
      Object.keys(workflow.jobs),
      ['publish-allure-pages'],
    );
    assertDeepEqualInvariant(
      'Allure Pages Publish deploys through the protected github-pages environment',
      publishJob.environment,
      { name: 'github-pages' },
    );
    assertStepUsesAction(
      'Allure Pages Publish checks out repository scripts before deployment',
      checkoutStep,
      'actions/checkout',
    );
    assertEnvContainsInvariant(
      'Allure Pages Publish resolves source runs with the workflow token',
      resolveSourceStep.env,
      {
        DISPATCH_RUN_ID: "${{ github.event_name == 'workflow_dispatch' && inputs.run_id || '' }}",
        GITHUB_TOKEN: '${{ github.token }}',
      },
    );
    assertStringContainsInvariant(
      'Allure Pages Publish resolves the source CI run through the repository helper',
      resolveSourceStep.run,
      'node scripts/github/resolve-pages-source-run.js',
    );
    assertStepUsesAction(
      'Allure Pages Publish downloads the prepared Pages site artifact',
      downloadSiteStep,
      'actions/download-artifact',
    );
    assertDeepEqualInvariant(
      'Allure Pages Publish downloads the source-run Pages site artifact by run ID',
      downloadSiteStep.with,
      {
        'github-token': '${{ github.token }}',
        name: 'allure-pages-site',
        path: 'reports/pages-site',
        'run-id': '${{ steps.source-run.outputs.run_id }}',
      },
    );
    assertStepUsesAction(
      'Allure Pages Publish downloads the prepared Pages metadata artifact',
      downloadMetadataStep,
      'actions/download-artifact',
    );
    assertDeepEqualInvariant(
      'Allure Pages Publish downloads the source-run Pages metadata by run ID',
      downloadMetadataStep.with,
      {
        'github-token': '${{ github.token }}',
        name: 'allure-pages-metadata',
        path: 'reports/pages-metadata',
        'run-id': '${{ steps.source-run.outputs.run_id }}',
      },
    );
    assertExpressionContainsInvariant(
      'Allure Pages Publish reads metadata only after prepared artifacts are detected',
      readMetadataStep.if,
      "steps.detect.outputs.found == 'true'",
    );
    assertStringContainsInvariant(
      'Allure Pages Publish reads metadata with the repository helper',
      readMetadataStep.run,
      'node scripts/github/read-pages-metadata.js',
    );
    assertStepUsesAction(
      'Allure Pages Publish uploads the GitHub Pages deployment artifact',
      uploadPagesStep,
      'actions/upload-pages-artifact',
    );
    assertStepUsesAction(
      'Allure Pages Publish deploys through actions/deploy-pages',
      deployPagesStep,
      'actions/deploy-pages',
    );
    assertStringContainsInvariant(
      'Allure Pages Publish syncs the deployed snapshot back to gh-pages state',
      syncBranchStep.run,
      'node scripts/github/sync-pages-state-branch.js',
    );
    assertNoConditionContainsInvariant(
      workflow,
      "github.event.workflow_run.conclusion == 'success'",
      'Allure Pages Publish must inspect prepared artifacts even when source CI later failed',
    );
    assertEqualInvariant(
      'Allure Pages Publish writes a summary regardless of artifact/deploy outcome',
      findStepByName(publishJob, 'publish-allure-pages', 'Write GitHub Pages summary').if,
      'always()',
    );
  });
});
