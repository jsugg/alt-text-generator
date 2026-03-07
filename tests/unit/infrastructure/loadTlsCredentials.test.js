const fs = require('fs');
const os = require('os');
const path = require('path');

describe('loadTlsCredentials', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-creds-'));

  afterEach(() => {
    jest.resetModules();
    jest.unmock('../../../config');
    jest.unmock('fs');
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const loadModule = (configOverride) => {
    jest.doMock('../../../config', () => configOverride);
    return require('../../../src/infrastructure/loadTlsCredentials');
  };

  it('generates self-signed localhost credentials outside production', async () => {
    jest.doMock('fs', () => ({
      ...jest.requireActual('fs'),
      existsSync: jest.fn(() => false),
    }));
    const { loadTlsCredentials } = loadModule({
      env: 'development',
      https: {
        keyPath: undefined,
        certPath: undefined,
      },
    });

    const credentials = await loadTlsCredentials();

    expect(credentials.key).toContain('BEGIN PRIVATE KEY');
    expect(credentials.cert).toContain('BEGIN CERTIFICATE');
  });

  it('loads configured certificate files when paths are provided', async () => {
    const keyPath = path.join(tempDir, 'tls-key.pem');
    const certPath = path.join(tempDir, 'tls-cert.pem');
    fs.writeFileSync(keyPath, 'test-key');
    fs.writeFileSync(certPath, 'test-cert');

    const { loadTlsCredentials } = loadModule({
      env: 'development',
      https: {
        keyPath,
        certPath,
      },
    });

    const credentials = await loadTlsCredentials();

    expect(Buffer.isBuffer(credentials.key)).toBe(true);
    expect(credentials.key.toString()).toBe('test-key');
    expect(Buffer.isBuffer(credentials.cert)).toBe(true);
    expect(credentials.cert.toString()).toBe('test-cert');
  });

  it('uses inline PEM values when they are provided', async () => {
    const { loadTlsCredentials } = loadModule({
      env: 'development',
      https: {
        keyPath: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
        certPath: '-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----',
      },
    });

    const credentials = await loadTlsCredentials();

    expect(credentials.key).toBe('-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----');
    expect(credentials.cert).toBe('-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----');
  });

  it('throws a helpful error when production credentials are missing', async () => {
    const { loadTlsCredentials } = loadModule({
      env: 'production',
      https: {
        keyPath: undefined,
        certPath: undefined,
      },
    });

    await expect(loadTlsCredentials()).rejects.toThrow(/TLS credentials could not be loaded/);
  });

  it('throws a helpful error when a configured certificate path is invalid', async () => {
    const { loadTlsCredentials } = loadModule({
      env: 'development',
      https: {
        keyPath: './certs/does-not-exist.pem',
        certPath: './certs/does-not-exist.pem',
      },
    });

    await expect(loadTlsCredentials()).rejects.toThrow(/TLS credentials could not be loaded/);
  });
});
