const path = require('node:path');

const { loadFreshModule } = require('../../setup/testEnv');

const NO_PROVIDER_OVERRIDES_FILE = path.join(
  __dirname,
  '../../fixtures/provider-overrides.missing.yaml',
);
const PROVIDER_ENV_KEYS = [
  'PROVIDER_OVERRIDES_FILE',
  'REPLICATE_API_TOKEN',
  'REPLICATE_API_ENDPOINT',
  'REPLICATE_USER_AGENT',
  'REPLICATE_MODEL_OWNER',
  'REPLICATE_MODEL_NAME',
  'REPLICATE_MODEL_VERSION',
  'REPLICATE_REQUEST_TIMEOUT_MS',
  'REPLICATE_POLL_INTERVAL_MS',
  'DESCRIPTION_JOB_STORE',
  'DESCRIPTION_JOB_REDIS_URL',
  'DESCRIPTION_JOB_REDIS_PREFIX',
  'DESCRIPTION_JOB_WAIT_TIMEOUT_MS',
  'DESCRIPTION_JOB_POLL_INTERVAL_MS',
  'DESCRIPTION_JOB_PENDING_TTL_MS',
  'DESCRIPTION_JOB_COMPLETED_TTL_MS',
  'DESCRIPTION_JOB_FAILED_TTL_MS',
  'DESCRIPTION_JOB_CLAIM_TTL_MS',
  'ACV_API_ENDPOINT',
  'ACV_SUBSCRIPTION_KEY',
  'ACV_LANGUAGE',
  'ACV_MAX_CANDIDATES',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_MAX_TOKENS',
  'OPENAI_PROMPT',
  'HF_API_KEY',
  'HF_TOKEN',
  'HF_BASE_URL',
  'HF_MODEL',
  'HF_MAX_TOKENS',
  'HF_PROMPT',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OLLAMA_PROMPT',
  'OLLAMA_KEEP_ALIVE',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_MODEL',
  'OPENROUTER_MAX_TOKENS',
  'OPENROUTER_PROMPT',
  'OPENROUTER_HTTP_REFERER',
  'OPENROUTER_TITLE',
  'TOGETHER_API_KEY',
  'TOGETHER_BASE_URL',
  'TOGETHER_MODEL',
  'TOGETHER_MAX_TOKENS',
  'TOGETHER_PROMPT',
];

// Env restoration and module-cache isolation are handled by tests/setup. Each
// load starts from the provider-free baseline (every provider key cleared) and
// then applies the test's removals and overrides.
const loadValidator = ({ overrides = {}, remove = [] } = {}) => loadFreshModule(
  () => require('../../../src/utils/validateEnvVars').validateEnvVars,
  {
    ...Object.fromEntries(PROVIDER_ENV_KEYS.map((key) => [key, undefined])),
    PROVIDER_OVERRIDES_FILE: NO_PROVIDER_OVERRIDES_FILE,
    ...Object.fromEntries(remove.map((key) => [key, undefined])),
    ...overrides,
  },
);

describe('Unit | Utils | Validate Env Vars', () => {
  it('accepts a Replicate-only provider configuration', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
      },
      remove: ['ACV_API_ENDPOINT', 'ACV_SUBSCRIPTION_KEY'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('accepts an Azure-only provider configuration', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      },
      remove: ['REPLICATE_API_TOKEN'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('logs a warning and ignores Azure when its config is partial', () => {
    const logger = {
      warn: jest.fn(),
    };
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      },
    });

    expect(() => validateEnvVars({ logger })).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      { provider: 'azure' },
      'Azure provider disabled for this run because ACV_API_ENDPOINT and '
      + 'ACV_SUBSCRIPTION_KEY must both be set and non-empty.',
    );
  });

  it('accepts an OpenAI-only provider configuration', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        OPENAI_API_KEY: 'openai-key',
      },
      remove: ['REPLICATE_API_TOKEN', 'ACV_API_ENDPOINT', 'ACV_SUBSCRIPTION_KEY'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('accepts an Ollama-only provider configuration', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        OLLAMA_MODEL: 'llama3.2-vision',
      },
      remove: ['REPLICATE_API_TOKEN', 'ACV_API_ENDPOINT', 'ACV_SUBSCRIPTION_KEY'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('accepts a Together-only provider configuration', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        TOGETHER_API_KEY: 'together-key',
      },
      remove: ['REPLICATE_API_TOKEN', 'ACV_API_ENDPOINT', 'ACV_SUBSCRIPTION_KEY'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('rejects startup when no provider is configured', () => {
    const validateEnvVars = loadValidator({
      remove: ['REPLICATE_API_TOKEN', 'ACV_API_ENDPOINT', 'ACV_SUBSCRIPTION_KEY'],
    });

    expect(() => validateEnvVars()).toThrow(/at least one provider must be configured/i);
  });

  it('accepts TLS_* credentials in production', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('requires production TLS credentials when TLS_* is missing', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
      },
      remove: ['TLS_KEY', 'TLS_CERT', 'TLS_ENABLED'],
    });

    expect(() => validateEnvVars()).toThrow(/TLS_KEY/);
  });

  it('does not require production TLS credentials when TLS_ENABLED=false', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        TLS_ENABLED: 'false',
        REPLICATE_API_TOKEN: 'test-token',
      },
      remove: ['TLS_KEY', 'TLS_CERT'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('requires production TLS credentials when TLS_ENABLED=true', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        TLS_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'test-token',
      },
      remove: ['TLS_KEY', 'TLS_CERT'],
    });

    expect(() => validateEnvVars()).toThrow(/TLS_KEY/);
  });

  it('requires TLS_CERT in production when only TLS_KEY is supplied', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
      },
      remove: ['TLS_CERT', 'TLS_ENABLED'],
    });

    expect(() => validateEnvVars()).toThrow(/TLS_CERT/);
  });

  it('accepts TLS_ENABLED=false in production alongside unused TLS credentials', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        TLS_ENABLED: 'false',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('rejects a TLS_ENABLED value other than true or false', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        TLS_ENABLED: 'disabled',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
      },
    });

    expect(() => validateEnvVars()).toThrow(/TLS_ENABLED/);
  });

  it('leaves TLS credentials optional outside production when TLS_ENABLED=true', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'development',
        TLS_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'test-token',
      },
      remove: ['TLS_KEY', 'TLS_CERT'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it.each([
    ['127.0.0.1:19090'],
    ['localhost'],
    ['fixtures.internal:8080,127.0.0.1:19090'],
    ['api.example.com'],
    ['[::1]:8080'],
    [''],
  ])('accepts OUTBOUND_ALLOWED_HOSTS=%s', (value) => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        OUTBOUND_ALLOWED_HOSTS: value,
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  // Every one of these would previously have been accepted and then silently
  // never matched, which for an allowlist is indistinguishable from working.
  it.each([
    ['*.example.com'],
    ['example.com/path'],
    ['https://example.com'],
    ['example.com:99999999'],
    ['exam ple.com'],
  ])('rejects OUTBOUND_ALLOWED_HOSTS=%s', (value) => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        OUTBOUND_ALLOWED_HOSTS: value,
      },
    });

    expect(() => validateEnvVars()).toThrow(/OUTBOUND_ALLOWED_HOSTS/);
  });

  it('accepts a non-negative TRUST_PROXY_HOPS override', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
        TRUST_PROXY_HOPS: '2',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('accepts valid cluster lifecycle overrides', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
        CLUSTER_RESTART_BACKOFF_MS: '1000',
        CLUSTER_RESTART_MAX_BACKOFF_MS: '5000',
        CLUSTER_CRASH_WINDOW_MS: '45000',
        CLUSTER_MAX_CRASHES: '4',
        CLUSTER_SHUTDOWN_TIMEOUT_MS: '8000',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('accepts multi-worker startup when Redis-backed rate limiting is configured', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
        WORKER_COUNT: '4',
        REDIS_URL: 'redis://shared.example:6379',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('accepts multi-worker startup when the future unit-local Redis flag is enabled', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        RATE_LIMIT_REDIS_TOPOLOGY: 'unit-local',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
        WORKER_COUNT: '3',
      },
      remove: ['RATE_LIMIT_REDIS_URL', 'REDIS_URL'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('rejects a negative TRUST_PROXY_HOPS override', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
        TRUST_PROXY_HOPS: '-1',
      },
    });

    expect(() => validateEnvVars()).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('rejects a max restart backoff smaller than the base restart backoff', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
        CLUSTER_RESTART_BACKOFF_MS: '5000',
        CLUSTER_RESTART_MAX_BACKOFF_MS: '1000',
      },
    });

    expect(() => validateEnvVars()).toThrow(/CLUSTER_RESTART_MAX_BACKOFF_MS/);
  });

  it('rejects Redis-backed rate limiting without a Redis URL', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        RATE_LIMIT_STORE: 'redis',
      },
      remove: ['RATE_LIMIT_REDIS_URL', 'REDIS_URL'],
    });

    expect(() => validateEnvVars()).toThrow(/RATE_LIMIT_STORE=redis/i);
  });

  it('rejects Redis-backed description jobs without a Redis URL', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        DESCRIPTION_JOB_STORE: 'redis',
      },
      remove: ['DESCRIPTION_JOB_REDIS_URL', 'RATE_LIMIT_REDIS_URL', 'REDIS_URL'],
    });

    expect(() => validateEnvVars()).toThrow(/DESCRIPTION_JOB_STORE=redis/i);
  });

  it('rejects multi-worker startup without a shared Redis-backed store', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: 'tls-key',
        TLS_CERT: 'tls-cert',
        WORKER_COUNT: '2',
      },
      remove: ['RATE_LIMIT_REDIS_URL', 'REDIS_URL'],
    });

    expect(() => validateEnvVars()).toThrow(/WORKER_COUNT greater than 1/i);
  });

  it('accepts Azure provider credentials when endpoint and subscription key are set', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      },
      remove: ['REPLICATE_API_TOKEN'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('rejects an Azure endpoint without credentials', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      },
      remove: ['REPLICATE_API_TOKEN', 'ACV_SUBSCRIPTION_KEY'],
    });

    expect(() => validateEnvVars()).toThrow(/ACV_API_ENDPOINT/);
  });

  it('rejects Azure credentials without an endpoint', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      },
      remove: ['REPLICATE_API_TOKEN', 'ACV_API_ENDPOINT'],
    });

    expect(() => validateEnvVars()).toThrow(/ACV_API_ENDPOINT/);
  });

  it('rejects OpenAI overrides without an API key', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        OPENAI_MODEL: 'gpt-4.1-nano',
      },
      remove: ['REPLICATE_API_TOKEN', 'ACV_API_ENDPOINT', 'ACV_SUBSCRIPTION_KEY', 'OPENAI_API_KEY'],
    });

    expect(() => validateEnvVars()).toThrow(/OPENAI_API_KEY/);
  });

  it('accepts non-empty API auth tokens when provided', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        API_AUTH_ENABLED: 'true',
        API_AUTH_TOKENS: 'token-a, token-b',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('rejects API auth tokens when the configured list is empty after trimming', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        API_AUTH_TOKENS: ' ,  , ',
      },
    });

    expect(() => validateEnvVars()).toThrow(/API_AUTH_TOKENS/);
  });

  it('rejects API auth enablement without any configured tokens', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        API_AUTH_ENABLED: 'true',
      },
      remove: ['API_AUTH_TOKENS'],
    });

    expect(() => validateEnvVars()).toThrow(/API_AUTH_ENABLED=true requires API_AUTH_TOKENS/);
  });

  it('accepts explicitly disabled API auth without configured tokens', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        API_AUTH_ENABLED: 'false',
      },
      remove: ['API_AUTH_TOKENS'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });
});
