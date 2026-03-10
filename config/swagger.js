const swaggerJSDoc = require('swagger-jsdoc');
const config = require('./index');

const buildServers = () => {
  if (config.env === 'production') {
    return [
      {
        url: config.swagger.prodServerUrl,
        description: 'Production server',
      },
    ];
  }

  return [
    {
      url: config.swagger.devServerUrl,
      description: 'Development server',
    },
  ];
};

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'AI-Powered Alternative Text Provider API',
    version: '1.0.0',
    description:
      'This API provides descriptions to images, to contribute to the world-wide accessibility efforts.',
  },
  servers: buildServers(),
  components: {
    securitySchemes: {
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
    },
    schemas: {
      ApiErrorResponse: {
        type: 'object',
        required: ['error', 'code'],
        properties: {
          error: {
            type: 'string',
            example: 'Invalid image_source URL',
          },
          code: {
            type: 'string',
            example: 'INVALID_IMAGE_SOURCE_URL',
          },
          requestId: {
            type: 'string',
            example: 'd5c9fca2-bef2-4ff6-92ff-0227d219d67e',
          },
          details: {
            type: 'array',
            items: {
              type: 'object',
              required: ['field', 'issue'],
              properties: {
                field: {
                  type: 'string',
                  example: 'image_source',
                },
                issue: {
                  type: 'string',
                  example: 'invalid_url',
                },
              },
            },
          },
        },
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: ['src/api/v1/**/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
