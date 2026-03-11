const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildHistoryArtifactManifest,
  packageAllureHistoryArtifact,
  parseArgs,
} = require('../../scripts/reporting/package-allure-history-artifact');

describe('Unit | Allure History Artifact Packaging', () => {
  it('parses the required CLI arguments', () => {
    expect(parseArgs([
      '--report-dir',
      'reports/allure-report',
      '--output-dir',
      'reports/allure-history-artifact',
      '--history-key',
      'ci-main',
      '--report-kind',
      'ci-main',
    ])).toEqual({
      historyKey: 'ci-main',
      outputDir: path.join(process.cwd(), 'reports', 'allure-history-artifact'),
      reportDir: path.join(process.cwd(), 'reports', 'allure-report'),
      reportKind: 'ci-main',
    });
  });

  it('builds a manifest with stream-specific metadata', () => {
    expect(buildHistoryArtifactManifest({
      env: {
        ALLURE_NEWMAN_MODE: 'harness',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REF_NAME: 'main',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_NUMBER: '45',
        GITHUB_WORKFLOW: 'CI',
      },
      historyKey: 'ci-main',
      now: '2026-03-11T15:00:00.000Z',
      reportKind: 'ci-main',
    })).toEqual({
      createdAt: '2026-03-11T15:00:00.000Z',
      eventName: 'push',
      historyKey: 'ci-main',
      newmanMode: 'harness',
      refName: 'main',
      reportKind: 'ci-main',
      runId: '123',
      runNumber: '45',
      workflowName: 'CI',
    });
  });

  it('includes optional PR, Newman mode, and base URL fields when present', () => {
    expect(buildHistoryArtifactManifest({
      env: {
        ALLURE_BASE_URL: 'https://wcag.qcraft.com.br',
        ALLURE_NEWMAN_MODE: 'deploy',
        ALLURE_PR_NUMBER: '123',
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF_NAME: 'main',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_NUMBER: '45',
        GITHUB_WORKFLOW: 'Deploy Verification',
      },
      historyKey: 'deploy-production',
      now: '2026-03-11T15:00:00.000Z',
      reportKind: 'deploy-production',
    })).toEqual({
      baseUrl: 'https://wcag.qcraft.com.br',
      createdAt: '2026-03-11T15:00:00.000Z',
      eventName: 'workflow_dispatch',
      historyKey: 'deploy-production',
      newmanMode: 'deploy',
      pullRequestNumber: '123',
      refName: 'main',
      reportKind: 'deploy-production',
      runId: '123',
      runNumber: '45',
      workflowName: 'Deploy Verification',
    });
  });

  it('rejects missing required CLI arguments', () => {
    expect(() => parseArgs([
      '--report-dir',
      'reports/allure-report',
      '--output-dir',
      'reports/allure-history-artifact',
      '--report-kind',
      'ci-main',
    ])).toThrow('Missing required argument: --history-key <key>');
  });

  it('copies the generated history directory and manifest into the artifact output', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-history-package-'));
    const reportDir = path.join(rootDir, 'report');
    const outputDir = path.join(rootDir, 'artifact');

    try {
      await fs.mkdir(path.join(reportDir, 'history'), { recursive: true });
      await fs.writeFile(
        path.join(reportDir, 'history', 'history-trend.json'),
        '[{"buildOrder":1}]',
        'utf8',
      );

      const manifest = await packageAllureHistoryArtifact({
        env: {
          GITHUB_EVENT_NAME: 'push',
          GITHUB_REF_NAME: 'main',
          GITHUB_RUN_ID: '123',
          GITHUB_RUN_NUMBER: '45',
          GITHUB_WORKFLOW: 'CI',
        },
        historyKey: 'ci-main',
        outputDir,
        reportDir,
        reportKind: 'ci-main',
      });

      expect(manifest.historyKey).toBe('ci-main');
      expect(await fs.readFile(
        path.join(outputDir, 'history', 'history-trend.json'),
        'utf8',
      )).toBe('[{"buildOrder":1}]');

      const writtenManifest = JSON.parse(
        await fs.readFile(path.join(outputDir, 'manifest.json'), 'utf8'),
      );
      expect(writtenManifest.historyKey).toBe('ci-main');
      expect(writtenManifest.reportKind).toBe('ci-main');
    } finally {
      await fs.rm(rootDir, { force: true, recursive: true });
    }
  });
});
