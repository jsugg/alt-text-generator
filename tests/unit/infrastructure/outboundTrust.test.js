const fs = require('fs');
const http2 = require('http2');
const os = require('os');
const path = require('path');
const tls = require('tls');

const selfsigned = require('selfsigned');

const {
  createOutboundClients,
  readCaBundle,
  resolveOptionalFile,
} = require('../../../src/infrastructure/outboundTrust');

describe('Unit | Infrastructure | Outbound Trust', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbound-trust-'));

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns undefined values when no CA bundle is configured', () => {
    expect(readCaBundle(undefined)).toEqual({
      caBundle: undefined,
      caBundleFile: undefined,
    });
  });

  it('resolves relative bundle paths from the current working directory', () => {
    expect(resolveOptionalFile('certs/example.pem'))
      .toBe(path.resolve(process.cwd(), 'certs/example.pem'));
  });

  it('creates outbound clients that use the configured CA bundle', () => {
    const bundleFile = path.join(tempDir, 'extra-ca.pem');
    const pemText = '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n';
    fs.writeFileSync(bundleFile, pemText, 'utf8');

    const outboundClients = createOutboundClients({
      outboundTls: {
        caBundleFile: bundleFile,
      },
    });

    expect(outboundClients.caBundleFile).toBe(bundleFile);
    expect(outboundClients.caBundle).toBe(pemText);
    expect(outboundClients.httpsAgent.options.ca).toEqual(
      expect.arrayContaining([pemText, ...tls.rootCertificates]),
    );
    expect(typeof outboundClients.fetch).toBe('function');
    expect(typeof outboundClients.httpClient.get).toBe('function');
  });

  it('throws a clear error when the configured CA bundle file does not exist', () => {
    expect(() => createOutboundClients({
      outboundTls: {
        caBundleFile: path.join(tempDir, 'missing.pem'),
      },
    })).toThrow('Outbound CA bundle file does not exist');
  });

  describe('fetch over TLS', () => {
    /** @type {import('http2').Http2SecureServer} */
    let server;
    /** @type {string} */
    let bundleFile;
    /** @type {string} */
    let origin;

    beforeAll(async () => {
      const { private: key, cert } = await selfsigned.generate(
        [{ name: 'commonName', value: 'localhost' }],
        {
          algorithm: 'sha256',
          days: 1,
          keySize: 2048,
          extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
        },
      );
      bundleFile = path.join(tempDir, 'fetch-ca.pem');
      fs.writeFileSync(bundleFile, cert, 'utf8');

      // Offers h2 and http/1.1 via ALPN, so the response reveals what the client negotiated.
      server = http2.createSecureServer({ key, cert, allowHTTP1: true }, (req, res) => {
        res.end(req.httpVersion);
      });
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(undefined));
      });
      const address = /** @type {import('net').AddressInfo} */ (server.address());
      origin = `https://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
      });
    });

    it('trusts the configured CA bundle and stays on HTTP/1.1 when HTTP/2 is offered', async () => {
      const { fetch, fetchDispatcher } = createOutboundClients({
        outboundTls: { caBundleFile: bundleFile },
      });

      try {
        const response = await fetch(`${origin}/`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('1.1');
      } finally {
        await fetchDispatcher.close();
      }
    });

    it('rejects the server certificate without the CA bundle', async () => {
      const { fetch, fetchDispatcher } = createOutboundClients({});

      try {
        await expect(fetch(`${origin}/`)).rejects.toThrow('fetch failed');
      } finally {
        await fetchDispatcher.close();
      }
    });
  });
});
