const fs = require('node:fs');
const path = require('node:path');

const {
  buildDeployEnvVars,
  buildDeployNewmanArgs,
  buildDeployProbeUrls,
  collectDeployStabilizationIssues,
  hasRequiredRateLimitHeaders,
  normalizeBooleanFlag,
  normalizeBaseUrl,
  parseArgs,
  requestDeployProbe,
  resolvePostDeployProviderPlans,
  resolveProductionDeployAuthConfig,
  waitForStableDeploy,
} = require('../../../scripts/run-postman-deploy');

const ROOT = path.resolve(__dirname, '../../..');

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

describe('Unit | Scripts | Run Postman Deploy', () => {
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
    it('targets the production api-docs page for deploy scraper verification', () => {
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

  describe('buildDeployNewmanArgs', () => {
    it('keeps the deploy JSON and JUnit reporters by default', () => {
      expect(buildDeployNewmanArgs('https://wcag.qcraft.com.br', {
        deployValidationApiToken: 'deploy-token',
        folders: ['95 Post Deploy Verification'],
        productionApiAuthEnabled: 'true',
      })).toEqual(expect.arrayContaining([
        '-r',
        'cli,json,junit',
        '--reporter-json-export',
        expect.stringMatching(/reports\/newman\/post-deploy\.json$/),
        '--reporter-junit-export',
        expect.stringMatching(/reports\/newman\/post-deploy\.xml$/),
      ]));
    });

    it('adds the Allure reporter when a results directory is configured', () => {
      expect(buildDeployNewmanArgs('https://wcag.qcraft.com.br', {
        allureResultsDir: '/tmp/allure-results',
        deployValidationApiToken: 'deploy-token',
        folders: ['95 Post Deploy Verification'],
        productionApiAuthEnabled: 'true',
      })).toEqual(expect.arrayContaining([
        '-r',
        'cli,json,junit,allure',
        '--reporter-allure-resultsDir',
        '/tmp/allure-results',
      ]));
    });
  });

  describe('buildDeployProbeUrls', () => {
    it('builds deploy rollout probe URLs from the production base URL', () => {
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
        protectedVerificationSkipReason: 'Skipping 96 Post Deploy Protected Verification because '
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
        protectedVerificationSkipReason: 'Skipping 96 Post Deploy Protected Verification because '
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

  describe('resolvePostDeployProviderPlans', () => {
    it('keeps the post-deploy provider subset on low-cost providers only', () => {
      expect(resolvePostDeployProviderPlans({
        LIVE_PROVIDER_SCOPE: 'all',
        HF_API_KEY: 'hf-key',
        OPENAI_API_KEY: 'openai-key',
        OPENROUTER_API_KEY: 'openrouter-key',
        TOGETHER_API_KEY: 'together-key',
      })).toEqual({
        providerPlans: [
          {
            envVars: ['model=huggingface'],
            folderName: '90 Provider Validation',
            scopeKey: 'huggingface',
          },
          {
            envVars: ['model=openai'],
            folderName: '90 Provider Validation',
            scopeKey: 'openai',
          },
          {
            envVars: ['model=together'],
            folderName: '90 Provider Validation',
            scopeKey: 'together',
          },
        ],
        providerScope: 'all',
      });
    });
  });

  describe('package and workflow wiring', () => {
    it('uses postman:post-deploy as the canonical npm command', () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
      );

      expect(packageJson.scripts['postman:post-deploy']).toBe('node scripts/run-postman-deploy.js');
      expect(packageJson.scripts['postman:deploy']).toBeUndefined();
    });

    it('invokes postman:post-deploy from the post-deploy workflow', () => {
      const workflow = fs.readFileSync(
        path.join(ROOT, '.github/workflows/post-deploy-verification.yml'),
        'utf8',
      );

      expect(workflow).toContain('npm run postman:post-deploy -- --base-url "$'
        + '{BASE_URL}"');
      expect(workflow).not.toContain('postman:deploy');
    });

    it('pins release validation workflows to Hugging Face, OpenAI, and Together', () => {
      const postDeployWorkflow = fs.readFileSync(
        path.join(ROOT, '.github/workflows/post-deploy-verification.yml'),
        'utf8',
      );
      const promoteWorkflow = fs.readFileSync(
        path.join(ROOT, '.github/workflows/promote-to-production.yml'),
        'utf8',
      );

      expect(postDeployWorkflow).toContain('HF_API_KEY: $'
        + '{{ secrets.HF_API_KEY }}');
      expect(postDeployWorkflow).toContain('HF_MODEL: Qwen/Qwen3-VL-30B-A3B-Instruct:fastest');
      expect(postDeployWorkflow).toContain('OPENAI_API_KEY: $'
        + '{{ secrets.OPENAI_API_KEY }}');
      expect(postDeployWorkflow).toContain('OPENAI_MODEL: gpt-4.1-nano');
      expect(postDeployWorkflow).toContain('TOGETHER_API_KEY: $'
        + '{{ secrets.TOGETHER_API_KEY }}');
      expect(postDeployWorkflow).not.toContain('OPENROUTER_API_KEY');
      expect(postDeployWorkflow).not.toContain('OPENROUTER_MODEL');

      expect(promoteWorkflow).toContain('HF_API_KEY: $'
        + '{{ secrets.HF_API_KEY }}');
      expect(promoteWorkflow).toContain('HF_MODEL: Qwen/Qwen3-VL-30B-A3B-Instruct:fastest');
      expect(promoteWorkflow).toContain('OPENAI_API_KEY: $'
        + '{{ secrets.OPENAI_API_KEY }}');
      expect(promoteWorkflow).toContain('OPENAI_MODEL: gpt-4.1-nano');
      expect(promoteWorkflow).toContain('TOGETHER_API_KEY: $'
        + '{{ secrets.TOGETHER_API_KEY }}');
      expect(promoteWorkflow).not.toContain('OPENROUTER_API_KEY');
      expect(promoteWorkflow).not.toContain('OPENROUTER_MODEL');
    });
  });
});
