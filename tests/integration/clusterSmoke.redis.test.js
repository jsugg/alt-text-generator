const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const {
  resolveRedisIntegrationRuntime,
  startRedisTestServer,
} = require('../helpers/redisTestServer');

// QE-016 / ATG-QE-03A: a low-cost process-level smoke that boots the real app in
// cluster mode (WORKER_COUNT=2) against a shared Redis. It proves the cluster
// starts, serves traffic, enforces ONE shared rate-limit budget across workers
// (only possible with shared Redis state), and shuts down gracefully on SIGTERM.

const ROOT_DIR = path.resolve(__dirname, '../..');
const APP_ENTRYPOINT = path.join(ROOT_DIR, 'src', 'app.js');
const PID_FILE = path.join(ROOT_DIR, 'alt-text-generator.pid');
const HEALTHY_DEADLINE_MS = 20_000;
const SHUTDOWN_DEADLINE_MS = 10_000;
const API_RATE_LIMIT_MAX = 2;
const RATE_LIMIT_BURST = 5;

const redisRuntime = resolveRedisIntegrationRuntime();

// The full 2-worker process boot is environment-sensitive: cluster fork() plus
// heavy module load can hang on some local sandboxes (observed on WSL2), while
// single-process boot is unaffected. It runs automatically in CI (real Linux)
// and is opt-in locally via CLUSTER_SMOKE=1, so the standard local redis lane
// stays fast and green.
const clusterSmokeOptIn = Boolean(process.env.CI) || process.env.CLUSTER_SMOKE === '1';
const clusterSmokeEnabled = redisRuntime.enabled && clusterSmokeOptIn;
const describeClusterSmoke = clusterSmokeEnabled ? describe : describe.skip;

jest.setTimeout(60_000);

if (!redisRuntime.enabled) {
  process.stderr.write(`[redis integration] ${redisRuntime.diagnostic}\n`);
}

if (!redisRuntime.enabled && redisRuntime.mode === 'required') {
  throw new Error(redisRuntime.diagnostic);
}

if (redisRuntime.enabled && !clusterSmokeOptIn) {
  process.stderr.write(
    '[cluster smoke] Skipping WORKER_COUNT=2 cluster smoke. '
    + 'Set CLUSTER_SMOKE=1 to run it locally; it always runs in CI.\n',
  );
}

const sleep = (durationMs) => new Promise((resolve) => {
  setTimeout(resolve, durationMs);
});

const allocatePort = async () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    server.close((error) => (error ? reject(error) : resolve(port)));
  });
});

const httpGet = (port, requestPath) => new Promise((resolve, reject) => {
  const request = http.request(
    {
      host: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET',
      // Cluster app sits behind a TLS-terminating proxy in production; the smoke
      // talks to the plain HTTP listener and presents the same forwarded header.
      headers: { 'X-Forwarded-Proto': 'https' },
    },
    (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    },
  );

  request.once('error', reject);
  request.end();
});

describeClusterSmoke('Integration | Cluster Smoke (WORKER_COUNT=2)', () => {
  let redisServer;
  let child;
  let stdout;
  let stderr;
  let savedPidFile;

  const collectedOutput = () => [
    stdout.length > 0 ? `stdout:\n${stdout.join('')}` : '',
    stderr.length > 0 ? `stderr:\n${stderr.join('')}` : '',
  ].filter(Boolean).join('\n\n');

  const waitForHealthy = async (port, deadline) => {
    if (Date.now() >= deadline) {
      throw new Error(`Cluster did not report healthy in time.\n\n${collectedOutput()}`);
    }

    if (child.exitCode !== null) {
      throw new Error(`Cluster process exited early (code ${child.exitCode}).\n\n${collectedOutput()}`);
    }

    try {
      const response = await httpGet(port, '/api/health');
      if (response.status === 200) {
        return response;
      }
    } catch {
      // Listener is not accepting connections yet; retry until the deadline.
    }

    await sleep(200);
    return waitForHealthy(port, deadline);
  };

  beforeAll(async () => {
    redisServer = await startRedisTestServer({ redisUrl: redisRuntime.redisUrl });

    // The primary writes a gitignored pid file at the repo root; snapshot it so
    // the smoke leaves the working tree exactly as it found it.
    savedPidFile = fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE) : null;
  });

  afterAll(async () => {
    if (child && child.pid) {
      // Always sweep the whole process group: even after the primary exits
      // cleanly, reap any forked worker that outlived it. ESRCH means the group
      // is already gone, which is the success case.
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Group already gone.
      }

      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();
    }

    if (savedPidFile === null) {
      fs.rmSync(PID_FILE, { force: true });
    } else {
      fs.writeFileSync(PID_FILE, savedPidFile);
    }

    await redisServer?.stop();
  });

  it('boots two workers on shared Redis, shares the rate-limit budget, and shuts down cleanly', async () => {
    stdout = [];
    stderr = [];
    const httpPort = await allocatePort();
    const tlsPort = await allocatePort();
    const redisPrefix = `cluster-smoke:${randomUUID()}:`;

    child = spawn(process.execPath, [APP_ENTRYPOINT], {
      cwd: ROOT_DIR,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        WORKER_COUNT: '2',
        PORT: String(httpPort),
        TLS_PORT: String(tlsPort),
        CLUSTER_SHUTDOWN_TIMEOUT_MS: '2000',
        RATE_LIMIT_STORE: 'redis',
        RATE_LIMIT_REDIS_URL: redisServer.redisUrl,
        REDIS_URL: redisServer.redisUrl,
        RATE_LIMIT_REDIS_PREFIX: `${redisPrefix}rl:`,
        DESCRIPTION_JOB_REDIS_PREFIX: `${redisPrefix}jobs:`,
        RATE_LIMIT_MAX: String(API_RATE_LIMIT_MAX),
        RATE_LIMIT_WINDOW_MS: '60000',
        STATUS_RATE_LIMIT_MAX: '1000',
        STATUS_RATE_LIMIT_WINDOW_MS: '60000',
        REPLICATE_API_TOKEN: 'test-token',
        LOG_LEVEL: 'info',
      },
    });
    child.stdout.on('data', (chunk) => stdout.push(chunk.toString()));
    child.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

    // 1. Startup: the cluster becomes healthy and logged a 2-worker primary.
    await waitForHealthy(httpPort, Date.now() + HEALTHY_DEADLINE_MS);
    const bootLog = stdout.join('');
    expect(bootLog).toContain('Starting cluster runtime');
    expect(bootLog).toContain('"workerCount":2');

    // 2. Shared limiter: a concurrent burst across the cluster admits exactly the
    // shared budget. Without shared Redis state each worker would keep its own
    // counter and admit more than API_RATE_LIMIT_MAX.
    const burst = await Promise.all(
      Array.from({ length: RATE_LIMIT_BURST }, () => httpGet(httpPort, '/api/v1/does-not-exist')),
    );
    const statuses = burst.map((response) => response.status);
    const admitted = statuses.filter((status) => status !== 429);
    const limited = statuses.filter((status) => status === 429);

    expect(admitted).toHaveLength(API_RATE_LIMIT_MAX);
    expect(limited).toHaveLength(RATE_LIMIT_BURST - API_RATE_LIMIT_MAX);
    admitted.forEach((status) => expect(status).toBe(404));

    // 3. Graceful shutdown: SIGTERM to the primary drains the cluster and exits 0.
    const exitInfo = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Cluster did not shut down in time.\n\n${collectedOutput()}`));
      }, SHUTDOWN_DEADLINE_MS);
      timer.unref();

      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
      child.kill('SIGTERM');
    });

    expect(exitInfo.code).toBe(0);
    expect(stdout.join('')).toContain('Primary shutting down cluster');
  });
});
