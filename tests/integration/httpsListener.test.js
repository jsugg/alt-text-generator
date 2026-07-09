const https = require('node:https');
const express = require('express');

const { loadTlsCredentials } = require('../../src/infrastructure/loadTlsCredentials');
const {
  createHttpsServer,
  startServer,
  closeServers,
} = require('../../src/server/serverFunctions');

// Generating a self-signed key pair (via `selfsigned`, 2048-bit) on the dev
// credential path can take a moment on a cold CI runner.
jest.setTimeout(30_000);

const HOST = '127.0.0.1';

/**
 * Issues a genuine TLS request and resolves with the response plus low-level
 * proof that the transport was actually encrypted.
 *
 * @param {number} port
 * @param {string} path
 * @returns {Promise<{ statusCode: number|undefined, body: string, encrypted: boolean, protocol: string|null }>}
 */
const httpsGet = (port, path) => new Promise((resolve, reject) => {
  const req = https.request(
    {
      host: HOST,
      port,
      path,
      method: 'GET',
      // The dev credentials are self-signed: the point of this test is that TLS
      // is negotiated and served, not that a CA vouches for the certificate.
      rejectUnauthorized: false,
    },
    (res) => {
      // The socket is live when the response arrives; it may be detached by the
      // time 'end' fires, so capture the TLS facts here.
      const socket = /** @type {import('node:tls').TLSSocket} */ (res.socket);
      const encrypted = socket?.encrypted === true;
      const protocol = socket?.getProtocol?.() ?? null;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        body,
        encrypted,
        protocol,
      }));
    },
  );
  req.on('error', reject);
  req.end();
});

describe('Integration | Server | In-process HTTPS listener', () => {
  /** @type {import('node:https').Server | undefined} */
  let server;

  afterEach(async () => {
    if (server) {
      await closeServers([server]);
      server = undefined;
    }
  });

  it('serves requests over a real TLS connection using the loaded credentials', async () => {
    const app = express();
    app.get('/ping', (req, res) => {
      res.status(200).json({ ok: true, secure: req.secure });
    });

    const credentials = await loadTlsCredentials();
    expect(credentials.key).toBeTruthy();
    expect(credentials.cert).toBeTruthy();

    server = createHttpsServer(app, () => credentials);
    await startServer(server, 0, { info: jest.fn(), error: jest.fn() });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('HTTPS server did not bind a TCP port');
    }

    const response = await httpsGet(address.port, '/ping');

    expect(response.statusCode).toBe(200);
    // The app itself sees the request as secure over the in-process listener.
    expect(JSON.parse(response.body)).toEqual({ ok: true, secure: true });
    // Decisive proof: the bytes actually crossed an encrypted TLS transport.
    expect(response.encrypted).toBe(true);
    expect(response.protocol).toMatch(/^TLSv1/);
  });
});
