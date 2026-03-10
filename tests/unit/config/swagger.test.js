describe('config/swagger', () => {
  const loadSwaggerDefinition = ({ env, devServerUrl, prodServerUrl }) => {
    jest.resetModules();

    jest.doMock('swagger-jsdoc', () => jest.fn((options) => options.swaggerDefinition));
    jest.doMock('../../../config', () => ({
      env,
      swagger: {
        devServerUrl,
        prodServerUrl,
      },
    }));

    let swaggerDefinition;

    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      swaggerDefinition = require('../../../config/swagger');
    });

    jest.dontMock('swagger-jsdoc');
    jest.dontMock('../../../config');

    return swaggerDefinition;
  };

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('uses only the development Swagger server outside production', () => {
    const swaggerDefinition = loadSwaggerDefinition({
      env: 'development',
      devServerUrl: 'https://localhost:8443',
      prodServerUrl: 'https://wcag.qcraft.com.br',
    });

    expect(swaggerDefinition.servers).toEqual([
      {
        url: 'https://localhost:8443',
        description: 'Development server',
      },
    ]);
  });

  it('uses only the production Swagger server in production', () => {
    const swaggerDefinition = loadSwaggerDefinition({
      env: 'production',
      devServerUrl: 'https://localhost:8443',
      prodServerUrl: 'https://wcag.qcraft.com.br',
    });

    expect(swaggerDefinition.servers).toEqual([
      {
        url: 'https://wcag.qcraft.com.br',
        description: 'Production server',
      },
    ]);
  });
});
