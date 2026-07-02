const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  appendStepSummary,
  buildApiUrl,
  DEFAULT_ALLOWED_LICENSES,
  fetchGitHubJson,
  filterAddedChangesByLicense,
  filterChangesByScopes,
  filterChangesBySeverity,
  isLicenseAllowed,
  listDependencyChanges,
  parseArgs,
  reviewDependencies,
} = require('../../../../scripts/github/review-dependencies');

function createResponse({
  body,
  headers = {},
  ok = true,
  rawText,
  status = 200,
}) {
  return {
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      },
    },
    ok,
    status,
    text: async () => rawText || JSON.stringify(body),
  };
}

const createSilentWriters = () => ({
  writeStderr: jest.fn(),
  writeStdout: jest.fn(),
});

describe('Unit | Scripts | GitHub | Review Dependencies', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('parseArgs', () => {
    it('parses supported CLI arguments', () => {
      expect(parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--base-ref',
        'abc123',
        '--head-ref',
        'def456',
        '--fail-on-scopes',
        'runtime,development',
        '--fail-on-severity',
        'moderate',
        '--per-page',
        '50',
        '--summary-file',
        '/tmp/summary.md',
      ])).toMatchObject({
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'abc123',
        failOnScopes: ['runtime', 'development'],
        failOnSeverity: 'moderate',
        headRef: 'def456',
        perPage: 50,
        repo: 'jsugg/alt-text-generator',
        summaryFile: '/tmp/summary.md',
      });
    });

    it('rejects unsupported and incomplete arguments', () => {
      expect(() => parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--base-ref',
        'abc123',
      ])).toThrow('--repo, --base-ref, and --head-ref are required');

      expect(() => parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--base-ref',
        'abc123',
        '--head-ref',
        'def456',
        '--fail-on-severity',
        'urgent',
      ])).toThrow('--fail-on-severity must be one of: critical, high, moderate, low');

      expect(() => parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--base-ref',
        'abc123',
        '--head-ref',
        'def456',
        '--unknown',
        'value',
      ])).toThrow('Unsupported argument: --unknown');

      expect(() => parseArgs([
        '--repo=jsugg/alt-text-generator',
        '--base-ref=abc123',
        '--head-ref=def456',
        '--per-page=101',
      ])).toThrow('--per-page must be a positive integer up to 100');
    });
  });

  describe('buildApiUrl', () => {
    it('builds the dependency compare endpoint with paging', () => {
      expect(buildApiUrl({
        apiBaseUrl: 'https://api.github.example/',
        baseRef: 'abc123',
        headRef: 'def456',
        page: 2,
        perPage: 25,
        repo: 'jsugg/alt-text-generator',
      }).toString()).toBe(
        'https://api.github.example/repos/jsugg/alt-text-generator/dependency-graph/compare/abc123...def456?page=2&per_page=25',
      );
    });

    it('rejects repositories that do not include an owner and repo name', () => {
      expect(() => buildApiUrl({
        apiBaseUrl: 'https://api.github.example/',
        baseRef: 'abc123',
        headRef: 'def456',
        page: 1,
        perPage: 25,
        repo: 'alt-text-generator',
      })).toThrow('--repo must use the format <owner>/<repo>');
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
        token: 'github-token',
        url: 'https://api.github.com/repos/jsugg/alt-text-generator/dependency-graph/compare/base...head',
      })).rejects.toThrow('GitHub API request failed with status 403: forbidden');
    });
  });

  describe('listDependencyChanges', () => {
    it('paginates compare responses and decodes snapshot warnings', async () => {
      const fetchImpl = jest.fn()
        .mockResolvedValueOnce(createResponse({
          body: [{
            change_type: 'added',
            manifest: 'package-lock.json',
            name: 'left-pad',
            version: '1.0.0',
            vulnerabilities: [],
          }],
          headers: {
            'x-github-dependency-graph-snapshot-warnings': Buffer.from('snapshot pending').toString('base64'),
          },
        }))
        .mockResolvedValueOnce(createResponse({ body: [] }));

      await expect(listDependencyChanges({
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'abc123',
        headRef: 'def456',
        perPage: 1,
        repo: 'jsugg/alt-text-generator',
      }, {
        fetchImpl,
        token: 'github-token',
      })).resolves.toEqual({
        changes: [{
          change_type: 'added',
          manifest: 'package-lock.json',
          name: 'left-pad',
          version: '1.0.0',
          vulnerabilities: [],
        }],
        snapshotWarnings: 'snapshot pending',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('rejects non-array payloads from the compare endpoint', async () => {
      await expect(listDependencyChanges({
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'abc123',
        headRef: 'def456',
        perPage: 100,
        repo: 'jsugg/alt-text-generator',
      }, {
        fetchImpl: jest.fn().mockResolvedValue(createResponse({
          body: null,
          rawText: '{}',
        })),
        token: 'github-token',
      })).rejects.toThrow('Dependency review API returned a non-array payload');
    });
  });

  describe('filters', () => {
    const changes = [
      {
        change_type: 'added',
        manifest: 'package-lock.json',
        name: 'runtime-package',
        scope: 'runtime',
        version: '1.0.0',
        vulnerabilities: [
          {
            advisory_ghsa_id: 'GHSA-low',
            advisory_summary: 'Low severity issue',
            advisory_url: 'https://github.com/advisories/GHSA-low',
            severity: 'low',
          },
          {
            advisory_ghsa_id: 'GHSA-high',
            advisory_summary: 'High severity issue',
            advisory_url: 'https://github.com/advisories/GHSA-high',
            severity: 'high',
          },
        ],
      },
      {
        change_type: 'added',
        manifest: 'package-lock.json',
        name: 'development-package',
        scope: 'development',
        version: '2.0.0',
        vulnerabilities: [{
          advisory_ghsa_id: 'GHSA-dev',
          advisory_summary: 'Development issue',
          advisory_url: 'https://github.com/advisories/GHSA-dev',
          severity: 'critical',
        }],
      },
      {
        change_type: 'removed',
        manifest: 'package-lock.json',
        name: 'removed-package',
        scope: 'runtime',
        version: '3.0.0',
        vulnerabilities: [{
          advisory_ghsa_id: 'GHSA-removed',
          advisory_summary: 'Removed package issue',
          advisory_url: 'https://github.com/advisories/GHSA-removed',
          severity: 'critical',
        }],
      },
    ];

    it('filters by scope before severity', () => {
      expect(filterChangesByScopes(['runtime'], changes)).toHaveLength(2);
      expect(filterChangesBySeverity('moderate', filterChangesByScopes(['runtime'], changes))).toEqual([
        {
          change_type: 'added',
          manifest: 'package-lock.json',
          name: 'runtime-package',
          scope: 'runtime',
          version: '1.0.0',
          vulnerabilities: [{
            advisory_ghsa_id: 'GHSA-high',
            advisory_summary: 'High severity issue',
            advisory_url: 'https://github.com/advisories/GHSA-high',
            severity: 'high',
          }],
        },
      ]);
    });
  });

  describe('license policy', () => {
    it('accepts bare allowed ids and OR expressions, requires every AND part', () => {
      expect(isLicenseAllowed(DEFAULT_ALLOWED_LICENSES, 'MIT')).toBe(true);
      expect(isLicenseAllowed(DEFAULT_ALLOWED_LICENSES, '(MIT OR GPL-3.0-only)')).toBe(true);
      expect(isLicenseAllowed(DEFAULT_ALLOWED_LICENSES, 'MIT AND GPL-3.0-only')).toBe(false);
      expect(isLicenseAllowed(DEFAULT_ALLOWED_LICENSES, 'Apache-2.0 AND ISC')).toBe(true);
      expect(isLicenseAllowed(DEFAULT_ALLOWED_LICENSES, 'GPL-3.0-only')).toBe(false);
      expect(isLicenseAllowed(DEFAULT_ALLOWED_LICENSES, 'NOASSERTION')).toBe(false);
      expect(isLicenseAllowed(DEFAULT_ALLOWED_LICENSES, null)).toBe(false);
    });

    it('flags only added changes with unknown or disallowed licenses', () => {
      expect(filterAddedChangesByLicense(DEFAULT_ALLOWED_LICENSES, [
        { change_type: 'added', license: 'MIT', name: 'ok' },
        { change_type: 'added', license: 'AGPL-3.0-only', name: 'copyleft' },
        { change_type: 'added', license: null, name: 'unknown' },
        { change_type: 'removed', license: 'AGPL-3.0-only', name: 'removed' },
      ]).map((change) => change.name)).toEqual(['copyleft', 'unknown']);
    });

    it('reports disallowed licenses as advisory without failing the review', async () => {
      const writers = createSilentWriters();
      const summaryFile = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'license-summary-')),
        'summary.md',
      );

      await expect(reviewDependencies({
        allowedLicenses: [...DEFAULT_ALLOWED_LICENSES],
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'base',
        failOnScopes: ['runtime'],
        failOnSeverity: 'low',
        headRef: 'head',
        perPage: 100,
        repo: 'jsugg/alt-text-generator',
        summaryFile,
      }, { GITHUB_TOKEN: 'token' }, {
        ...writers,
        fetchImpl: jest.fn().mockResolvedValue(createResponse({
          body: [{
            change_type: 'added',
            license: 'AGPL-3.0-only',
            manifest: 'package.json',
            name: 'copyleft-package',
            scope: 'runtime',
            version: '1.0.0',
            vulnerabilities: [],
          }],
        })),
      })).resolves.toMatchObject({
        licenseFlaggedChanges: [expect.objectContaining({ name: 'copyleft-package' })],
        vulnerableChanges: [],
      });

      const summary = fs.readFileSync(summaryFile, 'utf8');

      expect(summary).toContain('### License Policy');
      expect(summary).toContain('copyleft-package@1.0.0');
      expect(writers.writeStderr).toHaveBeenCalledWith(
        expect.stringContaining('"AGPL-3.0-only" is not in the allowlist (advisory)'),
      );
    });

    it('fails on disallowed licenses only when the blocking flag is set', async () => {
      const writers = createSilentWriters();

      await expect(reviewDependencies({
        allowedLicenses: [...DEFAULT_ALLOWED_LICENSES],
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'base',
        failOnDisallowedLicenses: true,
        failOnScopes: ['runtime'],
        failOnSeverity: 'low',
        headRef: 'head',
        perPage: 100,
        repo: 'jsugg/alt-text-generator',
        summaryFile: null,
      }, { GITHUB_TOKEN: 'token' }, {
        ...writers,
        fetchImpl: jest.fn().mockResolvedValue(createResponse({
          body: [{
            change_type: 'added',
            license: 'AGPL-3.0-only',
            manifest: 'package.json',
            name: 'copyleft-package',
            scope: 'runtime',
            version: '1.0.0',
            vulnerabilities: [],
          }],
        })),
      })).rejects.toThrow('Dependency review detected disallowed licenses.');
    });

    it('parses the license policy arguments', () => {
      const args = parseArgs([
        '--repo', 'jsugg/alt-text-generator',
        '--base-ref', 'base',
        '--head-ref', 'head',
        '--allowed-licenses', 'MIT, ISC',
        '--fail-on-disallowed-licenses', 'true',
      ]);

      expect(args.allowedLicenses).toEqual(['MIT', 'ISC']);
      expect(args.failOnDisallowedLicenses).toBe(true);
      expect(() => parseArgs([
        '--repo', 'r/r', '--base-ref', 'b', '--head-ref', 'h',
        '--fail-on-disallowed-licenses', 'maybe',
      ])).toThrow('--fail-on-disallowed-licenses must be "true" or "false"');
    });
  });

  describe('reviewDependencies', () => {
    it('requires the GitHub token', async () => {
      await expect(reviewDependencies({
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'abc123',
        failOnScopes: ['runtime'],
        failOnSeverity: 'low',
        headRef: 'def456',
        perPage: 100,
        repo: 'jsugg/alt-text-generator',
        summaryFile: null,
      }, {}, {
        fetchImpl: jest.fn(),
        ...createSilentWriters(),
      })).rejects.toThrow('Missing required environment variable: GITHUB_TOKEN');
    });

    it('writes a clean summary when no dependency changes are returned', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-review-'));
      const summaryFile = path.join(tempDir, 'summary.md');

      await expect(reviewDependencies({
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'abc123',
        failOnScopes: ['runtime'],
        failOnSeverity: 'low',
        headRef: 'def456',
        perPage: 100,
        repo: 'jsugg/alt-text-generator',
        summaryFile,
      }, {
        GITHUB_TOKEN: 'github-token',
      }, {
        fetchImpl: jest.fn().mockResolvedValue(createResponse({ body: [] })),
        ...createSilentWriters(),
      })).resolves.toMatchObject({
        changes: [],
        vulnerableChanges: [],
      });
      expect(fs.readFileSync(summaryFile, 'utf8')).toContain('No added dependencies introduced vulnerabilities');
    });

    it('writes a clean summary when no matching vulnerabilities are added', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-review-'));
      const summaryFile = path.join(tempDir, 'summary.md');

      await expect(reviewDependencies({
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'abc123',
        failOnScopes: ['runtime'],
        failOnSeverity: 'low',
        headRef: 'def456',
        perPage: 100,
        repo: 'jsugg/alt-text-generator',
        summaryFile,
      }, {
        GITHUB_TOKEN: 'github-token',
      }, {
        fetchImpl: jest.fn().mockResolvedValue(createResponse({
          body: [{
            change_type: 'added',
            manifest: 'package-lock.json',
            name: 'development-package',
            scope: 'development',
            version: '2.0.0',
            vulnerabilities: [{
              advisory_ghsa_id: 'GHSA-dev',
              advisory_summary: 'Development issue',
              advisory_url: 'https://github.com/advisories/GHSA-dev',
              severity: 'critical',
            }],
          }],
        })),
        ...createSilentWriters(),
      })).resolves.toMatchObject({
        vulnerableChanges: [],
      });
      expect(fs.readFileSync(summaryFile, 'utf8')).toContain('No added dependencies introduced vulnerabilities');
    });

    it('fails when added runtime dependencies introduce matching vulnerabilities', async () => {
      await expect(reviewDependencies({
        apiBaseUrl: 'https://api.github.com/',
        baseRef: 'abc123',
        failOnScopes: ['runtime'],
        failOnSeverity: 'low',
        headRef: 'def456',
        perPage: 100,
        repo: 'jsugg/alt-text-generator',
        summaryFile: null,
      }, {
        GITHUB_TOKEN: 'github-token',
      }, {
        fetchImpl: jest.fn().mockResolvedValue(createResponse({
          body: [{
            change_type: 'added',
            manifest: 'package-lock.json',
            name: 'runtime-package',
            scope: 'runtime',
            version: '1.0.0',
            vulnerabilities: [{
              advisory_ghsa_id: 'GHSA-low',
              advisory_summary: 'Low severity issue',
              advisory_url: 'https://github.com/advisories/GHSA-low',
              severity: 'low',
            }],
          }],
        })),
        ...createSilentWriters(),
      })).rejects.toThrow('Dependency review detected vulnerable packages.');
    });
  });

  describe('appendStepSummary', () => {
    it('does nothing when no summary file is configured', () => {
      expect(() => appendStepSummary(null, 'ignored')).not.toThrow();
    });
  });
});
