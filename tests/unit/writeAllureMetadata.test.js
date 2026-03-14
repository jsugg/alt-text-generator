const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildEnvironmentProperties,
  buildExecutorMetadata,
  parseArgs,
  toPropertiesFile,
  writeAllureMetadata,
} = require('../../scripts/reporting/write-allure-metadata');

describe('Unit | Allure Metadata Writer', () => {
  it('parses the required results directory argument', () => {
    const { resultsDir } = parseArgs(['--results-dir', 'reports/allure-results']);

    expect(resultsDir).toBe(path.join(process.cwd(), 'reports', 'allure-results'));
  });

  it('builds environment properties from the current runtime and CI env', () => {
    const properties = buildEnvironmentProperties({
      env: {
        ALLURE_BASE_URL: 'https://wcag.qcraft.com.br',
        ALLURE_HISTORY_KEY: 'ci-main',
        ALLURE_NEWMAN_MODE: 'full',
        ALLURE_PR_NUMBER: '123',
        ALLURE_REPORT_KIND: 'ci-main',
        ALLURE_WORKFLOW_KIND: 'ci',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_WORKFLOW: 'CI',
        GITHUB_REF_NAME: 'main',
        GITHUB_SHA: 'abc123',
      },
      rootDir: process.cwd(),
    });

    expect(properties).toMatchObject({
      node_version: process.version,
      workflow: 'CI',
      branch: 'main',
      commit_sha: 'abc123',
      history_stream: 'ci-main',
      report_kind: 'ci-main',
      github_event_name: 'push',
      pr_number: '123',
      newman_mode: 'full',
      workflow_kind: 'ci',
      base_url: 'https://wcag.qcraft.com.br',
      jest_version: require('jest/package.json').version,
      newman_version: require('newman/package.json').version,
    });
  });

  it('builds GitHub-flavored executor metadata when workflow env is present', () => {
    const executor = buildExecutorMetadata({
      env: {
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_NUMBER: '77',
        GITHUB_WORKFLOW: 'CI',
      },
    });

    expect(executor).toEqual({
      name: 'GitHub Actions',
      type: 'github',
      buildName: 'CI #12345',
      buildOrder: 77,
      buildUrl: 'https://github.com/jsugg/alt-text-generator/actions/runs/12345',
      reportName: 'CI Allure Report',
    });
  });

  it('writes environment.properties and executor.json into the results directory', async () => {
    const resultsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-results-'));

    try {
      await writeAllureMetadata({
        resultsDir,
        env: {
          ALLURE_HISTORY_KEY: 'ci-main',
          ALLURE_REPORT_KIND: 'ci-main',
          ALLURE_NEWMAN_MODE: 'full',
          ALLURE_WORKFLOW_KIND: 'ci',
          GITHUB_WORKFLOW: 'CI',
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF_NAME: 'main',
          GITHUB_SHA: 'abc123',
          GITHUB_SERVER_URL: 'https://github.com',
          GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
          GITHUB_RUN_ID: '12345',
          GITHUB_RUN_NUMBER: '77',
        },
        rootDir: process.cwd(),
      });

      const environmentProperties = await fs.readFile(
        path.join(resultsDir, 'environment.properties'),
        'utf8',
      );
      const executor = JSON.parse(
        await fs.readFile(path.join(resultsDir, 'executor.json'), 'utf8'),
      );

      expect(environmentProperties).toContain('workflow=CI');
      expect(environmentProperties).toContain('branch=main');
      expect(environmentProperties).toContain('commit_sha=abc123');
      expect(environmentProperties).toContain('history_stream=ci-main');
      expect(environmentProperties).toContain('report_kind=ci-main');
      expect(environmentProperties).toContain('newman_mode=full');
      expect(executor.buildUrl).toBe(
        'https://github.com/jsugg/alt-text-generator/actions/runs/12345',
      );
    } finally {
      await fs.rm(resultsDir, { recursive: true, force: true });
    }
  });

  it('serializes Java properties safely', () => {
    const content = toPropertiesFile({
      key: 'line 1\nline 2\\value',
    });

    expect(content).toBe('key=line 1\\nline 2\\\\value\n');
  });
});
