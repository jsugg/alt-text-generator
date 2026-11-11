const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  evaluateExecutionCoverage,
  formatCoverageLines,
  isCoverageComplete,
  readExecutionCoverage,
} = require('../../../../scripts/postman/execution-coverage');

const request = (id, name, { skippable = false } = {}) => ({
  id,
  name,
  request: { method: 'GET' },
  event: skippable
    ? [{
        listen: 'prerequest',
        script: { exec: ["if (!pm.collectionVariables.get('statusUrl')) {", '  pm.execution.skipRequest();', '}'] },
      }]
    : [],
});

const COLLECTION = {
  item: [
    {
      name: '35 Async Jobs',
      item: [request('start', 'Start job'), request('poll', 'Poll job')],
    },
    {
      name: '40 Negative Paths',
      item: [request('missing-url', 'Missing url'), request('unknown-route', 'Unknown route')],
    },
    {
      name: '90 Provider Validation',
      item: [
        request('single', 'Single image'),
        request('single-status', 'Single image job status', { skippable: true }),
      ],
    },
  ],
};

const executionsOf = (...ids) => ids.map((id) => ({ item: { id } }));

describe('Unit | Scripts | Postman | Execution Coverage', () => {
  it('passes when every selected request executed, counting repeated polls once', () => {
    const coverage = evaluateExecutionCoverage({
      report: {
        collection: COLLECTION,
        run: { executions: executionsOf('start', 'poll', 'poll', 'missing-url', 'unknown-route') },
      },
      folders: ['35 Async Jobs', '40 Negative Paths'],
    });

    expect(coverage).toEqual({
      requiredTotal: 4,
      requiredExecuted: 4,
      skippableTotal: 0,
      unexecuted: [],
      issues: [],
    });
    expect(isCoverageComplete(coverage)).toBe(true);
  });

  it('flags every request of a folder that a run-control stop silently dropped', () => {
    const coverage = evaluateExecutionCoverage({
      report: { collection: COLLECTION, run: { executions: executionsOf('start', 'poll') } },
      folders: ['35 Async Jobs', '40 Negative Paths'],
    });

    expect(coverage.unexecuted).toEqual([
      { folder: '40 Negative Paths', requestName: 'Missing url' },
      { folder: '40 Negative Paths', requestName: 'Unknown route' },
    ]);
    expect(isCoverageComplete(coverage)).toBe(false);
  });

  it('exempts only requests that declare skipRequest in their own pre-request script', () => {
    const coverage = evaluateExecutionCoverage({
      report: { collection: COLLECTION, run: { executions: executionsOf('single') } },
      folders: ['90 Provider Validation'],
    });

    expect(coverage).toMatchObject({ requiredTotal: 1, requiredExecuted: 1, skippableTotal: 1 });
    expect(isCoverageComplete(coverage)).toBe(true);
  });

  it('ignores executions and requests outside the selected folders', () => {
    const coverage = evaluateExecutionCoverage({
      report: { collection: COLLECTION, run: { executions: executionsOf('single', 'missing-url') } },
      folders: ['90 Provider Validation'],
    });

    expect(coverage.requiredTotal).toBe(1);
    expect(isCoverageComplete(coverage)).toBe(true);
  });

  it('matches executions by name when the report collection carries no ids', () => {
    const coverage = evaluateExecutionCoverage({
      report: {
        collection: { item: [{ name: '00 Core', item: [{ name: 'Ping', request: {} }] }] },
        run: { executions: [{ item: { name: 'Ping' } }] },
      },
      folders: ['00 Core'],
    });

    expect(isCoverageComplete(coverage)).toBe(true);
  });

  it('reports selected folders that the report collection does not contain', () => {
    const coverage = evaluateExecutionCoverage({
      report: { collection: COLLECTION, run: { executions: [] } },
      folders: ['99 Missing'],
    });

    expect(coverage.issues).toEqual([
      'selected folder "99 Missing" has no requests in the report collection',
    ]);
    expect(isCoverageComplete(coverage)).toBe(false);
  });

  it('fails closed when the report does not embed the collection', () => {
    const coverage = evaluateExecutionCoverage({
      report: { run: { executions: [] } },
      folders: ['00 Core'],
    });

    expect(coverage.issues).toEqual(['report does not embed the executed collection']);
    expect(isCoverageComplete(coverage)).toBe(false);
  });

  describe('readExecutionCoverage', () => {
    it('evaluates a report file', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-coverage-test-'));
      const reportPath = path.join(tempDir, 'core.json');
      fs.writeFileSync(reportPath, JSON.stringify({
        collection: COLLECTION,
        run: { executions: executionsOf('start', 'poll') },
      }));

      expect(isCoverageComplete(readExecutionCoverage({
        reportPath,
        folders: ['35 Async Jobs'],
      }))).toBe(true);
    });

    it('reports an unreadable report as an issue', () => {
      const coverage = readExecutionCoverage({
        reportPath: path.join(os.tmpdir(), 'execution-coverage-absent.json'),
        folders: ['00 Core'],
      });

      expect(coverage.issues).toEqual([
        expect.stringContaining('unable to read Newman JSON report execution-coverage-absent.json'),
      ]);
    });
  });

  describe('formatCoverageLines', () => {
    it('summarizes coverage, lists unexecuted requests, and truncates long lists', () => {
      const unexecuted = Array.from({ length: 22 }, (_, index) => ({
        folder: '40 Negative Paths',
        requestName: `Request ${index + 1}`,
      }));
      const lines = formatCoverageLines({
        requiredTotal: 30,
        requiredExecuted: 8,
        skippableTotal: 2,
        unexecuted,
        issues: ['example issue'],
      });

      expect(lines[0]).toBe(
        '- request coverage: 8/30 required requests executed (2 declared skippable)',
      );
      expect(lines).toContain('- unexecuted selected requests (22):');
      expect(lines).toContain('  - 40 Negative Paths / Request 20');
      expect(lines).not.toContain('  - 40 Negative Paths / Request 21');
      expect(lines).toContain('  - ...and 2 more');
      expect(lines[lines.length - 1]).toBe('- coverage issue: example issue');
    });
  });
});
