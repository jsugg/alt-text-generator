const path = require('node:path');

const {
  buildNewmanReportPaths,
  buildNewmanReporterArgs,
  resolveAllureResultsDir,
} = require('../../scripts/postman/newman-reporting');
const { buildAppServerEnv } = require('../../scripts/postman/app-server-env');
const {
  DEFAULT_MAX_RESPONSE_TIME_MS,
  PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS,
  PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS,
  PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS,
  resolveMaxResponseTimeMs,
  resolveNewmanTimeoutRequestMs,
} = require('../../scripts/postman/harness-timeouts');

describe('Unit | Postman Harness Reporting', () => {
  it('uses provider-validation budgets only for provider-validation runs', () => {
    expect(resolveMaxResponseTimeMs()).toBe(DEFAULT_MAX_RESPONSE_TIME_MS);
    expect(resolveMaxResponseTimeMs({ providerValidationModeEnabled: true }))
      .toBe(PROVIDER_VALIDATION_MAX_RESPONSE_TIME_MS);
    expect(resolveNewmanTimeoutRequestMs()).toBe(10000);
    expect(resolveNewmanTimeoutRequestMs({ providerValidationModeEnabled: true }))
      .toBe(PROVIDER_VALIDATION_NEWMAN_TIMEOUT_REQUEST_MS);
    expect(PROVIDER_VALIDATION_APP_REQUEST_TIMEOUT_MS).toBe(90000);
  });

  it('keeps the existing CLI, JSON, and JUnit reporters by default', () => {
    const args = buildNewmanReporterArgs({
      label: 'smoke',
      reportsDir: path.join(process.cwd(), 'reports', 'newman'),
    });

    expect(args).toEqual([
      '-r',
      'cli,json,junit',
      '--reporter-json-export',
      path.join(process.cwd(), 'reports', 'newman', 'smoke.json'),
      '--reporter-junit-export',
      path.join(process.cwd(), 'reports', 'newman', 'smoke.xml'),
    ]);
  });

  it('derives stable JSON and JUnit report paths from the run label', () => {
    expect(buildNewmanReportPaths({
      label: 'provider-integration-openai',
      reportsDir: path.join(process.cwd(), 'reports', 'newman'),
    })).toEqual({
      jsonReportPath: path.join(
        process.cwd(),
        'reports',
        'newman',
        'provider-integration-openai.json',
      ),
      junitReportPath: path.join(
        process.cwd(),
        'reports',
        'newman',
        'provider-integration-openai.xml',
      ),
    });
  });

  it('adds the Allure reporter when a results directory is configured', () => {
    const args = buildNewmanReporterArgs({
      label: 'core',
      reportsDir: path.join(process.cwd(), 'reports', 'newman'),
      allureResultsDir: '/tmp/allure-results',
    });

    expect(args).toEqual([
      '-r',
      'cli,json,junit,allure',
      '--reporter-json-export',
      path.join(process.cwd(), 'reports', 'newman', 'core.json'),
      '--reporter-junit-export',
      path.join(process.cwd(), 'reports', 'newman', 'core.xml'),
      '--reporter-allure-resultsDir',
      '/tmp/allure-results',
    ]);
  });

  it('resolves and trims the Allure results directory from the environment', () => {
    expect(resolveAllureResultsDir({
      ALLURE_RESULTS_DIR: ' reports/allure-results ',
    }, process.cwd())).toBe(path.join(process.cwd(), 'reports', 'allure-results'));
    expect(resolveAllureResultsDir({}, process.cwd())).toBeNull();
  });

  it('forces the local harness app servers to ignore repo-level provider overrides', () => {
    expect(buildAppServerEnv({
      httpPort: '8080',
      httpsPort: '8443',
    })).toMatchObject({
      PROVIDER_OVERRIDES_FILE: path.join(
        process.cwd(),
        'tests',
        'fixtures',
        'provider-overrides.missing.yaml',
      ),
    });
  });

  it('maps every optional provider and timeout override into the app env', () => {
    expect(buildAppServerEnv({
      httpPort: '8080',
      httpsPort: '8443',
      replicateApiEndpoint: 'https://replicate.example.com',
      replicateApiToken: 'replicate-token',
      azureApiEndpoint: 'https://azure.example.com',
      azureSubscriptionKey: 'azure-key',
      openaiApiKey: 'openai-key',
      openaiBaseUrl: 'https://openai.example.com/v1',
      openaiModel: 'gpt-4.1-nano',
      hfApiKey: 'hf-key',
      hfBaseUrl: 'https://huggingface.example.com/v1',
      hfModel: 'Qwen/Qwen3-VL-30B-A3B-Instruct:fastest',
      openrouterApiKey: 'openrouter-key',
      openrouterBaseUrl: 'https://openrouter.example.com/api/v1',
      openrouterModel: 'google/gemma-3-4b-it:free',
      apiAuthTokens: 'token-a,token-b',
      scraperRequestTimeoutMs: '2500',
      pageDescriptionConcurrency: '2',
      descriptionJobWaitTimeoutMs: '50',
      descriptionJobPollIntervalMs: '10',
      replicatePollIntervalMs: '5',
    })).toMatchObject({
      PORT: '8080',
      TLS_PORT: '8443',
      REPLICATE_API_ENDPOINT: 'https://replicate.example.com',
      REPLICATE_API_TOKEN: 'replicate-token',
      ACV_API_ENDPOINT: 'https://azure.example.com',
      ACV_SUBSCRIPTION_KEY: 'azure-key',
      OPENAI_API_KEY: 'openai-key',
      OPENAI_BASE_URL: 'https://openai.example.com/v1',
      OPENAI_MODEL: 'gpt-4.1-nano',
      HF_API_KEY: 'hf-key',
      HF_BASE_URL: 'https://huggingface.example.com/v1',
      HF_MODEL: 'Qwen/Qwen3-VL-30B-A3B-Instruct:fastest',
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_BASE_URL: 'https://openrouter.example.com/api/v1',
      OPENROUTER_MODEL: 'google/gemma-3-4b-it:free',
      API_AUTH_ENABLED: 'true',
      API_AUTH_TOKENS: 'token-a,token-b',
      SCRAPER_REQUEST_TIMEOUT_MS: '2500',
      PAGE_DESCRIPTION_CONCURRENCY: '2',
      DESCRIPTION_JOB_WAIT_TIMEOUT_MS: '50',
      DESCRIPTION_JOB_POLL_INTERVAL_MS: '10',
      REPLICATE_POLL_INTERVAL_MS: '5',
    });
  });
});
