const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  listArtifactsForName,
  parseArgs,
  restoreAllureHistoryFromArtifact,
  selectArtifact,
} = require('../../scripts/reporting/restore-allure-history-from-artifact');

describe('Unit | Allure History Artifact Restore', () => {
  it('parses the required CLI arguments', () => {
    expect(parseArgs([
      '--artifact-name',
      'allure-history-ci-main',
      '--history-key',
      'ci-main',
      '--results-dir',
      'reports/allure-results',
    ])).toEqual({
      artifactName: 'allure-history-ci-main',
      githubOutput: null,
      historyKey: 'ci-main',
      resultsDir: path.join(process.cwd(), 'reports', 'allure-results'),
    });
  });

  it('rejects missing required CLI arguments', () => {
    expect(() => parseArgs([
      '--artifact-name',
      'allure-history-ci-main',
      '--results-dir',
      'reports/allure-results',
    ])).toThrow('Missing required argument: --history-key <key>');
  });

  it('selects the newest eligible artifact and excludes the current run', () => {
    expect(selectArtifact({
      artifacts: [
        {
          archive_download_url: 'https://example.com/1',
          created_at: '2026-03-11T10:00:00.000Z',
          expired: false,
          id: 1,
          name: 'allure-history-ci-main',
          workflow_run: { id: 999 },
        },
        {
          archive_download_url: 'https://example.com/2',
          created_at: '2026-03-11T11:00:00.000Z',
          expired: false,
          id: 2,
          name: 'allure-history-ci-main',
          workflow_run: { id: 1234 },
        },
      ],
      currentRunId: '1234',
    })).toMatchObject({
      id: 1,
    });
  });

  it('collects paginated artifact results from the GitHub API', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 2,
          artifacts: [
            {
              archive_download_url: 'https://example.com/1',
              created_at: '2026-03-11T10:00:00.000Z',
              expired: false,
              id: 1,
              name: 'allure-history-ci-main',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_count: 2,
          artifacts: [
            {
              archive_download_url: 'https://example.com/2',
              created_at: '2026-03-11T11:00:00.000Z',
              expired: false,
              id: 2,
              name: 'allure-history-ci-main',
            },
          ],
        }),
      });

    await expect(listArtifactsForName({
      artifactName: 'allure-history-ci-main',
      fetchImpl,
      repository: 'jsugg/alt-text-generator',
      token: 'token',
    })).resolves.toHaveLength(2);
  });

  it('skips restoration when the GitHub token or repository context is missing', async () => {
    const warn = jest.fn();

    await expect(restoreAllureHistoryFromArtifact({
      artifactName: 'allure-history-ci-main',
      historyKey: 'ci-main',
      logger: { info: jest.fn(), warn },
      repository: '',
      resultsDir: path.join(os.tmpdir(), 'unused-results-dir'),
      token: '',
    })).resolves.toEqual({
      artifactId: '',
      restored: false,
      source: 'none',
    });

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('treats a cold-start stream as a non-fatal skip', async () => {
    const resultsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-restore-'));

    try {
      const result = await restoreAllureHistoryFromArtifact({
        artifactName: 'allure-history-ci-main',
        fetchImpl: jest.fn(),
        historyKey: 'ci-main',
        listArtifactsForNameImpl: jest.fn().mockResolvedValue([]),
        logger: { info: jest.fn(), warn: jest.fn() },
        repository: 'jsugg/alt-text-generator',
        resultsDir,
        token: 'token',
      });

      expect(result).toEqual({
        artifactId: '',
        restored: false,
        source: 'none',
      });
      await expect(fs.access(path.join(resultsDir, 'history'))).rejects.toThrow();
    } finally {
      await fs.rm(resultsDir, { force: true, recursive: true });
    }
  });

  it('copies the latest valid history artifact into the results directory', async () => {
    const resultsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-restore-'));

    try {
      const result = await restoreAllureHistoryFromArtifact({
        artifactName: 'allure-history-ci-main',
        downloadArtifactArchiveImpl: jest.fn().mockResolvedValue(undefined),
        extractArchiveImpl: jest.fn(async ({ outputDir }) => {
          await fs.mkdir(path.join(outputDir, 'history'), { recursive: true });
          await fs.writeFile(
            path.join(outputDir, 'history', 'history-trend.json'),
            '[{"buildOrder":1}]',
            'utf8',
          );
          await fs.writeFile(
            path.join(outputDir, 'manifest.json'),
            JSON.stringify({
              historyKey: 'ci-main',
              reportKind: 'ci-main',
            }),
            'utf8',
          );
        }),
        historyKey: 'ci-main',
        listArtifactsForNameImpl: jest.fn().mockResolvedValue([
          {
            archive_download_url: 'https://example.com/download',
            created_at: '2026-03-11T11:00:00.000Z',
            expired: false,
            id: 42,
            name: 'allure-history-ci-main',
            workflow_run: { id: 111 },
          },
        ]),
        logger: { info: jest.fn(), warn: jest.fn() },
        repository: 'jsugg/alt-text-generator',
        resultsDir,
        token: 'token',
      });

      expect(result).toEqual({
        artifactId: '42',
        restored: true,
        source: 'artifact',
      });
      expect(await fs.readFile(
        path.join(resultsDir, 'history', 'history-trend.json'),
        'utf8',
      )).toBe('[{"buildOrder":1}]');
    } finally {
      await fs.rm(resultsDir, { force: true, recursive: true });
    }
  });

  it('rejects artifacts with mismatched manifests without failing the build', async () => {
    const resultsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-restore-'));
    const warn = jest.fn();

    try {
      const result = await restoreAllureHistoryFromArtifact({
        artifactName: 'allure-history-ci-main',
        downloadArtifactArchiveImpl: jest.fn().mockResolvedValue(undefined),
        extractArchiveImpl: jest.fn(async ({ outputDir }) => {
          await fs.mkdir(path.join(outputDir, 'history'), { recursive: true });
          await fs.writeFile(
            path.join(outputDir, 'history', 'history-trend.json'),
            '[{"buildOrder":1}]',
            'utf8',
          );
          await fs.writeFile(
            path.join(outputDir, 'manifest.json'),
            JSON.stringify({
              historyKey: 'ci-pr-123',
              reportKind: 'ci-pr',
            }),
            'utf8',
          );
        }),
        historyKey: 'ci-main',
        listArtifactsForNameImpl: jest.fn().mockResolvedValue([
          {
            archive_download_url: 'https://example.com/download',
            created_at: '2026-03-11T11:00:00.000Z',
            expired: false,
            id: 42,
            name: 'allure-history-ci-main',
            workflow_run: { id: 111 },
          },
        ]),
        logger: { info: jest.fn(), warn },
        repository: 'jsugg/alt-text-generator',
        resultsDir,
        token: 'token',
      });

      expect(result).toEqual({
        artifactId: '',
        restored: false,
        source: 'none',
      });
      expect(warn).toHaveBeenCalledTimes(1);
      await expect(fs.access(path.join(resultsDir, 'history'))).rejects.toThrow();
    } finally {
      await fs.rm(resultsDir, { force: true, recursive: true });
    }
  });
});
