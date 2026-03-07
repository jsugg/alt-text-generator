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
  it('allows production boot without TLS credentials when the platform terminates TLS upstream', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
      },
      remove: ['TLS_KEY', 'TLS_CERT'],
    });

    expect(() => validateEnvVars()).not.toThrow();
  });

  it('requires TLS_KEY and TLS_CERT to be configured together', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: '/tmp/tls.key',
      },
      remove: ['TLS_CERT'],
    });

    expect(() => validateEnvVars()).toThrow(/TLS_CERT/);
  });

  it('accepts explicit production TLS configuration when both values are present', () => {
    const validateEnvVars = loadValidator({
      overrides: {
        NODE_ENV: 'production',
        REPLICATE_API_TOKEN: 'test-token',
        TLS_KEY: '/tmp/tls.key',
        TLS_CERT: '/tmp/tls.cert',
      },
    });

    expect(() => validateEnvVars()).not.toThrow();
  });
});
