const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { listReportPaths } = require('../../../../scripts/postman/newman-summary');

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'newman-discovery-'));

describe('Unit | Scripts | Postman | Newman Summary Discovery', () => {
  it('discovers reports nested in a per-run directory while skipping metadata folders', () => {
    const baseDir = createTempDir();
    const runDir = path.join(baseDir, '2026-06-18T00-00-00-000Z-pid42-abc123');
    fs.mkdirSync(path.join(runDir, 'meta'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'diagnostics'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'allure-results'), { recursive: true });

    fs.writeFileSync(path.join(runDir, 'smoke.json'), '{}');
    fs.writeFileSync(path.join(runDir, 'routing.json'), '{}');
    // Metadata and Allure JSON must never be mistaken for Newman reports.
    fs.writeFileSync(path.join(runDir, 'meta', 'resolved-ports.json'), '{}');
    fs.writeFileSync(path.join(runDir, 'meta', 'newman-environment.resolved.json'), '{}');
    fs.writeFileSync(path.join(runDir, 'allure-results', 'result.json'), '{}');
    fs.writeFileSync(path.join(runDir, 'diagnostics', 'app.log'), 'log');

    expect(listReportPaths(baseDir)).toEqual([
      path.join(runDir, 'routing.json'),
      path.join(runDir, 'smoke.json'),
    ]);
  });

  it('still discovers flat top-level reports', () => {
    const reportsDir = createTempDir();
    fs.writeFileSync(path.join(reportsDir, 'core.json'), '{}');
    fs.writeFileSync(path.join(reportsDir, 'smoke.json'), '{}');

    expect(listReportPaths(reportsDir)).toEqual([
      path.join(reportsDir, 'core.json'),
      path.join(reportsDir, 'smoke.json'),
    ]);
  });
});
