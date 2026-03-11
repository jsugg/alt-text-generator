#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');

const swaggerJSDoc = require('swagger-jsdoc');
const { getSwaggerJSDocOptions } = require('../config/swagger-base');

const outputPath = path.join(__dirname, '..', 'docs', 'openapi.base.json');
const swaggerSpec = swaggerJSDoc(getSwaggerJSDocOptions());

delete swaggerSpec.servers;

fs.writeFileSync(outputPath, `${JSON.stringify(swaggerSpec, null, 2)}\n`, 'utf8');
console.log(`Wrote generated OpenAPI spec to ${outputPath}`);
