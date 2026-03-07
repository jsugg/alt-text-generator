const swaggerJSDoc = require('swagger-jsdoc');
const config = require('./index');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'AI-Powered Alternative Text Provider API',
    version: '1.0.0',
    description:
      'This API provides descriptions to images, to contribute to the world-wide accessibility efforts.',
  },
  servers: [
    {
      url: config.swagger.devServerUrl,
      description: 'Development server',
    },
    {
      url: config.swagger.prodServerUrl,
      description: 'Production server',
    },
  ],
};

const options = {
  swaggerDefinition,
  apis: ['src/api/v1/**/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
