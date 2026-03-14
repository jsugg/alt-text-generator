const fs = require('node:fs');
const path = require('node:path');

describe('Unit | Workflows | Allure Pages Publish', () => {
  it('deploys prepared Pages artifacts from main CI runs and supports dispatch-based PR/manual backfills', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'allure-pages-publish.yml');
    const workflowContents = fs.readFileSync(workflowPath, 'utf8');

    expect(workflowContents).toContain('workflow_run:');
    expect(workflowContents).toContain('branches:');
    expect(workflowContents).toContain('- main');
    expect(workflowContents).toContain('workflow_dispatch:');
    expect(workflowContents).toContain('run_id:');
    expect(workflowContents).toContain('uses: actions/checkout@');
    expect(workflowContents).toContain('name: allure-pages-site');
    expect(workflowContents).toContain('name: allure-pages-metadata');
    expect(workflowContents).toContain('name: Resolve source workflow run');
    expect(workflowContents).toContain('node scripts/github/resolve-pages-source-run.js');
    expect(workflowContents).toMatch(/GITHUB_TOKEN: \$\{\{ github\.token \}\}/u);
    expect(workflowContents).toContain('node scripts/github/read-pages-metadata.js');
    expect(workflowContents).toContain('node scripts/github/sync-pages-state-branch.js');
    expect(workflowContents).toMatch(/run-id: \$\{\{ steps\.source-run\.outputs\.run_id \}\}/u);
    expect(workflowContents).toContain('actions/upload-pages-artifact@');
    expect(workflowContents).toContain('actions/deploy-pages@');
    expect(workflowContents).toContain('name: github-pages');
    expect(workflowContents).toContain('contents: write');
    expect(workflowContents).not.toContain("if: github.event.workflow_run.conclusion == 'success'");
  });
});
