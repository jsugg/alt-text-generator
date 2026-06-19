#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');

const { GENERATED_SPEC_PATH, generateFreshSpec, serializeSpec } = require('./openapi/spec-utils');

fs.writeFileSync(GENERATED_SPEC_PATH, serializeSpec(generateFreshSpec()), 'utf8');
console.log(`Wrote generated OpenAPI spec to ${GENERATED_SPEC_PATH}`);
