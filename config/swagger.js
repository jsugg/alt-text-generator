const swaggerJSDoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'AI-Powered Alternative Text Provider API',
    version: '1.0.0',
    description: 'This API provides descriptions to images, to contribute to the world-wide accessibility efforts.',
  },
  servers: [
    {
      url: 'https://localhost:4443',
      description: 'Development server',
    },
    {
      url: 'https://wcag.qcraft.dev',
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
