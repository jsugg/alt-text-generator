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
  it('publishes Pages content by updating the gh-pages branch instead of using the blocked deployment environment', () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'ci.yml');
    const workflowContents = fs.readFileSync(workflowPath, 'utf8');
    const allurePagesJobBlock = getAllurePagesJobBlock(workflowContents);

    expect(allurePagesJobBlock).toContain('contents: write');
    expect(allurePagesJobBlock).toContain('publish-pages-branch.js');
    expect(allurePagesJobBlock).toContain('git fetch origin gh-pages || true');

    expect(allurePagesJobBlock).not.toContain('deploy-pages-artifact.js');
    expect(allurePagesJobBlock).not.toContain('pages: write');
    expect(allurePagesJobBlock).not.toContain('id-token: write');
    expect(allurePagesJobBlock).not.toContain('environment:');
  });
});
