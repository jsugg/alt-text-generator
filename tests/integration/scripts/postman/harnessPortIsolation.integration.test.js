const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { allocateFreePorts } = require('../../../../scripts/postman/port-allocator');

// Booting the app is out of scope here: the harness runs in plan-only mode so it
// resolves ports + per-run directories and exits before spawning any servers.
// That keeps this proof deterministic while still exercising the real
// allocation, fixed-port preflight, and per-run layout code paths.
jest.setTimeout(30_000);

const ROOT = process.cwd();
const HARNESS_PATH = path.join(ROOT, 'scripts', 'run-postman-harness.js');
const HOST = '127.0.0.1';

/**
 * Builds a child environment with every harness knob cleared so each test
 * controls the mode explicitly regardless of the lane's outer environment.
 *
 * @param {Record<string, string>} overrides
 * @returns {NodeJS.ProcessEnv}
 */
function baseEnv(overrides) {
  const env = { ...process.env };
  [
    'ALLURE_RESULTS_DIR',
    'POSTMAN_REPORTS_DIR',
    'POSTMAN_RUN_ID',
    'POSTMAN_FIXED_PORTS',
    'POSTMAN_PORT_MODE',
    'POSTMAN_APP_HTTP_PORT',
    'POSTMAN_APP_HTTPS_PORT',
    'POSTMAN_FIXTURE_PORT',
    'POSTMAN_AUTH_HTTP_PORT',
    'POSTMAN_AUTH_HTTPS_PORT',
  ].forEach((key) => {
    delete env[key];
  });

  return { ...env, POSTMAN_HARNESS_PLAN_ONLY: '1', ...overrides };
}

/**
 * Runs the harness in plan-only mode and resolves with the captured output.
 *
 * @param {Record<string, string>} overrides
 * @returns {Promise<{ code: number|null, stderr: string, stdout: string }>}
 */
function runHarness(overrides) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HARNESS_PATH, 'smoke'], {
      cwd: ROOT,
      env: baseEnv(overrides),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stderr, stdout }));
  });
}

/**
 * @param {string} stdout
 * @returns {object}
 */
function parsePlan(stdout) {
  const match = stdout.match(/^HARNESS_PLAN (.*)$/mu);
  if (!match) {
    throw new Error(`No HARNESS_PLAN line in harness output:\n${stdout}`);
  }

  return JSON.parse(match[1]);
}

function occupyPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: HOST, port: 0, exclusive: true }, () => {
      resolve({
        close: () => new Promise((done) => server.close(() => done())),
        port: server.address().port,
      });
    });
  });
}

describe('Integration | Scripts | Postman | Harness Port & Report Isolation', () => {
  let reportsDir;

  beforeEach(async () => {
    reportsDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'harness-isolation-'));
  });

  afterEach(async () => {
    await fsp.rm(reportsDir, { force: true, recursive: true });
  });

  it('keeps two concurrent dynamic smoke runs isolated by run directory', async () => {
    const [planA, planB] = (await Promise.all([
      runHarness({ POSTMAN_REPORTS_DIR: reportsDir }),
      runHarness({ POSTMAN_REPORTS_DIR: reportsDir }),
    ])).map((result) => {
      expect(result.code).toBe(0);
      return parsePlan(result.stdout);
    });

    // Same configured base, but each run lands in its own per-run directory.
    expect(planA.portMode).toBe('dynamic');
    expect(planA.baseDir).toBe(planB.baseDir);
    expect(planA.runId).not.toBe(planB.runId);
    expect(planA.runDir).not.toBe(planB.runDir);

    // No report, diagnostics, meta, or Allure path is shared between the runs.
    ['runDir', 'reportsDir', 'diagnosticsDir', 'metaDir', 'allureResultsDir'].forEach((key) => {
      expect(planA[key]).not.toBe(planB[key]);
    });

    // smoke needs the auth harness, so all five roles are allocated and distinct.
    [planA, planB].forEach((plan) => {
      const portValues = Object.values(plan.ports);
      expect(Object.keys(plan.ports).sort()).toEqual(
        ['appHttp', 'appHttps', 'authHttp', 'authHttps', 'fixture'],
      );
      expect(new Set(portValues).size).toBe(5);
      expect(plan.allureResultsDir).toBe(path.join(plan.runDir, 'allure-results'));
    });

    // The per-run metadata + resolved environment file are written to disk.
    [planA, planB].forEach((plan) => {
      const resolvedPorts = JSON.parse(
        fs.readFileSync(path.join(plan.metaDir, 'resolved-ports.json'), 'utf8'),
      );
      expect(resolvedPorts.ports).toEqual(plan.ports);

      const resolvedEnv = JSON.parse(fs.readFileSync(plan.resolvedEnvPath, 'utf8'));
      const baseUrl = resolvedEnv.values.find((entry) => entry.key === 'baseUrl');
      expect(baseUrl.value).toBe(`https://${HOST}:${plan.ports.appHttps}`);
    });
  });

  it('fails fixed-port mode fast with diagnostics when a port is in use', async () => {
    const held = await occupyPort();
    const [appHttps, fixture, authHttp, authHttps] = await allocateFreePorts(4, { host: HOST });

    try {
      const result = await runHarness({
        POSTMAN_REPORTS_DIR: reportsDir,
        POSTMAN_FIXED_PORTS: '1',
        POSTMAN_APP_HTTP_PORT: String(held.port),
        POSTMAN_APP_HTTPS_PORT: String(appHttps),
        POSTMAN_FIXTURE_PORT: String(fixture),
        POSTMAN_AUTH_HTTP_PORT: String(authHttp),
        POSTMAN_AUTH_HTTPS_PORT: String(authHttps),
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('already in use');
      expect(result.stderr).toContain(`appHttp: ${HOST}:${held.port}`);
      expect(result.stderr).toContain('POSTMAN_FIXED_PORTS');
    } finally {
      await held.close();
    }
  });

  it('runs fixed-port mode when the requested ports are free', async () => {
    const [appHttp, appHttps, fixture, authHttp, authHttps] = await allocateFreePorts(5, {
      host: HOST,
    });

    const result = await runHarness({
      POSTMAN_REPORTS_DIR: reportsDir,
      POSTMAN_FIXED_PORTS: '1',
      POSTMAN_APP_HTTP_PORT: String(appHttp),
      POSTMAN_APP_HTTPS_PORT: String(appHttps),
      POSTMAN_FIXTURE_PORT: String(fixture),
      POSTMAN_AUTH_HTTP_PORT: String(authHttp),
      POSTMAN_AUTH_HTTPS_PORT: String(authHttps),
    });

    expect(result.code).toBe(0);
    const plan = parsePlan(result.stdout);
    expect(plan.portMode).toBe('fixed');
    expect(plan.ports).toEqual({
      appHttp, appHttps, fixture, authHttp, authHttps,
    });
  });
});
