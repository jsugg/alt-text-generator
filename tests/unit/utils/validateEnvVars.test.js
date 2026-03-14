const ORIGINAL_ENV = process.env;
const PROVIDER_ENV_KEYS = [
  'REPLICATE_API_TOKEN',
  'REPLICATE_API_ENDPOINT',
  'REPLICATE_USER_AGENT',
  'REPLICATE_MODEL_OWNER',
  'REPLICATE_MODEL_NAME',
  'REPLICATE_MODEL_VERSION',
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

const loadValidator = ({ overrides = {}, remove = [] } = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

  PROVIDER_ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });

  remove.forEach((key) => {
    delete process.env[key];
  });

  Object.entries(overrides).forEach(([key, value]) => {
    process.env[key] = value;
  });

  // eslint-disable-next-line global-require
  return require('../../../src/utils/validateEnvVars').validateEnvVars;
};

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.resetModules();
});

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
      remove: ['TLS_KEY', 'TLS_CERT'],
    });

    expect(() => validateEnvVars()).toThrow(/TLS_KEY/);
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
