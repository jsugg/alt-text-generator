describe('Unit | Providers | Runtime Registry', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('throws when a configured provider is missing a runtime builder', () => {
    jest.doMock('../../../config/providerCatalog', () => ({
      getConfiguredProvidersFromConfig: jest.fn(() => [
        { key: 'unsupported', configKey: 'unsupported' },
      ]),
    }));

    // eslint-disable-next-line global-require
    const { buildImageDescriberFactory } = require('../../../src/providers/runtimeRegistry');

    expect(() => buildImageDescriberFactory({
      config: {},
      logger: {
        info: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
      },
      httpClient: {},
      outboundClients: {},
      requestOptions: {},
    })).toThrow("No runtime builder registered for provider 'unsupported'");
  });
});
