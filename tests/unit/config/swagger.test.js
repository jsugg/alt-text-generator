describe('Unit | Config | Swagger', () => {
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
      swaggerDefinition = require('../../../config/swagger-base').createSwaggerDefinition();
    });

    jest.dontMock('../../../config');

    return swaggerDefinition;
  };

  const PRODUCTION_SERVERS = [{ url: 'https://wcag.qcraft.com.br', description: 'Production server' }];

  const loadParsedSwaggerSpec = ({ servers } = { servers: PRODUCTION_SERVERS }) => {
    jest.resetModules();

    jest.doMock('../../../config/swagger-base', () => ({
      buildServers: () => servers,
      getSwaggerJSDocOptions: jest.fn(),
    }));

    let swaggerSpec;

    jest.isolateModules(() => {
      swaggerSpec = require('../../../config/swagger');
    });

    jest.dontMock('../../../config/swagger-base');

    return swaggerSpec;
  };

  const operation = (spec, route) => spec.paths[route].get;
  const parameter = (spec, route, name) => operation(spec, route).parameters
    .find((candidate) => candidate.name === name);
  const responseSchema = (spec, route, status) => operation(spec, route)
    .responses[status].content['application/json'].schema;

  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  // Server URLs: the only environment-specific part of the contract, injected at
  // serve time. The base artifact is server-agnostic; these assert the runtime
  // selection that config/swagger-base.buildServers performs.
  describe('server URLs', () => {
    it('exposes only the development server outside production', () => {
      const swaggerDefinition = loadSwaggerDefinition({
        env: 'development',
        devServerUrl: 'https://localhost:8443',
        prodServerUrl: 'https://wcag.qcraft.com.br',
      });

      expect(swaggerDefinition.servers).toEqual([
        { url: 'https://localhost:8443', description: 'Development server' },
      ]);
    });

    it('exposes only the production server in production', () => {
      const swaggerDefinition = loadSwaggerDefinition({
        env: 'production',
        devServerUrl: 'https://localhost:8443',
        prodServerUrl: 'https://wcag.qcraft.com.br',
      });

      expect(swaggerDefinition.servers).toEqual(PRODUCTION_SERVERS);
    });

    it('serves the generated artifact with the injected runtime servers', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(swaggerSpec.openapi).toBe('3.0.0');
      expect(swaggerSpec.servers).toEqual(PRODUCTION_SERVERS);
    });
  });

  // Public examples: the values a consumer copies straight into a request. These
  // assert the documented examples are the real, runnable encodings, which makes
  // the broad "spec contains no placeholder host" string scan redundant.
  describe('public examples', () => {
    it('publishes runnable URL-encoded request examples', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(parameter(swaggerSpec, '/api/accessibility/description', 'image_source').schema.example)
        .toBe('https%3A%2F%2Fdeveloper.chrome.com%2Fstatic%2Fimages%2Fai-homepage-card.png');
      expect(parameter(swaggerSpec, '/api/accessibility/descriptions', 'url').schema.example)
        .toBe('https%3A%2F%2Fdeveloper.chrome.com%2F');
      expect(parameter(swaggerSpec, '/api/scraper/images', 'url').schema.example)
        .toBe('https%3A%2F%2Fdeveloper.chrome.com%2F');
    });

    it('publishes the supported model enum identically on the description endpoints', () => {
      const swaggerSpec = loadParsedSwaggerSpec();
      const descriptionModel = parameter(swaggerSpec, '/api/accessibility/description', 'model');
      const pageModel = parameter(swaggerSpec, '/api/accessibility/descriptions', 'model');

      expect(descriptionModel.schema.enum).toEqual([
        'replicate', 'azure', 'ollama', 'huggingface', 'openai', 'openrouter', 'together',
      ]);
      expect(pageModel.schema.enum).toEqual(descriptionModel.schema.enum);
    });

    it('publishes a runnable response example for the image description endpoint', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(responseSchema(swaggerSpec, '/api/accessibility/description', '200')
        .items.properties.imageUrl.example)
        .toBe('https://developer.chrome.com/static/images/ai-homepage-card.png');
    });
  });

  // Required schemas: the fields a consumer is guaranteed to receive. These are
  // exactly the `required` arrays the backward-compatibility gate
  // (scripts/openapi/diff-contract.js) protects from narrowing.
  describe('required schemas', () => {
    it('declares the required fields of the public error contract', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(swaggerSpec.components.schemas.ApiErrorResponse.required).toEqual(['error', 'code']);
    });

    it('declares the required fields of the async job responses', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(swaggerSpec.components.schemas.DescriptionJobResponse.required)
        .toEqual(['jobId', 'model', 'imageUrl', 'status']);
      expect(swaggerSpec.components.schemas.PageDescriptionJobResponse.required)
        .toEqual(['jobId', 'model', 'pageUrl', 'status']);
    });

    it('declares the required fields of the health drain response', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(responseSchema(swaggerSpec, '/api/health', '503')).toMatchObject({
        required: ['message', 'ready', 'timestamp', 'uptime'],
        properties: {
          message: { type: 'string', example: 'DRAINING' },
          ready: { type: 'boolean', example: false },
        },
      });
    });

    it('declares the required fields and links of the public root index', () => {
      const swaggerSpec = loadParsedSwaggerSpec();
      const rootSchema = responseSchema(swaggerSpec, '/', '200');

      expect(rootSchema).toMatchObject({
        required: ['name', 'version', 'status', 'links', 'auth', 'requestId'],
        properties: {
          name: { type: 'string', example: 'alt-text-generator' },
          version: { type: 'string', example: '1.0.0' },
          status: { type: 'string', example: 'ok' },
        },
      });
      expect(rootSchema.properties.links.required).toEqual(['api', 'docs', 'health', 'ping']);
      expect(rootSchema.properties.auth.properties.schemes.example).toEqual(['X-API-Key', 'Bearer']);
    });
  });

  // Response contract references: protected/async responses must point at the
  // named public schemas so downstream codegen resolves the same types.
  describe('response contract references', () => {
    it('references the async job schemas from the description endpoints', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(responseSchema(swaggerSpec, '/api/accessibility/description', '202'))
        .toEqual({ $ref: '#/components/schemas/DescriptionJobResponse' });
      expect(responseSchema(swaggerSpec, '/api/accessibility/descriptions', '202'))
        .toEqual({ $ref: '#/components/schemas/PageDescriptionJobResponse' });
      expect(responseSchema(swaggerSpec, '/api/accessibility/description-jobs/{jobId}', '202'))
        .toEqual({ $ref: '#/components/schemas/DescriptionJobResponse' });
      expect(responseSchema(swaggerSpec, '/api/accessibility/page-description-jobs/{jobId}', '202'))
        .toEqual({ $ref: '#/components/schemas/PageDescriptionJobResponse' });
    });

    it('references the public error contract from a protected endpoint', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(responseSchema(swaggerSpec, '/api/accessibility/description', '401'))
        .toEqual({ $ref: '#/components/schemas/ApiErrorResponse' });
    });
  });

  // Security: which endpoints are public and which require credentials.
  describe('security and public endpoints', () => {
    it('publishes reusable bearer and API-key security schemes', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(swaggerSpec.components.securitySchemes).toEqual({
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API token' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      });
    });

    it('leaves health and the root index unauthenticated', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(operation(swaggerSpec, '/api/health').security).toBeUndefined();
      expect(operation(swaggerSpec, '/').security).toBeUndefined();
    });

    it('protects non-health endpoints with both schemes', () => {
      const swaggerSpec = loadParsedSwaggerSpec();

      expect(operation(swaggerSpec, '/api/scraper/images').security)
        .toEqual([{ bearerAuth: [] }, { apiKeyAuth: [] }]);
    });
  });

  // Generated-artifact behavior: the spec ships as a committed artifact and only
  // falls back to runtime swagger-jsdoc parsing when that artifact is missing.
  describe('generated artifact', () => {
    it('prefers the generated OpenAPI artifact over runtime swagger-jsdoc parsing', () => {
      jest.resetModules();

      const swaggerJsdoc = jest.fn(() => {
        throw new Error('runtime swagger-jsdoc should not run when a generated spec exists');
      });

      jest.doMock('swagger-jsdoc', () => swaggerJsdoc);
      jest.doMock('../../../config/swagger-base', () => ({
        buildServers: () => PRODUCTION_SERVERS,
        getSwaggerJSDocOptions: jest.fn(),
      }));

      let swaggerSpec;

      jest.isolateModules(() => {
        swaggerSpec = require('../../../config/swagger');
      });

      expect(swaggerSpec.openapi).toBe('3.0.0');
      expect(swaggerSpec.servers).toEqual(PRODUCTION_SERVERS);
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
        buildServers: () => PRODUCTION_SERVERS,
        getSwaggerJSDocOptions: () => ({
          swaggerDefinition: { openapi: '3.0.0', servers: PRODUCTION_SERVERS },
        }),
      }));

      let swaggerSpec;

      jest.isolateModules(() => {
        swaggerSpec = require('../../../config/swagger');
      });

      expect(swaggerJsdoc).toHaveBeenCalledTimes(1);
      expect(swaggerSpec.servers).toEqual(PRODUCTION_SERVERS);

      jest.dontMock('node:fs');
      jest.dontMock('swagger-jsdoc');
      jest.dontMock('../../../config/swagger-base');
    });
  });
});
