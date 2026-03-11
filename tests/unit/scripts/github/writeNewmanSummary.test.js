const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildSummary,
  formatSummaryLines,
  parseArgs,
} = require('../../../../scripts/github/write-newman-summary');

const createTempDir = () => fs.mkdtempSync(
  path.join(os.tmpdir(), 'newman-summary-test-'),
);

describe('Unit | Scripts | GitHub | Write Newman Summary', () => {
  it('parses supported CLI arguments', () => {
    expect(parseArgs([
      '--reports-dir',
      '/tmp/reports',
      '--collection-path',
      '/tmp/collection.json',
      '--summary-file',
      '/tmp/summary.md',
    ])).toEqual({
      reportsDir: '/tmp/reports',
      collectionPath: '/tmp/collection.json',
      summaryFile: '/tmp/summary.md',
    });
  });

  it('rejects unsupported CLI arguments', () => {
    expect(() => parseArgs(['--nope', 'value'])).toThrow('Unsupported argument: --nope');
  });

  it('builds an aggregate summary from Newman JSON reports', () => {
    const tempDir = createTempDir();
    const reportsDir = path.join(tempDir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const collectionPath = path.join(tempDir, 'collection.json');
    fs.writeFileSync(collectionPath, JSON.stringify({
      item: [
        {
          name: '00 Core Smoke',
          item: [
            { id: 'ping-id', name: 'Ping' },
          ],
        },
        {
          name: '40 Negative Paths',
          item: [
            { id: 'missing-url-id', name: 'Scraper missing url' },
          ],
        },
      ],
    }), 'utf8');

    fs.writeFileSync(path.join(reportsDir, 'smoke.json'), JSON.stringify({
      run: {
        stats: {
          requests: { total: 1 },
          assertions: { total: 4, failed: 0 },
        },
        timings: {
          started: 100,
          completed: 220,
        },
        executions: [
          {
            item: { id: 'ping-id', name: 'Ping' },
            assertions: [
              { assertion: 'returns 200' },
              { assertion: 'returns pong' },
              { assertion: 'not 5xx' },
              { assertion: 'fast enough' },
            ],
            response: { responseTime: 90 },
          },
        ],
        failures: [],
      },
    }), 'utf8');

    fs.writeFileSync(path.join(reportsDir, 'core.json'), JSON.stringify({
      run: {
        stats: {
          requests: { total: 1 },
          assertions: { total: 3, failed: 1 },
        },
        timings: {
          started: 300,
          completed: 510,
        },
        executions: [
          {
            item: { id: 'missing-url-id', name: 'Scraper missing url' },
            assertions: [
              { assertion: 'returns 400' },
              { assertion: 'matches error', error: { message: 'expected 400' } },
              { assertion: 'has requestId' },
            ],
            response: { responseTime: 12 },
          },
        ],
        failures: [
          {
            source: {
              id: 'missing-url-id',
              name: 'Scraper missing url',
            },
            error: {
              message: 'expected 400',
            },
          },
        ],
      },
    }), 'utf8');

    const { aggregate, lines } = buildSummary({
      reportsDir,
      collectionPath,
    });

    expect(aggregate.reportCount).toBe(2);
    expect(aggregate.requestTotal).toBe(2);
    expect(aggregate.assertionTotal).toBe(7);
    expect(aggregate.assertionFailed).toBe(1);
    expect(aggregate.failures).toEqual([
      {
        source: 'core',
        folder: '40 Negative Paths',
        requestName: 'Scraper missing url',
        message: 'expected 400',
      },
    ]);
    expect(Array.from(aggregate.folders.values()).sort((left, right) => (
      left.folder.localeCompare(right.folder)
    ))).toEqual([
      {
        folder: '00 Core Smoke',
        requestTotal: 1,
        assertionTotal: 4,
        assertionFailed: 0,
        totalResponseTimeMs: 90,
        maxResponseTimeMs: 90,
      },
      {
        folder: '40 Negative Paths',
        requestTotal: 1,
        assertionTotal: 3,
        assertionFailed: 1,
        totalResponseTimeMs: 12,
        maxResponseTimeMs: 12,
      },
    ]);
    expect(lines).toContain('- Reports discovered: 2');
    expect(lines).toContain('- Reports parsed: 2');
    expect(lines).toContain('- smoke: 1 requests, 4 assertions, 0 failed, 120ms');
    expect(lines).toContain('- 00 Core Smoke: 1 requests, 4 assertions, 0 failed, avg 90ms, max 90ms');
    expect(lines).toContain('- [core] 40 Negative Paths / Scraper missing url: expected 400');
  });

  it('falls back to request names when collection ids are unavailable', () => {
    const tempDir = createTempDir();
    const reportsDir = path.join(tempDir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const collectionPath = path.join(tempDir, 'collection.json');
    fs.writeFileSync(collectionPath, JSON.stringify({
      item: [
        {
          name: '90 Live Provider Validation',
          item: [
            {
              name: 'Live clip single image',
              request: {
                method: 'GET',
              },
            },
          ],
        },
      ],
    }), 'utf8');

    fs.writeFileSync(path.join(reportsDir, 'live-provider.json'), JSON.stringify({
      run: {
        stats: {
          requests: { total: 1 },
          assertions: { total: 1, failed: 1 },
        },
        timings: {
          started: 10,
          completed: 40,
        },
        executions: [
          {
            item: {
              id: 'generated-runtime-id',
              name: 'Live clip single image',
            },
            assertions: [
              { assertion: 'returns 200', error: { message: 'expected 200' } },
            ],
            response: { responseTime: 25 },
          },
        ],
        failures: [
          {
            source: {
              id: 'generated-runtime-id',
              name: 'Live clip single image',
            },
            error: {
              message: 'expected 200',
            },
          },
        ],
      },
    }), 'utf8');

    const { aggregate } = buildSummary({
      reportsDir,
      collectionPath,
    });

    expect(Array.from(aggregate.folders.values())).toEqual([
      {
        folder: '90 Live Provider Validation',
        requestTotal: 1,
        assertionTotal: 1,
        assertionFailed: 1,
        totalResponseTimeMs: 25,
        maxResponseTimeMs: 25,
      },
    ]);
    expect(aggregate.failures).toEqual([
      {
        source: 'live-provider',
        folder: '90 Live Provider Validation',
        requestName: 'Live clip single image',
        message: 'expected 200',
      },
    ]);
  });

  it('formats a no-failures summary with an explicit none marker', () => {
    const lines = formatSummaryLines({
      reportCount: 1,
      requestTotal: 2,
      assertionTotal: 6,
      assertionFailed: 0,
      failures: [],
      folders: new Map([
        ['00 Core Smoke', {
          folder: '00 Core Smoke',
          requestTotal: 2,
          assertionTotal: 6,
          assertionFailed: 0,
          totalResponseTimeMs: 300,
          maxResponseTimeMs: 180,
        }],
      ]),
      reports: [
        {
          label: 'smoke',
          requestTotal: 2,
          assertionTotal: 6,
          assertionFailed: 0,
          durationMs: 150,
        },
      ],
    }, [], 1);

    expect(lines.slice(-1)[0]).toBe('- none');
  });

  it('builds a fallback summary when no Newman reports are present', () => {
    const tempDir = createTempDir();
    const collectionPath = path.join(tempDir, 'collection.json');
    fs.writeFileSync(collectionPath, JSON.stringify({ item: [] }), 'utf8');

    const { aggregate, issues, lines } = buildSummary({
      reportsDir: path.join(tempDir, 'missing-reports'),
      collectionPath,
    });

    expect(aggregate.reportCount).toBe(0);
    expect(issues).toEqual([
      expect.stringContaining('Unable to read Newman reports from'),
      'No Newman JSON reports were available. The Newman run may have exited before reporter output was written.',
    ]);
    expect(lines).toContain('- Reports discovered: 0');
    expect(lines).toContain('- Reports parsed: 0');
    expect(lines).toContain('- Summary issues: 2');
    expect(lines).toContain('### Summary Issues');
  });

  it('keeps summarizing valid reports when one report is malformed', () => {
    const tempDir = createTempDir();
    const reportsDir = path.join(tempDir, 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });

    const collectionPath = path.join(tempDir, 'collection.json');
    fs.writeFileSync(collectionPath, JSON.stringify({
      item: [
        {
          name: '00 Core Smoke',
          item: [
            { id: 'ping-id', name: 'Ping' },
          ],
        },
      ],
    }), 'utf8');

    fs.writeFileSync(path.join(reportsDir, 'good.json'), JSON.stringify({
      run: {
        stats: {
          requests: { total: 1 },
          assertions: { total: 1, failed: 0 },
        },
        timings: {
          started: 1,
          completed: 10,
        },
        executions: [
          {
            item: { id: 'ping-id', name: 'Ping' },
            assertions: [{ assertion: 'returns 200' }],
            response: { responseTime: 8 },
          },
        ],
        failures: [],
      },
    }), 'utf8');
    fs.writeFileSync(path.join(reportsDir, 'broken.json'), '{not-json', 'utf8');

    const { aggregate, issues, lines } = buildSummary({
      reportsDir,
      collectionPath,
    });

    expect(aggregate.reportCount).toBe(1);
    expect(aggregate.requestTotal).toBe(1);
    expect(issues).toEqual([
      expect.stringContaining('Unable to parse Newman JSON report broken.json'),
    ]);
    expect(lines).toContain('- Reports discovered: 2');
    expect(lines).toContain('- Reports parsed: 1');
    expect(lines).toContain('- Summary issues: 1');
    expect(lines).toContain('- good: 1 requests, 1 assertions, 0 failed, 9ms');
  });
});
