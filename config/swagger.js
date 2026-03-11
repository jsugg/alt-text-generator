const fs = require('node:fs');
const path = require('node:path');

const { buildServers, getSwaggerJSDocOptions } = require('./swagger-base');

const generatedSpecPath = path.join(__dirname, '..', 'docs', 'openapi.base.json');

const cloneJsonValue = (value) => JSON.parse(JSON.stringify(value));

const loadGeneratedSpec = () => {
  if (!fs.existsSync(generatedSpecPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(generatedSpecPath, 'utf8'));
};

const loadSwaggerSpec = () => {
  const generatedSpec = loadGeneratedSpec();

  if (generatedSpec) {
    return {
      ...cloneJsonValue(generatedSpec),
      servers: buildServers(),
    };
  }

  // NOTE: Dynamic generation is retained as a development fallback when the
  // generated spec artifact is missing locally.
  // eslint-disable-next-line global-require
  const swaggerJSDoc = require('swagger-jsdoc');
  return swaggerJSDoc(getSwaggerJSDocOptions());
};

module.exports = loadSwaggerSpec();
