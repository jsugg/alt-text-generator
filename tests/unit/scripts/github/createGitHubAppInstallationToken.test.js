const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendOutput,
  buildAppJwt,
  createGitHubAppInstallationToken,
  createInstallationAccessToken,
  fetchGitHubJson,
  normalizePrivateKey,
  parseArgs,
  resolveInstallationId,
} = require('../../../../scripts/github/create-github-app-installation-token');

describe('Unit | Scripts | GitHub | Create GitHub App Installation Token', () => {
  describe('parseArgs', () => {
    it('parses supported CLI arguments', () => {
      expect(parseArgs([
        '--app-id',
        '12345',
        '--api-base-url',
        'https://api.github.example',
        '--owner',
        'jsugg',
        '--repo',
        'alt-text-generator',
        '--output-file',
        '/tmp/output.txt',
      ])).toEqual({
        apiBaseUrl: 'https://api.github.example',
        appId: '12345',
        outputFile: '/tmp/output.txt',
        owner: 'jsugg',
        repo: 'alt-text-generator',
      });
    });

    it('rejects unsupported and incomplete arguments', () => {
      expect(() => parseArgs([
        '--app-id',
        '12345',
        '--owner',
        'jsugg',
      ])).toThrow('--app-id, --owner, and --repo are required');

      expect(() => parseArgs([
        '--app-id',
        '12345',
        '--owner',
        'jsugg',
        '--repo',
        'alt-text-generator',
        '--unknown',
        'value',
      ])).toThrow('Unsupported argument: --unknown');

      expect(() => parseArgs([
        '--app-id',
        '12345',
        '--owner',
        'jsugg',
        '--repo',
      ])).toThrow('Missing value for --repo');

      expect(() => parseArgs([
        '12345',
      ])).toThrow('Unexpected argument: 12345');
    });
  });

  describe('appendOutput', () => {
    it('writes key-value outputs when a file is provided', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-app-token-'));
      const outputFile = path.join(tempDir, 'github-output.txt');

      appendOutput(outputFile, 'token', 'installation-token');

      expect(fs.readFileSync(outputFile, 'utf8')).toBe('token=installation-token\n');
    });
  });

  describe('normalizePrivateKey', () => {
    it('preserves multiline keys and expands escaped newlines', () => {
      expect(normalizePrivateKey('line1\nline2')).toBe('line1\nline2');
      expect(normalizePrivateKey('line1\\nline2')).toBe('line1\nline2');
    });
  });

  describe('buildAppJwt', () => {
    it('creates a signed JWT with the expected issuer and validity window', () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const token = buildAppJwt({
        appId: '12345',
        nowMs: 1_700_000_000_000,
        privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      });
      const [, payload] = token.split('.');
      const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

      expect(decodedPayload).toMatchObject({
        exp: 1_700_000_540,
        iat: 1_699_999_940,
        iss: '12345',
      });
    });
  });

  describe('resolveInstallationId', () => {
    it('loads the installation id for the repository', async () => {
      await expect(resolveInstallationId({
        apiBaseUrl: 'https://api.github.com/',
        appJwt: 'app-jwt',
        fetchImpl: jest.fn().mockResolvedValue({
          ok: true,
          text: async () => JSON.stringify({ id: 98765 }),
        }),
        owner: 'jsugg',
        repo: 'alt-text-generator',
      })).resolves.toBe(98765);
    });

    it('rejects installation lookups that return no installation id', async () => {
      await expect(resolveInstallationId({
        apiBaseUrl: 'https://api.github.com/',
        appJwt: 'app-jwt',
        fetchImpl: jest.fn().mockResolvedValue({
          ok: true,
          text: async () => '{}',
        }),
        owner: 'jsugg',
        repo: 'alt-text-generator',
      })).rejects.toThrow('GitHub App installation lookup did not return an installation id');
    });
  });

  describe('fetchGitHubJson', () => {
    it('surfaces GitHub API failures', async () => {
      await expect(fetchGitHubJson({
        fetchImpl: jest.fn().mockResolvedValue({
          ok: false,
          status: 403,
          text: async () => 'forbidden',
        }),
        token: 'app-jwt',
        url: 'https://api.github.com/repos/jsugg/alt-text-generator/installation',
      })).rejects.toThrow('GitHub API request failed with status 403: forbidden');
    });
  });

  describe('createInstallationAccessToken', () => {
    it('creates a scoped installation token for the repository', async () => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({
          expires_at: '2026-03-13T03:00:00Z',
          token: 'installation-token',
        }),
      });

      await expect(createInstallationAccessToken({
        apiBaseUrl: 'https://api.github.com/',
        appJwt: 'app-jwt',
        fetchImpl,
        installationId: 98765,
        repo: 'alt-text-generator',
      })).resolves.toEqual({
        expires_at: '2026-03-13T03:00:00Z',
        token: 'installation-token',
      });
      expect(fetchImpl.mock.calls[0][1]).toMatchObject({
        body: JSON.stringify({
          repositories: ['alt-text-generator'],
        }),
        method: 'POST',
      });
    });

    it('rejects token responses that omit the token value', async () => {
      await expect(createInstallationAccessToken({
        apiBaseUrl: 'https://api.github.com/',
        appJwt: 'app-jwt',
        fetchImpl: jest.fn().mockResolvedValue({
          ok: true,
          text: async () => '{}',
        }),
        installationId: 98765,
        repo: 'alt-text-generator',
      })).rejects.toThrow('GitHub App installation token response did not include a token');
    });
  });

  describe('createGitHubAppInstallationToken', () => {
    it('creates an installation token from the configured GitHub App secret', async () => {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ id: 98765 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            expires_at: '2026-03-13T03:00:00Z',
            token: 'installation-token',
          }),
        });

      await expect(createGitHubAppInstallationToken({
        apiBaseUrl: 'https://api.github.com/',
        appId: '12345',
        owner: 'jsugg',
        repo: 'alt-text-generator',
      }, {
        REPO_TOOLING_GITHUB_APP_PRIVATE_KEY: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      }, {
        fetchImpl,
        nowMs: 1_700_000_000_000,
      })).resolves.toEqual({
        expiresAt: '2026-03-13T03:00:00Z',
        installationId: 98765,
        token: 'installation-token',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[0][1].headers.Authorization).toMatch(/^Bearer /u);
    });

    it('requires the GitHub App private key secret', async () => {
      await expect(createGitHubAppInstallationToken({
        apiBaseUrl: 'https://api.github.com/',
        appId: '12345',
        owner: 'jsugg',
        repo: 'alt-text-generator',
      }, {}, {
        fetchImpl: jest.fn(),
      })).rejects.toThrow('Missing required environment variable: REPO_TOOLING_GITHUB_APP_PRIVATE_KEY');
    });
  });
});
