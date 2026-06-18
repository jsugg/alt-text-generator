const net = require('node:net');

const {
  allocateFreePorts,
  allocateNamedPorts,
  checkPortAvailable,
  diagnoseFixedPorts,
  formatPortConflictDiagnostics,
  isTruthyFlag,
} = require('../../../../scripts/postman/port-allocator');

const HOST = '127.0.0.1';

/**
 * Opens a server on a free port and resolves with the port plus a closer.
 *
 * @returns {Promise<{ close: () => Promise<void>, port: number }>}
 */
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

describe('Unit | Scripts | Postman | Port Allocator', () => {
  it('allocates the requested number of distinct free ports', async () => {
    const ports = await allocateFreePorts(5, { host: HOST });

    expect(ports).toHaveLength(5);
    ports.forEach((port) => {
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThan(65536);
    });
    expect(new Set(ports).size).toBe(5);
  });

  it('maps each role to a distinct free port', async () => {
    const ports = await allocateNamedPorts(
      ['appHttp', 'appHttps', 'fixture', 'authHttp', 'authHttps'],
      { host: HOST },
    );

    expect(Object.keys(ports)).toEqual([
      'appHttp', 'appHttps', 'fixture', 'authHttp', 'authHttps',
    ]);
    expect(new Set(Object.values(ports)).size).toBe(5);
  });

  it('reports a bound port as unavailable and a free port as available', async () => {
    const held = await occupyPort();

    try {
      const busy = await checkPortAvailable(held.port, { host: HOST });
      expect(busy.available).toBe(false);
      expect(busy.code).toBe('EADDRINUSE');
      expect(busy.port).toBe(held.port);
    } finally {
      await held.close();
    }

    const free = await checkPortAvailable(held.port, { host: HOST });
    expect(free.available).toBe(true);
    expect(free.code).toBeNull();
  });

  it('surfaces every occupied port as a conflict in the preflight diagnosis', async () => {
    const held = await occupyPort();
    const [freePort] = await allocateFreePorts(1, { host: HOST });

    try {
      const { conflicts, results } = await diagnoseFixedPorts(
        [
          { role: 'appHttp', port: held.port },
          { role: 'fixture', port: freePort },
        ],
        { host: HOST },
      );

      expect(results).toHaveLength(2);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({ role: 'appHttp', port: held.port, available: false });

      const message = formatPortConflictDiagnostics(conflicts, { host: HOST });
      expect(message).toContain('already in use');
      expect(message).toContain(`appHttp: ${HOST}:${held.port}`);
      expect(message).toContain('POSTMAN_FIXED_PORTS');
    } finally {
      await held.close();
    }
  });

  it('treats only explicit truthy strings as enabled flags', () => {
    ['1', 'true', 'TRUE', 'yes', 'on', ' On '].forEach((value) => {
      expect(isTruthyFlag(value)).toBe(true);
    });
    ['0', 'false', 'no', 'off', '', undefined, null].forEach((value) => {
      expect(isTruthyFlag(value)).toBe(false);
    });
  });
});
