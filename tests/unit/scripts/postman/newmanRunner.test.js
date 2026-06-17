const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const path = require('node:path');

const {
  buildFailureDiagnosticLines,
  emitDiagnosticLines,
} = require('../../../../scripts/postman/newman-runner');

const createTempDir = () => fs.mkdtempSync(
  path.join(os.tmpdir(), 'newman-runner-test-'),
);

/**
 * @param {{
 *   rmSyncImpl?: typeof fs.rmSync,
 *   spawnImpl?: jest.Mock,
 * }} [options]
 * @returns {object}
 */
function loadRunnerModule(options = {}) {
  const { rmSyncImpl, spawnImpl = jest.fn() } = options;
  let runnerModule;

  jest.isolateModules(() => {
    jest.doMock('node:child_process', () => ({
      spawn: spawnImpl,
    }));

    if (rmSyncImpl) {
      jest.doMock('node:fs', () => ({
        ...jest.requireActual('node:fs'),
        rmSync: rmSyncImpl,
      }));
    }

    runnerModule = require('../../../../scripts/postman/newman-runner');
  });

  return runnerModule;
}

describe('Unit | Scripts | Postman | Newman Runner', () => {
  afterEach(() => {
    jest.resetModules();
    jest.unmock('node:child_process');
    jest.unmock('node:fs');
  });

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
    expect(lines).toContain('- failure categories: 1 HTTP contract, 0 performance budget');
    expect(lines).toContain('- top HTTP contract failures:');
    expect(lines).toContain(
      '  - 90 Provider Validation / Provider validation single image (returns 200): expected 200 but got 500',
    );
    expect(lines).toContain('- top performance budget failures: none');
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

  it('reports missing failures and collection-summary issues when the JSON report is still parseable', () => {
    const tempDir = createTempDir();
    const reportPath = path.join(tempDir, 'reports', 'missing-collection.json');

    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify({
      run: {
        stats: {
          requests: { total: 1 },
          assertions: { total: 1, failed: 0 },
        },
        executions: [
          {
            item: {
              id: 'provider-single-image',
              name: 'Provider validation single image',
            },
            assertions: [{ assertion: 'returns 200' }],
            response: { responseTime: 22 },
          },
        ],
        failures: [],
      },
    }), 'utf8');

    const lines = buildFailureDiagnosticLines({
      collectionPath: path.join(tempDir, 'missing-collection.json'),
      cwd: tempDir,
      exitCode: null,
      folders: ['90 Provider Validation'],
      label: 'provider-integration-openai',
      reportPath,
    });

    expect(lines[0]).toBe('[newman] provider-integration-openai failed with exit code unknown');
    expect(lines).toContain('- stats: 1 requests, 1 assertions, 0 failed, 0ms');
    expect(lines).toContain('- failure categories: 0 HTTP contract, 0 performance budget');
    expect(lines).toContain('- top HTTP contract failures: none');
    expect(lines).toContain('- top performance budget failures: none');
    expect(lines).toContain('- summary issues:');
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Unable to read collection metadata from'),
    ]));
  });

  it('emits grouped diagnostic lines for GitHub Actions logs', () => {
    const writes = [];

    emitDiagnosticLines([
      '[newman] provider-integration-openai failed with exit code 1',
      '- top failures: none',
    ], (line) => writes.push(line));

    expect(writes).toEqual([
      '::group::Newman Failure Diagnostics',
      '[newman] provider-integration-openai failed with exit code 1',
      '- top failures: none',
      '::endgroup::',
    ]);
  });

  it('logs start and completion details when the Newman command succeeds', async () => {
    const tempDir = createTempDir();
    const reportPath = path.join(tempDir, 'reports', 'provider-integration-openai.json');
    const child = new EventEmitter();
    const spawnMock = jest.fn(() => {
      process.nextTick(() => child.emit('exit', 0));
      return child;
    });
    const writes = [];
    const { runNewmanCommand } = loadRunnerModule({ spawnImpl: spawnMock });

    await runNewmanCommand({
      args: ['npx', 'newman', 'run'],
      collectionPath: path.join(tempDir, 'collection.json'),
      cwd: tempDir,
      folders: ['90 Provider Validation'],
      label: 'provider-integration-openai',
      reportPath,
      writeLog: (line) => writes.push(line),
    });

    expect(spawnMock).toHaveBeenCalledWith('npx', ['newman', 'run'], {
      cwd: tempDir,
      env: process.env,
      stdio: 'inherit',
    });
    expect(writes[0]).toBe(
      `[newman] starting provider-integration-openai for 90 Provider Validation -> ${path.join('reports', 'provider-integration-openai.json')}`,
    );
    expect(writes[writes.length - 1]).toBe('[newman] provider-integration-openai completed successfully');
  });

  it('prints grouped diagnostics and rejects with the report path when the Newman command fails', async () => {
    const tempDir = createTempDir();
    const collectionPath = path.join(tempDir, 'collection.json');
    const reportPath = path.join(tempDir, 'reports', 'provider-integration-openai.json');
    const child = new EventEmitter();
    const spawnMock = jest.fn(() => {
      process.nextTick(() => {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
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
              assertions: { total: 1, failed: 1 },
            },
            timings: {
              started: 100,
              completed: 180,
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
                response: { responseTime: 80 },
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
        child.emit('exit', 1);
      });
      return child;
    });
    const writes = [];
    const { runNewmanCommand } = loadRunnerModule({ spawnImpl: spawnMock });

    await expect(runNewmanCommand({
      args: ['npx', 'newman', 'run'],
      collectionPath,
      cwd: tempDir,
      folders: ['90 Provider Validation'],
      label: 'provider-integration-openai',
      reportPath,
      writeLog: (line) => writes.push(line),
    })).rejects.toThrow(
      `[newman] provider-integration-openai failed with exit code 1 (report: ${path.join('reports', 'provider-integration-openai.json')})`,
    );

    expect(writes).toEqual(expect.arrayContaining([
      '::group::Newman Failure Diagnostics',
      '- top HTTP contract failures:',
      '  - 90 Provider Validation / Provider validation single image (returns 200): expected 200 but got 500',
      '- top performance budget failures: none',
      '::endgroup::',
    ]));
  });

  it('captures Newman and child process diagnostic logs on failure', async () => {
    const tempDir = createTempDir();
    const collectionPath = path.join(tempDir, 'collection.json');
    const reportPath = path.join(tempDir, 'reports', 'smoke.json');
    const newmanLogPath = path.join(tempDir, 'reports', 'diagnostics', 'newman-smoke.log');
    const appLogPath = path.join(tempDir, 'reports', 'diagnostics', 'app.log');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const spawnMock = jest.fn(() => {
      process.nextTick(() => {
        fs.mkdirSync(path.dirname(reportPath), { recursive: true });
        fs.mkdirSync(path.dirname(appLogPath), { recursive: true });
        fs.writeFileSync(appLogPath, '[app] route failed\n', 'utf8');
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
        fs.writeFileSync(reportPath, JSON.stringify({
          run: {
            stats: {
              requests: { total: 1 },
              assertions: { total: 1, failed: 1 },
            },
            timings: {
              started: 100,
              completed: 150,
            },
            executions: [
              {
                item: {
                  id: 'ping-id',
                  name: 'Ping',
                },
                assertions: [
                  {
                    assertion: '[performance] response time is below 1ms',
                    error: { message: 'expected 25 to be below 1' },
                  },
                ],
                response: { responseTime: 25 },
              },
            ],
            failures: [
              {
                source: {
                  id: 'ping-id',
                  name: 'Ping',
                },
                error: {
                  message: 'expected 25 to be below 1',
                },
              },
            ],
          },
        }), 'utf8');
        child.stdout.emit('data', Buffer.from('newman stdout\n'));
        child.stderr.emit('data', Buffer.from('newman stderr\n'));
        child.emit('exit', 1);
      });
      return child;
    });
    const writes = [];
    const { runNewmanCommand } = loadRunnerModule({ spawnImpl: spawnMock });
    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await expect(runNewmanCommand({
        args: ['npx', 'newman', 'run'],
        collectionPath,
        cwd: tempDir,
        diagnosticLogs: [{ label: 'app', path: appLogPath }],
        folders: ['00 Core Smoke'],
        label: 'smoke',
        newmanLogPath,
        reportPath,
        writeLog: (line) => writes.push(line),
      })).rejects.toThrow(
        `[newman] smoke failed with exit code 1 (report: ${path.join('reports', 'smoke.json')})`,
      );
    } finally {
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();
    }

    expect(spawnMock).toHaveBeenCalledWith('npx', ['newman', 'run'], {
      cwd: tempDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(fs.readFileSync(newmanLogPath, 'utf8')).toContain('newman stderr');
    expect(writes).toEqual(expect.arrayContaining([
      '- failure categories: 0 HTTP contract, 1 performance budget',
      '- top HTTP contract failures: none',
      '- top performance budget failures:',
      '  - 00 Core Smoke / Ping ([performance] response time is below 1ms): expected 25 to be below 1',
      '- diagnostic logs:',
      `  - newman: ${path.join('reports', 'diagnostics', 'newman-smoke.log')}`,
      '    newman stdout',
      '    newman stderr',
      `  - app: ${path.join('reports', 'diagnostics', 'app.log')}`,
      '    [app] route failed',
    ]));
  });

  it('ignores missing stale reports before spawning Newman', async () => {
    const child = new EventEmitter();
    const spawnMock = jest.fn(() => {
      process.nextTick(() => child.emit('exit', 0));
      return child;
    });
    const rmSyncMock = jest.fn(() => {
      const error = new Error('missing');
      error.code = 'ENOENT';
      throw error;
    });
    const { runNewmanCommand } = loadRunnerModule({
      rmSyncImpl: rmSyncMock,
      spawnImpl: spawnMock,
    });

    await expect(runNewmanCommand({
      args: ['npx', 'newman', 'run'],
      collectionPath: '/tmp/collection.json',
      cwd: '/tmp',
      folders: ['90 Provider Validation'],
      label: 'provider-integration-openai',
      reportPath: '/tmp/provider-integration-openai.json',
      writeLog: () => {},
    })).resolves.toBeUndefined();

    expect(rmSyncMock).toHaveBeenCalledTimes(2);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces stale-report cleanup failures that are not missing-file errors', () => {
    const rmSyncMock = jest.fn(() => {
      const error = new Error('permission denied');
      error.code = 'EACCES';
      throw error;
    });
    const { runNewmanCommand } = loadRunnerModule({
      rmSyncImpl: rmSyncMock,
    });

    expect(() => runNewmanCommand({
      args: ['npx', 'newman', 'run'],
      collectionPath: '/tmp/collection.json',
      cwd: '/tmp',
      folders: ['90 Provider Validation'],
      label: 'provider-integration-openai',
      reportPath: '/tmp/provider-integration-openai.json',
      writeLog: () => {},
    })).toThrow('permission denied');
  });

  it('rejects when the Newman process cannot be spawned', async () => {
    const child = new EventEmitter();
    const spawnMock = jest.fn(() => {
      process.nextTick(() => child.emit('error', new Error('spawn failed')));
      return child;
    });
    const { runNewmanCommand } = loadRunnerModule({
      spawnImpl: spawnMock,
    });

    await expect(runNewmanCommand({
      args: ['npx', 'newman', 'run'],
      collectionPath: '/tmp/collection.json',
      cwd: '/tmp',
      folders: ['90 Provider Validation'],
      label: 'provider-integration-openai',
      reportPath: '/tmp/provider-integration-openai.json',
      writeLog: () => {},
    })).rejects.toThrow('spawn failed');
  });
});
