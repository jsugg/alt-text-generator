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

  const loadParsedSwaggerSpec = ({ env, devServerUrl, prodServerUrl }) => {
    jest.resetModules();

    jest.doMock('../../../config', () => ({
      env,
      swagger: {
        devServerUrl,
        prodServerUrl,
      },
    }));

    let swaggerSpec;

    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      swaggerSpec = require('../../../config/swagger');
    });

    jest.dontMock('../../../config');

    return swaggerSpec;
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

  it('publishes runnable encoded examples for image and page endpoints', () => {
    const swaggerSpec = loadParsedSwaggerSpec({
      env: 'production',
      devServerUrl: 'https://localhost:8443',
      prodServerUrl: 'https://wcag.qcraft.com.br',
    });

    const descriptionParameters = swaggerSpec.paths['/api/accessibility/description'].get.parameters;
    const descriptionImageSource = descriptionParameters.find(
      (parameter) => parameter.name === 'image_source',
    );
    const pageParameters = swaggerSpec.paths['/api/accessibility/descriptions'].get.parameters;
    const pageUrl = pageParameters.find((parameter) => parameter.name === 'url');
    const scraperParameters = swaggerSpec.paths['/api/scraper/images'].get.parameters;
    const scraperUrl = scraperParameters.find((parameter) => parameter.name === 'url');
    const responseImageExample = swaggerSpec.paths['/api/accessibility/description']
      .get.responses['200']
      .content['application/json']
      .schema.items
      .properties.imageUrl.example;
    const serializedSpec = JSON.stringify(swaggerSpec);

    expect(descriptionImageSource.schema.example).toBe(
      'https%3A%2F%2Fdeveloper.chrome.com%2Fstatic%2Fimages%2Fai-homepage-card.png',
    );
    expect(pageUrl.schema.example).toBe('https%3A%2F%2Fdeveloper.chrome.com%2F');
    expect(scraperUrl.schema.example).toBe('https%3A%2F%2Fdeveloper.chrome.com%2F');
    expect(responseImageExample).toBe(
      'https://developer.chrome.com/static/images/ai-homepage-card.png',
    );
    expect(serializedSpec).not.toContain('example.com');
    expect(serializedSpec).not.toContain('neymarques.com');
  });
});
