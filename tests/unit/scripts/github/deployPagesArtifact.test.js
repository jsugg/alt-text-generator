const {
  createPagesDeployment,
  deployPagesArtifact,
  getOidcToken,
  listRunArtifacts,
  normalizePageUrl,
  parseArgs,
  resolveOidcAudience,
  selectArtifact,
  waitForDeployment,
} = require('../../../../scripts/github/deploy-pages-artifact');

describe('Unit | Scripts | GitHub | Deploy Pages Artifact', () => {
  describe('parseArgs', () => {
    it('parses supported CLI arguments', () => {
      expect(parseArgs([
        '--artifact-name',
        'github-pages',
        '--pages-build-version',
        'abc123',
        '--output-file',
        '/tmp/output.txt',
        '--poll-interval-ms',
        '2500',
        '--timeout-ms',
        '120000',
      ])).toEqual({
        apiBaseUrl: 'https://api.github.com/',
        artifactName: 'github-pages',
        environment: 'github-pages',
        outputFile: '/tmp/output.txt',
        pagesBuildVersion: 'abc123',
        pollIntervalMs: 2500,
        timeoutMs: 120000,
      });
    });

    it('supports equals syntax and validates integer timeouts', () => {
      expect(parseArgs([
        '--artifact-name=github-pages',
        '--environment=preview-pages',
        '--pages-build-version=abc123',
        '--api-base-url=https://api.example.test',
        '--timeout-ms=42',
      ])).toEqual({
        apiBaseUrl: 'https://api.example.test',
        artifactName: 'github-pages',
        environment: 'preview-pages',
        outputFile: null,
        pagesBuildVersion: 'abc123',
        pollIntervalMs: 5000,
        timeoutMs: 42,
      });
    });

    it('rejects missing required arguments', () => {
      expect(() => parseArgs([
        '--artifact-name',
        'github-pages',
      ])).toThrow('--pages-build-version is required');

      expect(() => parseArgs([
        '--pages-build-version',
        'abc123',
      ])).toThrow('--artifact-name is required');
    });

    it('rejects unsupported and malformed arguments', () => {
      expect(() => parseArgs([
        'github-pages',
      ])).toThrow('Unexpected argument: github-pages');

      expect(() => parseArgs([
        '--artifact-name',
        'github-pages',
        '--pages-build-version',
        'abc123',
        '--timeout-ms',
        '0',
      ])).toThrow('--timeout-ms must be a positive integer');

      expect(() => parseArgs([
        '--artifact-name',
        'github-pages',
        '--pages-build-version',
        'abc123',
        '--poll-interval-ms',
        'nope',
      ])).toThrow('--poll-interval-ms must be a positive integer');

      expect(() => parseArgs([
        '--artifact-name',
        'github-pages',
        '--pages-build-version',
      ])).toThrow('Missing value for --pages-build-version');

      expect(() => parseArgs([
        '--artifact-name',
        'github-pages',
        '--pages-build-version',
        'abc123',
        '--nope',
        'value',
      ])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('selectArtifact', () => {
    it('prefers the most recent non-expired matching artifact', () => {
      expect(selectArtifact({
        artifactName: 'github-pages',
        artifacts: [
          {
            created_at: '2026-03-12T00:00:00Z',
            expired: false,
            id: 1,
            name: 'github-pages',
          },
          {
            created_at: '2026-03-13T00:00:00Z',
            expired: true,
            id: 2,
            name: 'github-pages',
          },
          {
            created_at: '2026-03-13T01:00:00Z',
            expired: false,
            id: 3,
            name: 'github-pages',
          },
        ],
      })).toMatchObject({
        id: 3,
        name: 'github-pages',
      });
    });

    it('falls back to artifact id ordering when timestamps are equal', () => {
      expect(selectArtifact({
        artifactName: 'github-pages',
        artifacts: [
          {
            created_at: '2026-03-13T00:00:00Z',
            expired: false,
            id: 10,
            name: 'github-pages',
          },
          {
            created_at: '2026-03-13T00:00:00Z',
            expired: false,
            id: 20,
            name: 'github-pages',
          },
        ],
      })).toMatchObject({
        id: 20,
      });
    });

    it('fails when no matching artifact is available', () => {
      expect(() => selectArtifact({
        artifactName: 'github-pages',
        artifacts: [
          {
            expired: true,
            id: 1,
            name: 'github-pages',
          },
        ],
      })).toThrow('No non-expired artifact named "github-pages" was found for this workflow run.');
    });
  });

  describe('normalizePageUrl', () => {
    it('preserves absolute URLs and prefixes bare domains', () => {
      expect(normalizePageUrl('https://jsugg.github.io/alt-text-generator/')).toBe(
        'https://jsugg.github.io/alt-text-generator/',
      );
      expect(normalizePageUrl('jsugg.github.io/alt-text-generator/')).toBe(
        'https://jsugg.github.io/alt-text-generator/',
      );
      expect(normalizePageUrl('')).toBe('');
    });
  });

  describe('resolveOidcAudience', () => {
    it('uses the repository owner as the Pages OIDC audience', () => {
      expect(resolveOidcAudience('jsugg/alt-text-generator')).toBe('https://github.com/jsugg');
    });

    it('rejects invalid repository identifiers', () => {
      expect(() => resolveOidcAudience('')).toThrow('Invalid GitHub repository value: ');
    });
  });

  describe('getOidcToken', () => {
    it('fails when the OIDC endpoint does not return a token value', async () => {
      await expect(getOidcToken({
        audience: 'https://github.com/jsugg/alt-text-generator',
        fetchImpl: jest.fn().mockResolvedValue({
          ok: true,
          text: async () => '{}',
        }),
        requestToken: 'request-token',
        requestUrl: 'https://token.actions.githubusercontent.com?id=123',
      })).rejects.toThrow('OIDC token request did not return a token value');
    });

    it('surfaces non-successful OIDC responses', async () => {
      await expect(getOidcToken({
        audience: 'https://github.com/jsugg/alt-text-generator',
        fetchImpl: jest.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'boom',
        }),
        requestToken: 'request-token',
        requestUrl: 'https://token.actions.githubusercontent.com?id=123',
      })).rejects.toThrow('OIDC token request failed with status 500: boom');
    });
  });

  describe('listRunArtifacts', () => {
    it('paginates until it reaches the last artifacts page', async () => {
      const firstPageArtifacts = Array.from({ length: 100 }, (_, index) => ({
        expired: false,
        id: index + 1,
        name: 'github-pages',
      }));
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ artifacts: firstPageArtifacts }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            artifacts: [
              {
                expired: false,
                id: 101,
                name: 'github-pages',
              },
            ],
          }),
        });

      await expect(listRunArtifacts({
        apiBaseUrl: 'https://api.github.com',
        fetchImpl,
        repo: 'jsugg/alt-text-generator',
        runId: '23032044656',
        token: 'github-token',
      })).resolves.toHaveLength(101);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('createPagesDeployment', () => {
    it('surfaces GitHub API errors from the deployment request', async () => {
      await expect(createPagesDeployment({
        apiBaseUrl: 'https://api.github.com/',
        artifactId: 123,
        environment: 'github-pages',
        fetchImpl: jest.fn().mockResolvedValue({
          ok: false,
          status: 403,
          text: async () => 'forbidden',
        }),
        oidcToken: 'oidc-token',
        pagesBuildVersion: 'abc123',
        repo: 'jsugg/alt-text-generator',
        token: 'github-token',
      })).rejects.toThrow('GitHub API request failed with status 403: forbidden');
    });
  });

  describe('waitForDeployment', () => {
    it('polls until the deployment succeeds', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ status: 'deploying' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ page_url: 'jsugg.github.io/alt-text-generator/', status: 'succeed' }),
        });
      const sleepImpl = jest.fn().mockResolvedValue(undefined);

      await expect(waitForDeployment({
        fetchImpl,
        pollIntervalMs: 10,
        sleepImpl,
        statusUrl: 'https://api.github.com/status',
        timeoutMs: 100,
        token: 'github-token',
      })).resolves.toEqual({
        page_url: 'jsugg.github.io/alt-text-generator/',
        status: 'succeed',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(sleepImpl).toHaveBeenCalledTimes(1);
    });

    it('fails immediately for terminal deployment errors', async () => {
      await expect(waitForDeployment({
        fetchImpl: jest.fn().mockResolvedValue({
          ok: true,
          text: async () => JSON.stringify({ status: 'failed' }),
        }),
        pollIntervalMs: 10,
        sleepImpl: jest.fn(),
        statusUrl: 'https://api.github.com/status',
        timeoutMs: 100,
        token: 'github-token',
      })).rejects.toThrow('GitHub Pages deployment failed with status failed');
    });

    it('times out when the deployment never reaches a terminal state', async () => {
      const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => JSON.stringify({ status: 'building' }),
      });
      const sleepImpl = jest.fn().mockResolvedValue(undefined);
      const dateNowSpy = jest.spyOn(Date, 'now');

      dateNowSpy
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(1)
        .mockReturnValueOnce(5);

      await expect(waitForDeployment({
        fetchImpl,
        pollIntervalMs: 10,
        sleepImpl,
        statusUrl: 'https://api.github.com/status',
        timeoutMs: 2,
        token: 'github-token',
      })).rejects.toThrow('Timed out waiting for GitHub Pages deployment. Last status: building');

      dateNowSpy.mockRestore();
    });
  });

  describe('deployPagesArtifact', () => {
    it('creates and waits for a Pages deployment using the current run artifact', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            artifacts: [
              {
                created_at: '2026-03-13T01:31:02Z',
                expired: false,
                id: 5903084096,
                name: 'github-pages',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ value: 'oidc-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            id: 'deployment-123',
            page_url: 'jsugg.github.io/alt-text-generator/',
            status_url: 'https://api.github.com/status',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            page_url: 'jsugg.github.io/alt-text-generator/',
            status: 'succeed',
          }),
        });

      await expect(deployPagesArtifact({
        apiBaseUrl: 'https://api.github.com/',
        artifactName: 'github-pages',
        environment: 'github-pages',
        pagesBuildVersion: 'a4082b5',
        pollIntervalMs: 10,
        timeoutMs: 100,
      }, {
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com?id=123',
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
        GITHUB_RUN_ID: '23032044656',
        GITHUB_TOKEN: 'github-token',
      }, {
        fetchImpl,
        sleepImpl: jest.fn().mockResolvedValue(undefined),
      })).resolves.toEqual({
        artifactId: 5903084096,
        deploymentId: 'deployment-123',
        pageUrl: 'https://jsugg.github.io/alt-text-generator/',
        status: 'succeed',
      });

      expect(fetchImpl.mock.calls[0][0]).toContain('/actions/runs/23032044656/artifacts');
      expect(fetchImpl.mock.calls[1][0].toString()).toContain('audience=https%3A%2F%2Fgithub.com%2Fjsugg');
      expect(fetchImpl.mock.calls[2][1]).toMatchObject({
        method: 'POST',
      });
    });

    it('falls back to the completed deployment page URL and enforces required env vars', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            artifacts: [
              {
                created_at: '2026-03-13T01:31:02Z',
                expired: false,
                id: 5903084096,
                name: 'github-pages',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ value: 'oidc-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            id: 'deployment-123',
            status_url: 'https://api.github.com/status',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            page_url: 'jsugg.github.io/alt-text-generator/',
            status: 'success',
          }),
        });

      await expect(deployPagesArtifact({
        apiBaseUrl: 'https://api.github.com/',
        artifactName: 'github-pages',
        environment: 'github-pages',
        pagesBuildVersion: 'a4082b5',
        pollIntervalMs: 10,
        timeoutMs: 100,
      }, {
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com?id=123',
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
        GITHUB_RUN_ID: '23032044656',
        GITHUB_TOKEN: 'github-token',
      }, {
        fetchImpl,
        sleepImpl: jest.fn().mockResolvedValue(undefined),
      })).resolves.toMatchObject({
        pageUrl: 'https://jsugg.github.io/alt-text-generator/',
        status: 'success',
      });

      await expect(deployPagesArtifact({
        apiBaseUrl: 'https://api.github.com/',
        artifactName: 'github-pages',
        environment: 'github-pages',
        pagesBuildVersion: 'a4082b5',
        pollIntervalMs: 10,
        timeoutMs: 100,
      }, {
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com?id=123',
        GITHUB_RUN_ID: '23032044656',
        GITHUB_TOKEN: 'github-token',
      }, {
        fetchImpl: jest.fn(),
        sleepImpl: jest.fn(),
      })).rejects.toThrow('Missing required environment variable: GITHUB_REPOSITORY');
    });

    it('fails when the deployment response omits the status URL', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            artifacts: [
              {
                created_at: '2026-03-13T01:31:02Z',
                expired: false,
                id: 5903084096,
                name: 'github-pages',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({ value: 'oidc-token' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => JSON.stringify({
            id: 'deployment-123',
            page_url: 'jsugg.github.io/alt-text-generator/',
          }),
        });

      await expect(deployPagesArtifact({
        apiBaseUrl: 'https://api.github.com/',
        artifactName: 'github-pages',
        environment: 'github-pages',
        pagesBuildVersion: 'a4082b5',
        pollIntervalMs: 10,
        timeoutMs: 100,
      }, {
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com?id=123',
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
        GITHUB_RUN_ID: '23032044656',
        GITHUB_TOKEN: 'github-token',
      }, {
        fetchImpl,
        sleepImpl: jest.fn().mockResolvedValue(undefined),
      })).rejects.toThrow('GitHub Pages deployment response did not include a status_url');
    });
  });
});
