const {
  assertDeepEqualInvariant,
  assertEnvContainsInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertNoActionReferencesInvariant,
  assertNoRunCommandContainsInvariant,
  assertStepUsesAction,
  assertStringContainsInvariant,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../../helpers/workflowAssertions');

describe('Unit | Workflows | CI Allure Pages', () => {
  it('prepares a composed Pages site artifact and dispatches PR publication without deploying directly from the CI run', () => {
    const workflow = loadWorkflow('ci.yml');
    const allurePagesJob = getJob(workflow, 'allure-pages');
    const dispatchJob = getJob(workflow, 'allure-pages-publish-dispatch');
    const fetchPagesBranchStep = findStepByName(
      allurePagesJob,
      'allure-pages',
      'Fetch published Pages branch',
    );
    const downloadReportStep = findStepByName(
      allurePagesJob,
      'allure-pages',
      'Download Allure report artifact',
    );
    const writeMetadataStep = findStepByName(
      allurePagesJob,
      'allure-pages',
      'Write GitHub Pages metadata',
    );
    const uploadSiteStep = findStepByName(
      allurePagesJob,
      'allure-pages',
      'Upload prepared GitHub Pages site',
    );
    const uploadMetadataStep = findStepByName(
      allurePagesJob,
      'allure-pages',
      'Upload GitHub Pages metadata',
    );
    const dispatchPublishStep = findStepByName(
      dispatchJob,
      'allure-pages-publish-dispatch',
      'Dispatch Allure Pages publish workflow',
    );

    assertDeepEqualInvariant(
      'CI Allure Pages job waits only for the Allure report artifact job',
      allurePagesJob.needs,
      ['allure-report'],
    );
    assertExpressionContainsInvariant(
      'CI Allure Pages job runs only after a successful Allure report',
      allurePagesJob.if,
      "needs.allure-report.result == 'success'",
    );
    assertExpressionContainsInvariant(
      'CI Allure Pages job requires raw Allure results before publishing',
      allurePagesJob.if,
      "needs.allure-report.outputs.has-results == 'true'",
    );
    assertExpressionContainsInvariant(
      'CI Allure Pages job honors the computed publish_pages policy',
      allurePagesJob.if,
      "needs.allure-report.outputs.publish_pages == 'true'",
    );
    assertDeepEqualInvariant(
      'CI Allure Pages job can read actions and repository contents only',
      allurePagesJob.permissions,
      { actions: 'read', contents: 'read' },
    );
    assertEqualInvariant(
      'CI Allure Pages job must not deploy directly to an environment',
      Object.hasOwn(allurePagesJob, 'environment'),
      false,
    );
    assertEqualInvariant(
      'CI Allure Pages job fetches the durable gh-pages state branch',
      fetchPagesBranchStep.run,
      'git fetch origin gh-pages || true',
    );
    assertStepUsesAction(
      'CI Allure Pages job downloads the generated Allure report artifact',
      downloadReportStep,
      'actions/download-artifact',
    );
    assertStringContainsInvariant(
      'CI Allure Pages job writes metadata with the repository helper',
      writeMetadataStep.run,
      'node scripts/github/write-pages-metadata.js',
    );
    assertStepUsesAction(
      'CI Allure Pages job uploads prepared site content as an artifact',
      uploadSiteStep,
      'actions/upload-artifact',
    );
    assertDeepEqualInvariant(
      'CI Allure Pages job uploads the prepared site artifact with one-day retention',
      uploadSiteStep.with,
      {
        name: 'allure-pages-site',
        path: 'reports/pages-site-next/',
        'if-no-files-found': 'error',
        'retention-days': 1,
      },
    );
    assertStepUsesAction(
      'CI Allure Pages job uploads Pages metadata as an artifact',
      uploadMetadataStep,
      'actions/upload-artifact',
    );
    assertDeepEqualInvariant(
      'CI Allure Pages job uploads metadata with one-day retention',
      uploadMetadataStep.with,
      {
        name: 'allure-pages-metadata',
        path: 'reports/pages-metadata/page-metadata.json',
        'if-no-files-found': 'error',
        'retention-days': 1,
      },
    );
    assertNoActionReferencesInvariant(
      allurePagesJob,
      'allure-pages',
      ['actions/upload-pages-artifact', 'actions/deploy-pages'],
      'CI Allure Pages job must not call GitHub Pages deployment actions directly',
    );
    assertNoRunCommandContainsInvariant(
      workflow,
      'deploy-pages-artifact.js',
      'CI workflow no longer uses the removed deploy-pages-artifact helper',
    );
    assertNoRunCommandContainsInvariant(
      workflow,
      'publish-pages-branch.js',
      'CI workflow no longer publishes gh-pages from the CI run',
    );

    assertDeepEqualInvariant(
      'CI PR Pages dispatch job waits only for prepared Pages artifacts',
      dispatchJob.needs,
      ['allure-pages'],
    );
    assertExpressionContainsInvariant(
      'CI PR Pages dispatch job runs only for pull request events',
      dispatchJob.if,
      "github.event_name == 'pull_request'",
    );
    assertExpressionContainsInvariant(
      'CI PR Pages dispatch job skips forked pull requests',
      dispatchJob.if,
      'github.event.pull_request.head.repo.full_name == github.repository',
    );
    assertExpressionContainsInvariant(
      'CI PR Pages dispatch job requires prepared Pages artifacts',
      dispatchJob.if,
      "needs.allure-pages.result == 'success'",
    );
    assertDeepEqualInvariant(
      'CI PR Pages dispatch job can dispatch workflows without write-content access',
      dispatchJob.permissions,
      { actions: 'write', contents: 'read' },
    );
    assertEnvContainsInvariant(
      'CI PR Pages dispatch job uses the workflow token',
      dispatchPublishStep.env,
      { GITHUB_TOKEN: '${{ github.token }}' },
    );
    assertStringContainsInvariant(
      'CI PR Pages dispatch job calls the repository dispatch helper',
      dispatchPublishStep.run,
      'node scripts/github/dispatch-pages-publish.js',
    );
    assertStringContainsInvariant(
      'CI PR Pages dispatch job targets the default-branch publish workflow',
      dispatchPublishStep.run,
      '--ref "main"',
    );
  });
});
