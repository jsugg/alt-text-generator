const fs = require('node:fs');
const path = require('node:path');

function getAllurePagesJobBlock(workflowContents) {
  const match = workflowContents.match(/\n {2}allure-pages:\n([\s\S]*?)\n {2}ci-summary:\n/u);
  if (!match) {
    throw new Error('Unable to locate the allure-pages job block in .github/workflows/ci.yml');
  }

  return match[1];
}

describe('Unit | Workflows | CI Allure Pages', () => {
  it('prepares a composed Pages site artifact without deploying directly from the CI run', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
    const workflowContents = fs.readFileSync(workflowPath, 'utf8');
    const allurePagesJobBlock = getAllurePagesJobBlock(workflowContents);

    expect(allurePagesJobBlock).toContain('contents: read');
    expect(allurePagesJobBlock).toContain('git fetch origin gh-pages || true');
    expect(allurePagesJobBlock).toContain('name: allure-pages-site');
    expect(allurePagesJobBlock).toContain('name: allure-pages-metadata');
    expect(allurePagesJobBlock).toContain('node scripts/github/write-pages-metadata.js');

    expect(allurePagesJobBlock).not.toContain('environment:');
    expect(allurePagesJobBlock).not.toContain('pages: write');
    expect(allurePagesJobBlock).not.toContain('id-token: write');
    expect(allurePagesJobBlock).not.toContain('deploy-pages-artifact.js');
    expect(allurePagesJobBlock).not.toContain('publish-pages-branch.js');
  });
});
