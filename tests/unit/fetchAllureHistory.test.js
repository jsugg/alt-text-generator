const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_TIMEOUT_MS,
  HISTORY_FILENAMES,
  buildHistoryFileUrl,
  fetchHistoryFile,
  normalizeReportUrl,
  parseArgs,
  restoreAllureHistory,
} = require('../../scripts/reporting/fetch-allure-history');

describe('Unit | Allure History Fetcher', () => {
  it('normalizes the report URL and builds history file URLs', () => {
    expect(normalizeReportUrl('https://jsugg.github.io/alt-text-generator///')).toBe(
      'https://jsugg.github.io/alt-text-generator',
    );
    expect(buildHistoryFileUrl(
      'https://jsugg.github.io/alt-text-generator/',
      'history.json',
    )).toBe('https://jsugg.github.io/alt-text-generator/history/history.json');
  });

  it('parses CLI arguments with defaults', () => {
    expect(parseArgs([
      '--results-dir',
      'reports/allure-results',
      '--report-url',
      'https://jsugg.github.io/alt-text-generator/',
    ])).toEqual({
      reportUrl: 'https://jsugg.github.io/alt-text-generator',
      resultsDir: path.join(process.cwd(), 'reports', 'allure-results'),
      timeoutMs: DEFAULT_TIMEOUT_MS,
    });
  });

  it('rejects invalid timeout values', () => {
    expect(() => parseArgs([
      '--results-dir',
      'reports/allure-results',
      '--timeout-ms',
      '0',
    ])).toThrow('Expected --timeout-ms to be a positive number');
  });

  it('fetches and validates a history file', async () => {
    const result = await fetchHistoryFile({
      filename: 'history.json',
      reportUrl: 'https://jsugg.github.io/alt-text-generator',
      fetchImpl: jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: jest.fn().mockResolvedValue('{"items": []}'),
      }),
    });

    expect(result).toEqual({
      content: '{"items": []}\n',
      filename: 'history.json',
      status: 'restored',
      url: 'https://jsugg.github.io/alt-text-generator/history/history.json',
    });
  });

  it('treats 404 history files as missing instead of failing the build', async () => {
    const result = await fetchHistoryFile({
      filename: 'history.json',
      reportUrl: 'https://jsugg.github.io/alt-text-generator',
      fetchImpl: jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: jest.fn(),
      }),
    });

    expect(result).toEqual({
      filename: 'history.json',
      status: 'missing',
      url: 'https://jsugg.github.io/alt-text-generator/history/history.json',
    });
  });

  it('warns and continues when a history file is invalid', async () => {
    const warn = jest.fn();
    const resultsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-history-'));
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/history.json')) {
        return {
          ok: true,
          status: 200,
          text: async () => '<html>not json</html>',
        };
      }

      return {
        ok: false,
        status: 404,
        text: async () => '',
      };
    });

    try {
      const result = await restoreAllureHistory({
        fetchImpl,
        logger: { info: jest.fn(), warn },
        reportUrl: 'https://jsugg.github.io/alt-text-generator',
        resultsDir,
      });

      expect(result.restoredFiles).toEqual([]);
      expect(result.skippedFiles).toEqual(HISTORY_FILENAMES.filter((name) => name !== 'history.json'));
      expect(result.errors).toEqual([
        {
          filename: 'history.json',
          message: expect.stringContaining('Unexpected token'),
          url: 'https://jsugg.github.io/alt-text-generator/history/history.json',
        },
      ]);
      expect(warn).toHaveBeenCalledTimes(1);
      await expect(fs.stat(path.join(resultsDir, 'history'))).rejects.toThrow();
    } finally {
      await fs.rm(resultsDir, { recursive: true, force: true });
    }
  });

  it('restores the published history files into the results directory', async () => {
    const resultsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-history-'));
    const fetchImpl = jest.fn(async (url) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        source: url,
      }),
    }));

    try {
      const result = await restoreAllureHistory({
        fetchImpl,
        logger: { info: jest.fn(), warn: jest.fn() },
        reportUrl: 'https://jsugg.github.io/alt-text-generator',
        resultsDir,
      });

      expect(result.errors).toEqual([]);
      expect(result.skippedFiles).toEqual([]);
      expect(result.restoredFiles).toEqual(HISTORY_FILENAMES);

      const writtenFiles = await fs.readdir(path.join(resultsDir, 'history'));
      expect(writtenFiles.sort()).toEqual([...HISTORY_FILENAMES].sort());
    } finally {
      await fs.rm(resultsDir, { recursive: true, force: true });
    }
  });
});
