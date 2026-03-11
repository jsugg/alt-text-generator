const {
  buildDeployEnvVars,
  buildDeployProbeUrls,
  collectDeployStabilizationIssues,
  hasRequiredRateLimitHeaders,
  normalizeBooleanFlag,
  normalizeBaseUrl,
  parseArgs,
  requestDeployProbe,
  resolveProductionDeployAuthConfig,
  waitForStableDeploy,
} = require('../../../scripts/run-postman-deploy');

const createHeaders = (entries = {}) => ({
  get: (name) => {
    const match = Object.entries(entries)
      .find(([headerName]) => headerName.toLowerCase() === name.toLowerCase());

    return match ? match[1] : null;
  },
  has: (name) => Object.keys(entries)
    .some((headerName) => headerName.toLowerCase() === name.toLowerCase()),
});

const createJsonResponse = (status, jsonBody, headers = {}) => ({
  headers: createHeaders({
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  }),
  status,
  text: jest.fn().mockResolvedValue(JSON.stringify(jsonBody)),
});

describe('scripts/run-postman-deploy', () => {
  describe('parseArgs', () => {
    it('uses the production base URL by default', () => {
      expect(parseArgs([])).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br',
      });
    });

    it('parses the supported base-url flag', () => {
      expect(parseArgs(['--base-url', 'https://wcag.qcraft.com.br/preview'])).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br/preview',
      });
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs(['--nope', 'value'])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('normalizeBaseUrl', () => {
    it('strips trailing slashes from the base URL', () => {
      expect(normalizeBaseUrl('https://wcag.qcraft.com.br/')).toBe('https://wcag.qcraft.com.br');
    });
  });

  describe('buildDeployEnvVars', () => {
    it('targets the hosted api-docs page for deploy scraper verification', () => {
      expect(buildDeployEnvVars('https://wcag.qcraft.com.br', {
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: 'deploy-token',
      })).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br',
        deployScrapePageUrl: 'https://wcag.qcraft.com.br/api-docs/',
        deployValidationApiToken: 'deploy-token',
        expectedSwaggerServerUrl: 'https://wcag.qcraft.com.br',
        productionApiAuthEnabled: 'true',
      });
    });
  });

  describe('buildDeployProbeUrls', () => {
    it('builds deploy rollout probe URLs from the hosted base URL', () => {
      expect(buildDeployProbeUrls('https://wcag.qcraft.com.br', {
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: 'deploy-token',
      })).toEqual({
        authenticatedProtectedUrl: 'https://wcag.qcraft.com.br/api/scraper/images?url=https%3A%2F%2Fwcag.qcraft.com.br%2Fapi-docs%2F',
        healthUrl: 'https://wcag.qcraft.com.br/api/health',
        unauthenticatedProtectedUrl: 'https://wcag.qcraft.com.br/api/scraper/images?url=https%3A%2F%2Fwcag.qcraft.com.br%2Fapi-docs%2F',
      });
    });
  });

  describe('hasRequiredRateLimitHeaders', () => {
    it('requires the standard rate-limit headers case-insensitively', () => {
      expect(hasRequiredRateLimitHeaders(createHeaders({
        'X-RateLimit-Limit': '60',
        'x-ratelimit-remaining': '59',
        'X-RateLimit-Reset': '123',
      }))).toBe(true);

      expect(hasRequiredRateLimitHeaders(createHeaders({
        'X-RateLimit-Limit': '60',
      }))).toBe(false);
    });
  });

  describe('normalizeBooleanFlag', () => {
    it('defaults empty values to false', () => {
      expect(normalizeBooleanFlag(undefined)).toBe('false');
      expect(normalizeBooleanFlag('')).toBe('false');
    });

    it('accepts true and false', () => {
      expect(normalizeBooleanFlag('true')).toBe('true');
      expect(normalizeBooleanFlag('false')).toBe('false');
    });

    it('rejects unsupported values', () => {
      expect(() => normalizeBooleanFlag('auto', { label: 'PRODUCTION_API_AUTH_ENABLED' })).toThrow(
        'PRODUCTION_API_AUTH_ENABLED must be either "true" or "false"',
      );
    });
  });

  describe('resolveProductionDeployAuthConfig', () => {
    it('skips protected deploy verification when auth is enabled without a token', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'true',
      })).toEqual({
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: '',
        protectedVerificationEnabled: false,
        protectedVerificationSkipReason: 'Skipping 96 Deploy Protected Verification because '
          + 'PRODUCTION_API_AUTH_ENABLED=true but PRODUCTION_DEPLOY_VALIDATION_API_TOKEN is not set. '
          + 'Protected deploy checks require Render API_AUTH_ENABLED=true and API_AUTH_TOKENS '
          + 'to include the same token.',
      });
    });

    it('runs protected deploy verification when auth is enabled with a token', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'true',
        PRODUCTION_DEPLOY_VALIDATION_API_TOKEN: ' deploy-token ',
      })).toEqual({
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: 'deploy-token',
        protectedVerificationEnabled: true,
        protectedVerificationSkipReason: null,
      });
    });

    it('treats blank deploy validation tokens as missing when auth is enabled', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'true',
        PRODUCTION_DEPLOY_VALIDATION_API_TOKEN: '   ',
      })).toEqual({
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: '',
        protectedVerificationEnabled: false,
        protectedVerificationSkipReason: 'Skipping 96 Deploy Protected Verification because '
          + 'PRODUCTION_API_AUTH_ENABLED=true but PRODUCTION_DEPLOY_VALIDATION_API_TOKEN is not set. '
          + 'Protected deploy checks require Render API_AUTH_ENABLED=true and API_AUTH_TOKENS '
          + 'to include the same token.',
      });
    });

    it('runs protected deploy verification without a token when auth is disabled', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'false',
      })).toEqual({
        productionApiAuthEnabled: 'false',
        deployValidationApiToken: '',
        protectedVerificationEnabled: true,
        protectedVerificationSkipReason: null,
      });
    });
  });

  describe('requestDeployProbe', () => {
    it('parses JSON bodies when the response is JSON', async () => {
      const probe = await requestDeployProbe(jest.fn().mockResolvedValue({
        headers: createHeaders({
          'content-type': 'application/json; charset=utf-8',
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '123',
        }),
        status: 200,
        text: jest.fn().mockResolvedValue('{"message":"OK"}'),
      }), 'https://wcag.qcraft.com.br/api/health');

      expect(probe).toEqual({
        headers: expect.any(Object),
        jsonBody: { message: 'OK' },
        status: 200,
      });
    });
  });

  describe('collectDeployStabilizationIssues', () => {
    it('reports rollout issues until health headers and auth expectations match', () => {
      expect(collectDeployStabilizationIssues({
        authenticatedProtectedProbe: {
          status: 200,
        },
        healthProbe: {
          headers: createHeaders({
            'content-type': 'application/json; charset=utf-8',
          }),
          status: 200,
        },
        productionApiAuthEnabled: 'true',
        protectedVerificationEnabled: true,
        unauthenticatedProtectedProbe: {
          jsonBody: {
            code: 'WRONG',
          },
          status: 200,
        },
      })).toEqual([
        'health probe is missing rate-limit headers',
        'protected auth probe returned 200; expected 401',
        'protected auth probe did not return API_AUTHENTICATION_FAILED',
      ]);
    });
  });

  describe('waitForStableDeploy', () => {
    it('requires consecutive stable probes before continuing', async () => {
      const responses = [
        createJsonResponse(200, { message: 'OK' }),
        createJsonResponse(401, { code: 'API_AUTHENTICATION_FAILED' }),
        createJsonResponse(
          200,
          { imageSources: ['https://example.com/image.jpg'] },
          {
            'x-ratelimit-limit': '60',
            'x-ratelimit-remaining': '59',
            'x-ratelimit-reset': '123',
          },
        ),
        createJsonResponse(200, { message: 'OK' }, {
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '123',
        }),
        createJsonResponse(401, { code: 'API_AUTHENTICATION_FAILED' }, {
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '123',
        }),
        createJsonResponse(200, { imageSources: ['https://example.com/image.jpg'] }, {
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '123',
        }),
        createJsonResponse(200, { message: 'OK' }, {
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '123',
        }),
        createJsonResponse(401, { code: 'API_AUTHENTICATION_FAILED' }, {
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '123',
        }),
        createJsonResponse(200, { imageSources: ['https://example.com/image.jpg'] }, {
          'x-ratelimit-limit': '60',
          'x-ratelimit-remaining': '59',
          'x-ratelimit-reset': '123',
        }),
      ];
      const fetchFn = jest.fn().mockImplementation(() => Promise.resolve(responses.shift()));
      const sleepFn = jest.fn().mockResolvedValue(undefined);
      const writeLog = jest.fn();
      let currentTime = 0;

      await waitForStableDeploy('https://wcag.qcraft.com.br', {
        deployValidationApiToken: 'deploy-token',
        productionApiAuthEnabled: 'true',
        protectedVerificationEnabled: true,
      }, {
        fetchFn,
        nowFn: () => currentTime,
        pollIntervalMs: 1,
        requiredConsecutiveSuccesses: 2,
        sleepFn: async () => {
          currentTime += 1;
          await sleepFn();
        },
        timeoutMs: 10,
        writeLog,
      });

      expect(fetchFn).toHaveBeenCalledTimes(9);
      expect(writeLog).toHaveBeenCalledWith(
        '[deploy] waiting for stable deploy rollout: health probe is missing rate-limit headers',
      );
      expect(writeLog).toHaveBeenCalledWith('[deploy] rollout probe 2 is stable (1/2)');
      expect(writeLog).toHaveBeenCalledWith('[deploy] rollout probe 3 is stable (2/2)');
    });

    it('times out with the last rollout issues when the deploy never stabilizes', async () => {
      const fetchFn = jest.fn()
        .mockResolvedValue(createJsonResponse(200, { message: 'OK' }));
      let currentTime = 0;

      await expect(waitForStableDeploy('https://wcag.qcraft.com.br', {
        deployValidationApiToken: 'deploy-token',
        productionApiAuthEnabled: 'true',
        protectedVerificationEnabled: false,
      }, {
        fetchFn,
        nowFn: () => currentTime,
        pollIntervalMs: 1,
        requiredConsecutiveSuccesses: 2,
        sleepFn: async () => {
          currentTime += 1;
        },
        timeoutMs: 2,
        writeLog: jest.fn(),
      })).rejects.toThrow(
        'Timed out waiting for deploy rollout to stabilize at https://wcag.qcraft.com.br. '
        + 'Last observed issues: health probe is missing rate-limit headers; '
        + 'protected auth probe returned 200; expected 401; '
        + 'protected auth probe did not return API_AUTHENTICATION_FAILED',
      );
    });
  });
});
