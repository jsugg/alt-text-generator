const net = require('node:net');

const DEFAULT_HOST = '127.0.0.1';
const TRUTHY_FLAGS = new Set(['1', 'true', 'yes', 'on']);

/**
 * Binds a throwaway server to an OS-assigned ephemeral port and keeps it open
 * so the caller can hold several reservations at once without the OS handing
 * the same port out twice.
 *
 * @param {string} host
 * @returns {Promise<import('node:net').Server>}
 */
function reserveEphemeralServer(host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      resolve(server);
    });
  });
}

/**
 * @param {import('node:net').Server} server
 * @returns {number}
 */
function serverPort(server) {
  const address = server.address();

  if (!address || typeof address !== 'object') {
    throw new Error('Unable to determine the reserved ephemeral port');
  }

  return address.port;
}

/**
 * @param {import('node:net').Server} server
 * @returns {Promise<void>}
 */
function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * Allocates the requested number of distinct free TCP ports. All reservations
 * are held simultaneously before being released, which guarantees the returned
 * ports differ from one another.
 *
 * @param {number} count
 * @param {{ host?: string }} [options]
 * @returns {Promise<number[]>}
 */
async function allocateFreePorts(count, { host = DEFAULT_HOST } = {}) {
  const servers = [];

  try {
    for (let index = 0; index < count; index += 1) {
      // Reservations must be held concurrently so the OS never repeats a port.
      // eslint-disable-next-line no-await-in-loop
      servers.push(await reserveEphemeralServer(host));
    }

    return servers.map(serverPort);
  } finally {
    await Promise.all(servers.map(closeServer));
  }
}

/**
 * Allocates a distinct free port for each named role.
 *
 * @param {string[]} roleNames
 * @param {{ host?: string }} [options]
 * @returns {Promise<Record<string, number>>}
 */
async function allocateNamedPorts(roleNames, { host = DEFAULT_HOST } = {}) {
  const ports = await allocateFreePorts(roleNames.length, { host });

  return Object.fromEntries(roleNames.map((role, index) => [role, ports[index]]));
}

/**
 * @typedef {object} PortCheckResult
 * @property {string} role
 * @property {boolean} available
 * @property {string | null} code
 * @property {string} host
 * @property {string | null} message
 * @property {number} port
 */

/**
 * Checks whether a specific port can currently be bound on the given host.
 *
 * @param {number} port
 * @param {{ host?: string }} [options]
 * @returns {Promise<{
 *   available: boolean,
 *   code: string | null,
 *   host: string,
 *   message: string | null,
 *   port: number,
 * }>}
 */
function checkPortAvailable(port, { host = DEFAULT_HOST } = {}) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (error) => {
      resolve({
        available: false,
        code: /** @type {NodeJS.ErrnoException} */ (error).code || 'EUNKNOWN',
        host,
        message: error.message,
        port,
      });
    });

    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve({
        available: true,
        code: null,
        host,
        message: null,
        port,
      }));
    });
  });
}

/**
 * Runs the fixed-port preflight check, reporting every role whose port is
 * already in use so the harness can fail fast with actionable diagnostics.
 *
 * @param {{ role: string, port: number }[]} portSpecs
 * @param {{ host?: string }} [options]
 * @returns {Promise<{ conflicts: PortCheckResult[], results: PortCheckResult[] }>}
 */
async function diagnoseFixedPorts(portSpecs, { host = DEFAULT_HOST } = {}) {
  const results = await Promise.all(portSpecs.map(async ({ role, port }) => ({
    role,
    ...(await checkPortAvailable(port, { host })),
  })));

  return {
    conflicts: results.filter((result) => !result.available),
    results,
  };
}

/**
 * Formats fixed-port conflicts into a single actionable error message.
 *
 * @param {PortCheckResult[]} conflicts
 * @param {{ host?: string }} [options]
 * @returns {string}
 */
function formatPortConflictDiagnostics(conflicts, { host = DEFAULT_HOST } = {}) {
  return [
    'Fixed-port debug mode is enabled but these ports are already in use:',
    ...conflicts.map((conflict) => (
      `  - ${conflict.role}: ${conflict.host || host}:${conflict.port} (${conflict.code})`
    )),
    'Free the listed ports, pick different POSTMAN_*_PORT values, or unset '
    + 'POSTMAN_FIXED_PORTS to use dynamic free-port allocation (the default).',
  ].join('\n');
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isTruthyFlag(value) {
  return TRUTHY_FLAGS.has(String(value ?? '').trim().toLowerCase());
}

module.exports = {
  DEFAULT_HOST,
  allocateFreePorts,
  allocateNamedPorts,
  checkPortAvailable,
  diagnoseFixedPorts,
  formatPortConflictDiagnostics,
  isTruthyFlag,
};
