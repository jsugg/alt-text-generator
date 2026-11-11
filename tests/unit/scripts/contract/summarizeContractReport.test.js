const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_REQUESTS_DIR,
  DEFAULT_RESULTS_PATH,
  buildContractSummary,
  extractFailureHeadline,
  formatSummaryLines,
  main,
  parseArgs,
} = require('../../../../scripts/contract/summarize-contract-report');
const { readRequestLogs } = require('../../../../scripts/contract/request-log');

const ROOT = '/repo';
const RESULTS = {
  success: false,
  startTime: 1000,
  numTotalTestSuites: 2,
  numFailedTestSuites: 2,
  numTotalTests: 3,
  numPassedTests: 1,
  numFailedTests: 1,
  numPendingTests: 1,
  numTodoTests: 0,
  testResults: [
    {
      name: '/repo/tests/contract/negative.contract.test.js',
      status: 'failed',
      startTime: 1000,
      endTime: 1300,
      assertionResults: [
        { fullName: 'Negative > rejects missing url', status: 'passed' },
        {
          fullName: 'Negative > uses Bearer abc.def',
          status: 'failed',
          failureMessages: [
            'Error: expect(received).toEqual(expected)\n\n'
            + 'Expected: "https://api.test/x?token=leak"\n'
            + 'Received: "sk-secret-123"\n'
            + '    at Object.<anonymous> (tests/contract/negative.contract.test.js:10:5)',
          ],
        },
        { fullName: 'Negative > skipped', status: 'pending' },
      ],
    },
    {
      name: '/repo/tests/contract/broken.contract.test.js',
      status: 'failed',
      startTime: 1100,
      endTime: 1500,
      message: 'Test suite failed to run\n\n    Cannot find module "x-api-key: abc"',
      assertionResults: [],
    },
  ],
};
const ENTRIES = [
  { transport: 'supertest', method: 'GET', path: '/api/ping', status: 200, startedAt: 1100, durationMs: 3 },
  { transport: 'undici', method: 'GET', path: '/api/x', status: 404, startedAt: 1200, durationMs: 4 },
  { transport: 'undici', method: 'GET', path: '/api/y', status: null, startedAt: 1250, durationMs: 9 },
  { transport: 'undici', method: 'GET', path: '/stale', status: 200, startedAt: 10, durationMs: 1 },
];

describe('Unit | Scripts | Contract | Summarize Contract Report', () => {
  it('drops stack frames from failure messages', () => {
    expect(extractFailureHeadline('Error: boom\n\n    at fn (a.js:1:1)\nExpected: 1\nReceived: 2\nMore'))
      .toBe('Error: boom | Expected: 1 | Received: 2');
  });

  it('counts tests, requests, and suites, redacting every failure', () => {
    const summary = buildContractSummary({
      results: RESULTS,
      requestEntries: ENTRIES,
      issues: ['request log mentions Bearer zzz'],
      rootDir: ROOT,
      secretValues: ['sk-secret-123'],
    });

    expect(summary).toMatchObject({
      result: 'failed',
      testFiles: { total: 2, failed: 2 },
      tests: { total: 3, passed: 1, failed: 1, skipped: 1, todo: 0 },
      durationMs: 500,
      requests: {
        total: 3,
        byTransport: { supertest: 1, undici: 2 },
        byStatusClass: { '2xx': 1, '4xx': 1 },
        transportErrors: 1,
      },
      suites: [
        { file: 'tests/contract/negative.contract.test.js', tests: 3, failed: 1, durationMs: 300 },
        { file: 'tests/contract/broken.contract.test.js', tests: 0, failed: 0, durationMs: 400 },
      ],
      issues: ['request log mentions Bearer [REDACTED]'],
    });
    expect(summary.failures).toHaveLength(2);
    expect(summary.failures[0].test).toBe('Negative > uses Bearer [REDACTED]');
    expect(summary.failures[1]).toEqual({
      test: '(test file)',
      message: 'Test suite failed to run | Cannot find module "x-api-key: [REDACTED]',
    });

    const serialized = JSON.stringify(summary);
    ['abc.def', 'token=leak', 'sk-secret-123', 'Object.<anonymous>'].forEach((leak) => {
      expect(serialized).not.toContain(leak);
    });
  });

  it('reports an unknown result when no Jest results are available', () => {
    const lines = formatSummaryLines(buildContractSummary({
      results: null,
      issues: ['Unable to read Jest results jest-results.json'],
      secretValues: [],
    }));

    expect(lines).toEqual(expect.arrayContaining([
      '- Result: unknown',
      '- Tests: 0 total, 0 passed, 0 failed, 0 skipped, 0 todo',
      '- Requests: 0 (transport: none; status: none; transport errors: 0)',
      '- Summary issues: 1',
      '- none',
      '- Unable to read Jest results jest-results.json',
    ]));
  });

  it('formats a markdown summary and caps the failure list', () => {
    const failingTests = Array.from({ length: 12 }, (_, index) => ({
      fullName: `Suite > case ${index + 1}`,
      status: 'failed',
      failureMessages: ['Error: nope'],
    }));
    const lines = formatSummaryLines(buildContractSummary({
      results: { ...RESULTS, testResults: [{ ...RESULTS.testResults[0], assertionResults: failingTests }] },
      rootDir: ROOT,
      secretValues: [],
    }));

    expect(lines[0]).toBe('## API Contract Summary');
    expect(lines).toContain('- tests/contract/negative.contract.test.js: 12 tests, 12 failed, 300ms');
    expect(lines).toContain('- Suite > case 10: Error: nope');
    expect(lines).not.toContain('- Suite > case 11: Error: nope');
    expect(lines).toContain('- ...and 2 more');
  });

  describe('main', () => {
    it('reads results and request logs, then writes stdout and the step summary', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-summary-test-'));
      const resultsPath = path.join(tempDir, 'results.json');
      const requestsDir = path.join(tempDir, 'requests');
      const summaryFile = path.join(tempDir, 'summary.md');
      fs.writeFileSync(resultsPath, JSON.stringify({ ...RESULTS, success: true, testResults: [] }));
      fs.mkdirSync(requestsDir);
      fs.writeFileSync(
        path.join(requestsDir, 'requests-1.ndjson'),
        `${JSON.stringify(ENTRIES[0])}\nnot json\n\n`,
      );
      const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);

      expect(main([
        '--results', resultsPath, '--requests-dir', requestsDir, '--summary-file', summaryFile,
      ])).toBe(0);

      const written = fs.readFileSync(summaryFile, 'utf8');
      expect(written).toContain('- Result: passed');
      expect(written).toContain('- Requests: 1 (transport: supertest 1; status: 2xx 1; transport errors: 0)');
      expect(written).toContain('skipped malformed request log line requests-1.ndjson:2');
      expect(stdout.mock.calls.flat().join('')).toBe(written);

      main(['--results', resultsPath, '--requests-dir', requestsDir, '--json']);
      expect(JSON.parse(stdout.mock.calls.at(-1)[0])).toMatchObject({ result: 'passed' });
    });

    it('tolerates a missing request log directory', () => {
      expect(readRequestLogs(path.join(os.tmpdir(), 'contract-summary-absent'))).toEqual({ entries: [], issues: [] });
    });
  });

  it('parses arguments with defaults', () => {
    expect(parseArgs([])).toEqual({
      resultsPath: DEFAULT_RESULTS_PATH,
      requestsDir: DEFAULT_REQUESTS_DIR,
      summaryFile: null,
      json: false,
    });
    expect(() => parseArgs(['--results'])).toThrow('Missing value for --results');
    expect(() => parseArgs(['--bogus'])).toThrow('Unsupported argument: --bogus');
    expect(() => parseArgs(['toString', 'x'])).toThrow('Unsupported argument: toString');
  });
});
