const fs = require('node:fs');
const path = require('node:path');

const {
  assertPublicHttpUrl,
  buildLiveProviderEnvVars,
  buildLiveProviderNewmanArgs,
  isPrivateHostname,
  parseArgs,
} = require('../../../scripts/run-postman-live');
const {
  buildPublicProviderValidationFixtureUrls,
} = require('../../../scripts/postman/provider-validation-public-fixtures');
const {
  PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS,
  PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS,
} = require('../../../scripts/postman/harness-timeouts');
const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertNoRunCommandContainsInvariant,
  assertStepUsesAction,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../../helpers/workflowAssertions');

const ROOT = path.resolve(__dirname, '../../..');

describe('Unit | Scripts | Run Postman Live', () => {
  describe('parseArgs', () => {
    it('uses the canonical production base URL by default', () => {
      expect(parseArgs([])).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br',
      });
    });

    it('parses the supported base-url flag', () => {
      expect(parseArgs(['--base-url', 'https://example.com/preview'])).toEqual({
        baseUrl: 'https://example.com/preview',
      });
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs(['--nope', 'value'])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('isPrivateHostname', () => {
    it('recognizes localhost and RFC1918 addresses', () => {
      expect(isPrivateHostname('localhost')).toBe(true);
      expect(isPrivateHostname('127.0.0.1')).toBe(true);
      expect(isPrivateHostname('10.0.0.4')).toBe(true);
      expect(isPrivateHostname('192.168.1.10')).toBe(true);
      expect(isPrivateHostname('wcag.qcraft.com.br')).toBe(false);
    });
  });

  describe('assertPublicHttpUrl', () => {
    it('accepts public https urls', () => {
      expect(() => assertPublicHttpUrl('https://wcag.qcraft.com.br/provider-validation/page', 'baseUrl'))
        .not.toThrow();
    });

    it('rejects localhost, private hosts, and non-http protocols', () => {
      expect(() => assertPublicHttpUrl('http://127.0.0.1/provider-validation/page', 'baseUrl'))
        .toThrow('baseUrl must not target localhost or a private-network host');
      expect(() => assertPublicHttpUrl('file:///tmp/a.png', 'providerValidationImageUrl'))
        .toThrow('providerValidationImageUrl must use http or https');
    });
  });

  describe('buildLiveProviderEnvVars', () => {
    it('uses public provider-validation fixtures alongside the live base URL', () => {
      const fixtureUrls = buildPublicProviderValidationFixtureUrls();

      expect(buildLiveProviderEnvVars('https://wcag.qcraft.com.br/', {
        deployValidationApiToken: 'deploy-token',
        productionApiAuthEnabled: 'true',
      })).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br',
        deployValidationApiToken: 'deploy-token',
        expectedSwaggerServerUrl: 'https://wcag.qcraft.com.br',
        productionApiAuthEnabled: 'true',
        ...fixtureUrls,
        maxResponseTimeMs: String(PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS),
      });
    });
  });

  describe('buildLiveProviderNewmanArgs', () => {
    it('includes derived provider validation vars and requested folders', () => {
      const fixtureUrls = buildPublicProviderValidationFixtureUrls();

      expect(buildLiveProviderNewmanArgs('https://wcag.qcraft.com.br', {
        authConfig: {
          deployValidationApiToken: 'deploy-token',
          productionApiAuthEnabled: 'true',
        },
        folders: ['90 Provider Validation'],
        label: 'live-provider-openai',
        providerEnvVars: ['model=openai'],
      })).toEqual(expect.arrayContaining([
        '--env-var',
        'baseUrl=https://wcag.qcraft.com.br',
        '--env-var',
        'deployValidationApiToken=deploy-token',
        '--env-var',
        'productionApiAuthEnabled=true',
        '--env-var',
        `providerValidationImageUrl=${fixtureUrls.providerValidationImageUrl}`,
        '--env-var',
        `providerValidationPageUrl=${fixtureUrls.providerValidationPageUrl}`,
        '--env-var',
        'model=openai',
        '--timeout-request',
        String(PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS),
        '--folder',
        '90 Provider Validation',
      ]));
    });
  });

  describe('package and workflow wiring', () => {
    it('uses postman:live-provider as the canonical npm command', () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
      );

      expect(packageJson.scripts['postman:live-provider']).toBe('node scripts/run-postman-live.js');
      expect(packageJson.scripts['postman:hosted-provider']).toBeUndefined();
    });

    it('invokes postman:live-provider from the live workflow', () => {
      const workflow = loadWorkflow('live-provider-validation.yml');
      const scheduleDisabledJob = getJob(workflow, 'schedule-disabled');
      const liveProviderJob = getJob(workflow, 'live-provider');
      const setupProjectStep = findStepByName(liveProviderJob, 'live-provider', 'Setup project');
      const liveProviderStep = findStepByName(
        liveProviderJob,
        'live-provider',
        'Run production description service validation',
      );
      const uploadArtifactsStep = findStepByName(
        liveProviderJob,
        'live-provider',
        'Upload production description service artifacts',
      );

      assertDeepEqualInvariant(
        'Live provider validation supports manual public URL runs and scheduled production checks',
        workflow.on,
        {
          workflow_dispatch: {
            inputs: {
              base_url: {
                description: 'Base URL of the deployed API to validate against.',
                required: false,
                default: 'https://wcag.qcraft.com.br',
                type: 'string',
              },
              provider_scope: {
                description: 'Select the live provider scope. Use auto to defer to the prod-validation LIVE_PROVIDER_SCOPE variable.',
                required: false,
                default: 'auto',
                type: 'choice',
                options: [
                  'auto',
                  'azure',
                  'replicate',
                  'huggingface',
                  'openai',
                  'openrouter',
                  'together',
                  'all',
                ],
              },
            },
          },
          schedule: [{ cron: '23 8 * * 1' }],
        },
      );
      assertDeepEqualInvariant(
        'Live provider validation keeps top-level token permissions read-only',
        workflow.permissions,
        { contents: 'read' },
      );
      assertDeepEqualInvariant(
        'Live provider validation keeps the schedule guard and provider jobs',
        Object.keys(workflow.jobs),
        ['schedule-disabled', 'live-provider'],
      );
      assertExpressionContainsInvariant(
        'Live provider validation schedule guard runs only when scheduled validation is disabled',
        scheduleDisabledJob.if,
        "github.event_name == 'schedule'",
      );
      assertExpressionContainsInvariant(
        'Live provider validation job runs for manual events or enabled schedules',
        liveProviderJob.if,
        "github.event_name != 'schedule'",
      );
      assertStepUsesAction(
        'Live provider validation uses the repository setup-node-project action',
        setupProjectStep,
        './.github/actions/setup-node-project',
      );
      assertEqualInvariant(
        'Live provider workflow invokes the canonical postman:live-provider package script',
        liveProviderStep.run,
        'npm run postman:live-provider -- --base-url "${BASE_URL}"',
      );
      assertStepUsesAction(
        'Live provider workflow uploads Newman artifacts with actions/upload-artifact',
        uploadArtifactsStep,
        'actions/upload-artifact',
      );
      assertNoRunCommandContainsInvariant(
        workflow,
        'postman:hosted-provider',
        'Live provider workflow must not call the removed postman:hosted-provider script',
      );
    });
  });
});
