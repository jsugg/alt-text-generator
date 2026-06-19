const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { createClient } = require('redis');

const REDIS_INTEGRATION_MODE_ENV = 'REDIS_INTEGRATION_MODE';
const REDIS_INTEGRATION_URL_ENV = 'REDIS_INTEGRATION_URL';
const REDIS_INTEGRATION_MODES = Object.freeze({
  OPTIONAL: 'optional',
  REQUIRED: 'required',
});
const REDIS_DOCKER_COMMAND = 'docker compose -f docker-compose.redis.yml --profile redis-test up -d redis-test';
const REDIS_DOCKER_URL = 'redis://127.0.0.1:6380';

const hasRedisServerBinary = () => (
  spawnSync('redis-server', ['--version'], { stdio: 'ignore' }).status === 0
);

const sleep = (durationMs) => new Promise((resolve) => {
  setTimeout(resolve, durationMs);
});

const allocatePort = async () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();

    if (!address || typeof address === 'string') {
      server.close(() => reject(new Error('Failed to allocate a TCP port for Redis tests')));
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(address.port);
    });
  });
});

const waitForRedis = async (redisUrl, {
  pollIntervalMs = 50,
  timeoutMs = 10_000,
} = {}) => {
  const deadline = Date.now() + timeoutMs;
  const attempt = async (lastError) => {
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for Redis test server at ${redisUrl}: ${lastError?.message ?? 'unknown error'}`,
      );
    }

    const client = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 250,
      },
    });
    client.on('error', () => {});

    try {
      await client.connect();
      await client.ping();
      await client.quit();
    } catch (error) {
      if (client.isOpen) {
        await client.quit().catch(() => {});
      }

      await sleep(pollIntervalMs);
      await attempt(error);
    }
  };

  await attempt();
};

const normalizeRedisIntegrationUrl = (value) => {
  const redisUrl = typeof value === 'string' ? value.trim() : '';

  if (!redisUrl) {
    return undefined;
  }

  if (!/^rediss?:\/\//u.test(redisUrl)) {
    throw new Error(
      `${REDIS_INTEGRATION_URL_ENV} must be a redis:// or rediss:// URL`,
    );
  }

  return redisUrl;
};

const resolveRedisIntegrationMode = (envLike = process.env) => {
  if (envLike.CI) {
    return REDIS_INTEGRATION_MODES.REQUIRED;
  }

  const mode = envLike[REDIS_INTEGRATION_MODE_ENV]?.trim()
    || REDIS_INTEGRATION_MODES.OPTIONAL;

  if (!Object.values(REDIS_INTEGRATION_MODES).includes(mode)) {
    throw new Error(
      `${REDIS_INTEGRATION_MODE_ENV} must be "required" or "optional"`,
    );
  }

  return mode;
};

const buildRedisUnavailableDiagnostic = ({ ci, mode }) => [
  `Redis integration tests are in ${mode} mode, but no Redis endpoint is available.`,
  `Set ${REDIS_INTEGRATION_URL_ENV}=redis://127.0.0.1:6379,`,
  `or run "${REDIS_DOCKER_COMMAND}" and set ${REDIS_INTEGRATION_URL_ENV}=${REDIS_DOCKER_URL}.`,
  'Then run npm run test:integration:redis.',
  'Fallback: install redis-server on PATH.',
  ci ? 'CI must provide the pinned Redis service container; this lane must not skip.' : '',
].filter(Boolean).join(' ');

const resolveRedisIntegrationRuntime = ({
  env = process.env,
  hasRedisServerBinaryFn = hasRedisServerBinary,
} = {}) => {
  const mode = resolveRedisIntegrationMode(env);
  const redisUrl = normalizeRedisIntegrationUrl(env[REDIS_INTEGRATION_URL_ENV]);

  if (redisUrl) {
    return {
      diagnostic: `Redis integration enabled through ${REDIS_INTEGRATION_URL_ENV}.`,
      enabled: true,
      mode,
      redisUrl,
      source: 'url',
    };
  }

  if (hasRedisServerBinaryFn()) {
    return {
      diagnostic: 'Redis integration enabled through local redis-server binary.',
      enabled: true,
      mode,
      redisUrl: undefined,
      source: 'binary',
    };
  }

  return {
    diagnostic: buildRedisUnavailableDiagnostic({
      ci: Boolean(env.CI),
      mode,
    }),
    enabled: false,
    mode,
    redisUrl: undefined,
    source: 'missing',
  };
};

const startRedisTestServer = async ({ redisUrl: externalRedisUrl } = {}) => {
  if (externalRedisUrl) {
    try {
      await waitForRedis(externalRedisUrl);
    } catch (error) {
      throw new Error(
        `Redis integration endpoint ${externalRedisUrl} is not reachable: ${error.message}`,
      );
    }

    return {
      dataDir: undefined,
      port: undefined,
      redisUrl: externalRedisUrl,
      stop: async () => {},
    };
  }

  if (!hasRedisServerBinary()) {
    throw new Error('redis-server binary is required to run Redis integration tests');
  }

  const port = await allocatePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alt-text-generator-redis-'));
  const stdout = [];
  const stderr = [];
  const redisUrl = `redis://127.0.0.1:${port}`;
  const child = spawn('redis-server', [
    '--save', '',
    '--appendonly', 'no',
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--dir', dataDir,
    '--dbfilename', 'dump.rdb',
  ], {
    env: {
      ...process.env,
      LANG: 'C',
      LC_ALL: 'C',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    stdout.push(chunk.toString());
  });
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk.toString());
  });

  try {
    await waitForRedis(redisUrl);
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error([
      error.message,
      stdout.length > 0 ? `stdout:\n${stdout.join('')}` : '',
      stderr.length > 0 ? `stderr:\n${stderr.join('')}` : '',
    ].filter(Boolean).join('\n\n'));
  }

  const stop = async () => {
    if (child.exitCode === null && !child.killed) {
      await new Promise((resolve) => {
        const forceKillTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 1_000);

        child.once('exit', () => {
          clearTimeout(forceKillTimer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }

    fs.rmSync(dataDir, { force: true, recursive: true });
  };

  return {
    dataDir,
    port,
    redisUrl,
    stop,
  };
};

module.exports = {
  REDIS_INTEGRATION_MODES,
  REDIS_INTEGRATION_MODE_ENV,
  REDIS_INTEGRATION_URL_ENV,
  hasRedisServerBinary,
  resolveRedisIntegrationRuntime,
  startRedisTestServer,
};
