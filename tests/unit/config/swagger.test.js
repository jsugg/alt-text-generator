describe('config/swagger', () => {
  const loadSwaggerDefinition = ({ env, devServerUrl, prodServerUrl }) => {
    jest.resetModules();
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
      swaggerDefinition = require('../../../config/swagger-base').createSwaggerDefinition();
    });

    jest.dontMock('../../../config');

    return swaggerDefinition;
  };

  const loadParsedSwaggerSpec = ({ servers }) => {
    jest.resetModules();

    jest.doMock('../../../config/swagger-base', () => ({
      buildServers: () => servers,
      getSwaggerJSDocOptions: jest.fn(),
    }));

    let swaggerSpec;

    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      swaggerSpec = require('../../../config/swagger');
    });

    jest.dontMock('../../../config/swagger-base');

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
      servers: [
        {
          url: 'https://wcag.qcraft.com.br',
          description: 'Production server',
        },
      ],
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

  it('publishes reusable auth schemes and protects non-health endpoints', () => {
    const swaggerSpec = loadParsedSwaggerSpec({
      servers: [
        {
          url: 'https://wcag.qcraft.com.br',
          description: 'Production server',
        },
      ],
    });

    expect(swaggerSpec.components.securitySchemes).toEqual({
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API token',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      },
    });
    expect(swaggerSpec.paths['/api/health'].get.security).toBeUndefined();
    expect(swaggerSpec.paths['/api/scraper/images'].get.security).toEqual([
      { bearerAuth: [] },
      { apiKeyAuth: [] },
    ]);
    expect(swaggerSpec.paths['/api/accessibility/description'].get.responses['401']
      .content['application/json'].schema).toEqual({
      $ref: '#/components/schemas/ApiErrorResponse',
    });
  });

  it('documents a public root service index', () => {
    const swaggerSpec = loadParsedSwaggerSpec({
      servers: [
        {
          url: 'https://wcag.qcraft.com.br',
          description: 'Production server',
        },
      ],
    });

    expect(swaggerSpec.paths['/'].get.security).toBeUndefined();
    expect(swaggerSpec.paths['/'].get.responses['200'].content['application/json'].schema)
      .toMatchObject({
        required: ['name', 'version', 'status', 'links', 'auth', 'requestId'],
        properties: {
          name: { type: 'string', example: 'alt-text-generator' },
          version: { type: 'string', example: '1.0.0' },
          status: { type: 'string', example: 'ok' },
          requestId: { type: 'string' },
        },
      });
    expect(swaggerSpec.paths['/'].get.responses['200'].content['application/json'].schema
      .properties.links.required).toEqual(['api', 'docs', 'health', 'ping']);
    expect(swaggerSpec.paths['/'].get.responses['200'].content['application/json'].schema
      .properties.auth.properties.schemes.example).toEqual(['X-API-Key', 'Bearer']);
  });

  it('prefers the generated OpenAPI artifact over runtime swagger-jsdoc parsing', () => {
    jest.resetModules();

    const swaggerJsdoc = jest.fn(() => {
      throw new Error('runtime swagger-jsdoc should not run when a generated spec exists');
    });

    jest.doMock('swagger-jsdoc', () => swaggerJsdoc);
    jest.doMock('../../../config/swagger-base', () => ({
      buildServers: () => [
        {
          url: 'https://wcag.qcraft.com.br',
          description: 'Production server',
        },
      ],
      getSwaggerJSDocOptions: jest.fn(),
    }));

    let swaggerSpec;

    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      swaggerSpec = require('../../../config/swagger');
    });

    expect(swaggerSpec.openapi).toBe('3.0.0');
    expect(swaggerSpec.servers).toEqual([
      {
        url: 'https://wcag.qcraft.com.br',
        description: 'Production server',
      },
    ]);
    expect(swaggerJsdoc).not.toHaveBeenCalled();

    jest.dontMock('swagger-jsdoc');
    jest.dontMock('../../../config/swagger-base');
  });

  it('falls back to runtime generation when the generated spec artifact is missing', () => {
    jest.resetModules();

    const swaggerJsdoc = jest.fn((options) => options.swaggerDefinition);

    jest.doMock('node:fs', () => ({
      existsSync: jest.fn(() => false),
      readFileSync: jest.fn(),
    }));
    jest.doMock('swagger-jsdoc', () => swaggerJsdoc);
    jest.doMock('../../../config/swagger-base', () => ({
      buildServers: () => [
        {
          url: 'https://wcag.qcraft.com.br',
          description: 'Production server',
        },
      ],
      getSwaggerJSDocOptions: () => ({
        swaggerDefinition: {
          openapi: '3.0.0',
          servers: [
            {
              url: 'https://wcag.qcraft.com.br',
              description: 'Production server',
            },
          ],
        },
      }),
    }));

    let swaggerSpec;

    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      swaggerSpec = require('../../../config/swagger');
    });

    expect(swaggerJsdoc).toHaveBeenCalledTimes(1);
    expect(swaggerSpec.servers).toEqual([
      {
        url: 'https://wcag.qcraft.com.br',
        description: 'Production server',
      },
    ]);

    jest.dontMock('node:fs');
    jest.dontMock('swagger-jsdoc');
    jest.dontMock('../../../config/swagger-base');
  });
});
