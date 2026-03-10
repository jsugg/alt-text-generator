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
};

const options = {
  swaggerDefinition,
  apis: ['src/api/v1/**/*.js'],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
