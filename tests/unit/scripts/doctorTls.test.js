const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { updateEnvFile } = require('../../../scripts/doctor-tls');

describe('Unit | Scripts | Doctor TLS', () => {
  /** @type {string} */
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-tls-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('updateEnvFile', () => {
    it('creates the env file when it does not exist yet', () => {
      const envFile = path.join(tempDir, '.env.test');

      expect(updateEnvFile(envFile, 'OUTBOUND_CA_BUNDLE_FILE', '/certs/ca.pem')).toBe(envFile);
      expect(fs.readFileSync(envFile, 'utf8')).toBe(`OUTBOUND_CA_BUNDLE_FILE=/certs/ca.pem${os.EOL}`);
    });

    it('replaces an existing key in place and keeps the other lines', () => {
      const envFile = path.join(tempDir, '.env.test');
      fs.writeFileSync(envFile, ['A=1', 'OUTBOUND_CA_BUNDLE_FILE=/old.pem', 'B=2', ''].join('\n'));

      updateEnvFile(envFile, 'OUTBOUND_CA_BUNDLE_FILE', '/new.pem');

      expect(fs.readFileSync(envFile, 'utf8')).toBe(
        ['A=1', 'OUTBOUND_CA_BUNDLE_FILE=/new.pem', 'B=2', ''].join(os.EOL),
      );
    });

    it('appends the key when the existing file does not define it', () => {
      const envFile = path.join(tempDir, '.env.test');
      fs.writeFileSync(envFile, 'A=1');

      updateEnvFile(envFile, 'OUTBOUND_CA_BUNDLE_FILE', '/certs/ca.pem');

      expect(fs.readFileSync(envFile, 'utf8')).toBe(
        ['A=1', 'OUTBOUND_CA_BUNDLE_FILE=/certs/ca.pem', ''].join(os.EOL),
      );
    });

    it('propagates read errors other than a missing file', () => {
      expect(() => updateEnvFile(tempDir, 'KEY', 'value')).toThrow(
        expect.objectContaining({ code: 'EISDIR' }),
      );
    });
  });
});
