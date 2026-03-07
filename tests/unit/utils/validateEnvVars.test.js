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
});
