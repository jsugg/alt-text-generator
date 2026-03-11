const fs = require('fs');
const os = require('os');
const path = require('path');
const tls = require('tls');

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
});
