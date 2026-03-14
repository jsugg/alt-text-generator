const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildFailureDiagnosticLines,
} = require('../../../../scripts/postman/newman-runner');

const createTempDir = () => fs.mkdtempSync(
  path.join(os.tmpdir(), 'newman-runner-test-'),
);

describe('Unit | Scripts | Postman | Newman Runner', () => {
  it('formats actionable diagnostics from a Newman JSON report', () => {
    const tempDir = createTempDir();
    const collectionPath = path.join(tempDir, 'collection.json');
    const reportsDir = path.join(tempDir, 'reports');
    const reportPath = path.join(reportsDir, 'live-provider-openai.json');

    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(collectionPath, JSON.stringify({
      item: [
        {
          name: '90 Provider Validation',
          item: [
            {
              id: 'provider-single-image',
              name: 'Provider validation single image',
            },
          ],
        },
      ],
    }), 'utf8');
    fs.writeFileSync(reportPath, JSON.stringify({
      run: {
        stats: {
          requests: { total: 1 },
          assertions: { total: 2, failed: 1 },
        },
        timings: {
          started: 100,
          completed: 175,
        },
        executions: [
          {
            item: {
              id: 'provider-single-image',
              name: 'Provider validation single image',
            },
            assertions: [
              { assertion: 'returns 200', error: { message: 'expected 200 but got 500' } },
            ],
            response: {
              responseTime: 75,
            },
          },
        ],
        failures: [
          {
            source: {
              id: 'provider-single-image',
              name: 'Provider validation single image',
            },
            error: {
              message: 'expected 200 but got 500',
            },
          },
        ],
      },
    }), 'utf8');

    const lines = buildFailureDiagnosticLines({
      collectionPath,
      cwd: tempDir,
      exitCode: 1,
      folders: ['90 Provider Validation'],
      label: 'live-provider-openai',
      reportPath,
    });

    expect(lines[0]).toBe('[newman] live-provider-openai failed with exit code 1');
    expect(lines).toContain('- folders: 90 Provider Validation');
    expect(lines).toContain(`- report: ${path.join('reports', 'live-provider-openai.json')}`);
    expect(lines).toContain('- stats: 1 requests, 2 assertions, 1 failed, 75ms');
    expect(lines).toContain('- top failures:');
    expect(lines).toContain(
      '  - 90 Provider Validation / Provider validation single image: expected 200 but got 500',
    );
  });

  it('reports when Newman exits before writing a JSON report', () => {
    const tempDir = createTempDir();
    const reportPath = path.join(tempDir, 'reports', 'missing.json');

    const lines = buildFailureDiagnosticLines({
      collectionPath: path.join(tempDir, 'collection.json'),
      cwd: tempDir,
      exitCode: 1,
      folders: ['90 Provider Validation'],
      label: 'live-provider-openai',
      reportPath,
    });

    expect(lines).toContain('- summary: no JSON report was produced; inspect Newman CLI output above.');
  });
});
