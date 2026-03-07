const ORIGINAL_ENV = process.env;

const loadValidator = ({ overrides = {}, remove = [] } = {}) => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };

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

describe('validateEnvVars', () => {
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

  it('accepts Azure provider credentials when endpoint and subscription key are set', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('accepts the legacy Azure API key alias', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
        ACV_API_KEY: 'azure-key',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('rejects an Azure endpoint without credentials', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        ACV_API_ENDPOINT: 'https://azure.example.com/vision/v3.2/describe',
      },
      remove: ['ACV_API_KEY', 'ACV_SUBSCRIPTION_KEY'],
    });

    expect(() => validateEnvVars()).toThrow(/ACV_API_ENDPOINT/);
  });

  it('rejects Azure credentials without an endpoint', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        REPLICATE_API_TOKEN: 'test-token',
        ACV_SUBSCRIPTION_KEY: 'azure-key',
      },
      remove: ['ACV_API_ENDPOINT'],
    });

    expect(() => validateEnvVars()).toThrow(/ACV_API_ENDPOINT/);
  });
});
