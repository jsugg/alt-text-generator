const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { createClient } = require('redis');

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

const startRedisTestServer = async () => {
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
  hasRedisServerBinary,
  startRedisTestServer,
};
