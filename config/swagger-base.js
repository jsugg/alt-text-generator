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

const createSwaggerDefinition = () => ({
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
      DescriptionJobResponse: {
        type: 'object',
        required: ['jobId', 'model', 'imageUrl', 'status'],
        properties: {
          jobId: {
            type: 'string',
            example: '8dbd0c163f9c85166abac1d449f5fe3e78244da0edb8ff6ea7f2e4c4cc6db83d',
          },
          model: {
            type: 'string',
            example: 'replicate',
          },
          imageUrl: {
            type: 'string',
            example: 'https://developer.chrome.com/static/images/ai-homepage-card.png',
          },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'starting', 'succeeded', 'failed', 'canceled'],
            example: 'pending',
          },
          pollAfterMs: {
            type: 'integer',
            example: 1000,
          },
          statusUrl: {
            type: 'string',
            example: '/api/v1/accessibility/description-jobs/8dbd0c163f9c85166abac1d449f5fe3e78244da0edb8ff6ea7f2e4c4cc6db83d',
          },
          result: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                example: 'A man with glasses is playing a violin.',
              },
              imageUrl: {
                type: 'string',
                example: 'https://developer.chrome.com/static/images/ai-homepage-card.png',
              },
            },
          },
          error: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                example: 'Replicate prediction failed',
              },
              code: {
                type: 'string',
                example: 'DESCRIPTION_PROVIDER_TIMEOUT',
              },
            },
          },
        },
      },
      PageDescriptionJobResponse: {
        type: 'object',
        required: ['jobId', 'model', 'pageUrl', 'status'],
        properties: {
          jobId: {
            type: 'string',
            example: '51cc340310a52659fbe9f3d2b9ef754f17f4f2376eb138dfb2cd7f0142ae5db0',
          },
          model: {
            type: 'string',
            example: 'replicate',
          },
          pageUrl: {
            type: 'string',
            example: 'https://developer.chrome.com/',
          },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'starting', 'succeeded', 'failed', 'canceled'],
            example: 'pending',
          },
          pollAfterMs: {
            type: 'integer',
            example: 1000,
          },
          statusUrl: {
            type: 'string',
            example: '/api/v1/accessibility/page-description-jobs/51cc340310a52659fbe9f3d2b9ef754f17f4f2376eb138dfb2cd7f0142ae5db0',
          },
          result: {
            type: 'object',
            properties: {
              pageUrl: {
                type: 'string',
                example: 'https://developer.chrome.com/',
              },
              model: {
                type: 'string',
                example: 'replicate',
              },
              totalImages: {
                type: 'integer',
                example: 3,
              },
              uniqueImages: {
                type: 'integer',
                example: 2,
              },
              descriptions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                      example: 'A man with glasses is playing a violin.',
                    },
                    imageUrl: {
                      type: 'string',
                      example: 'https://developer.chrome.com/static/images/ai-homepage-card.png',
                    },
                  },
                },
              },
            },
          },
          error: {
            type: 'object',
            properties: {
              message: {
                type: 'string',
                example: 'Page description job failed',
              },
              code: {
                type: 'string',
                example: 'PAGE_DESCRIPTION_JOB_FETCH_FAILED',
              },
            },
          },
        },
      },
    },
  },
});

const getSwaggerJSDocOptions = () => ({
  swaggerDefinition: createSwaggerDefinition(),
  apis: ['src/api/v1/**/*.js'],
});

module.exports = {
  buildServers,
  createSwaggerDefinition,
  getSwaggerJSDocOptions,
};
