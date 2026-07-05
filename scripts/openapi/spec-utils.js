/**
 * Shared helpers for the OpenAPI contract gates (validate / check / diff) and
 * the spec generator.
 *
 * The committed artifact at docs/openapi.base.json is the single source of truth
 * for the public HTTP contract: config/swagger.js serves it verbatim (injecting
 * only the runtime `servers` block), so every gate here reasons about the same
 * bytes that ship to swagger-ui and downstream codegen.
 */

const fs = require('node:fs');
const path = require('node:path');

const swaggerJSDoc = require('swagger-jsdoc');
const { getSwaggerJSDocOptions } = require('../../config/swagger-base');

const GENERATED_SPEC_PATH = path.resolve(__dirname, '../../docs/openapi.base.json');

// OpenAPI operation keys, lower-cased. Anything else on a path item (parameters,
// summary, $ref, ...) is not an operation and must be skipped when walking.
const HTTP_METHODS = new Set([
  'get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace',
]);

/**
 * Loose node of a parsed OpenAPI document. The document is external JSON, so
 * nested nodes are duck-typed and re-validated by the gates themselves.
 *
 * @typedef {Record<string, any>} OpenApiNode
 */

/**
 * Parsed OpenAPI document. Only the top-level sections the gates walk are
 * named; everything below stays loose (see {@link OpenApiNode}).
 *
 * @typedef {{
 *   openapi?: any,
 *   info?: OpenApiNode,
 *   servers?: any,
 *   security?: any,
 *   paths?: Record<string, OpenApiNode>,
 *   components?: { schemas?: Record<string, OpenApiNode>, securitySchemes?: OpenApiNode } & OpenApiNode,
 * } & OpenApiNode} OpenApiSpec
 */

/**
 * Serializes a spec exactly the way the generator writes it to disk, so a
 * freshness comparison is a byte-for-byte string match (trailing newline
 * included).
 *
 * @param {object} spec
 * @returns {string}
 */
function serializeSpec(spec) {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

/**
 * Returns a structurally identical copy of `value` with every object's keys
 * sorted lexicographically. Arrays keep their order (it can be semantically
 * meaningful in OpenAPI: `enum`, `parameters`, `required`, `security`, `tags`).
 *
 * This makes the committed artifact and the freshness gate depend only on the
 * spec's *content*, not on the key-insertion order that swagger-jsdoc happens to
 * emit. A generator upgrade that merely reorders keys (e.g. swagger-jsdoc 6.3.0
 * moving response codes) therefore produces identical bytes, while a real
 * contract change (added/removed/renamed path, schema, or field) still differs.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalizeSpec(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeSpec);
  }

  if (value !== null && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalizeSpec(value[key]);
        return acc;
      }, /** @type {Record<string, any>} */ ({}));
  }

  return value;
}

/**
 * Regenerates the server-agnostic base spec from the JSDoc sources. The runtime
 * `servers` block is stripped because it is environment-specific and injected
 * by config/swagger.js at serve time. The result is canonicalized so the
 * committed artifact stays stable across swagger-jsdoc versions that only change
 * key ordering.
 *
 * @returns {object}
 */
function generateFreshSpec() {
  const spec = swaggerJSDoc(getSwaggerJSDocOptions());
  delete spec.servers;
  return canonicalizeSpec(spec);
}

/**
 * Reads the raw committed spec text (no parsing), for byte-level comparison.
 *
 * @param {string} [specPath]
 * @returns {string}
 */
function readSpecText(specPath = GENERATED_SPEC_PATH) {
  return fs.readFileSync(specPath, 'utf8');
}

/**
 * Reads and parses the committed spec into an object.
 *
 * @param {string} [specPath]
 * @returns {OpenApiSpec}
 */
function loadSpec(specPath = GENERATED_SPEC_PATH) {
  return JSON.parse(readSpecText(specPath));
}

/**
 * Flattens a spec's `paths` into one entry per operation.
 *
 * @param {OpenApiSpec} spec
 * @returns {{ path: string, method: string, operation: OpenApiNode }[]}
 */
function listOperations(spec) {
  const paths = spec?.paths;

  if (paths === null || typeof paths !== 'object') {
    return [];
  }

  return Object.entries(paths).flatMap(([routePath, pathItem]) => {
    if (pathItem === null || typeof pathItem !== 'object') {
      return [];
    }

    return Object.entries(pathItem)
      .filter(([method, operation]) => (
        HTTP_METHODS.has(method.toLowerCase())
        && operation !== null
        && typeof operation === 'object'
      ))
      .map(([method, operation]) => ({ path: routePath, method: method.toLowerCase(), operation }));
  });
}

/**
 * Returns the response status keys declared on an operation.
 *
 * @param {OpenApiNode} operation
 * @returns {string[]}
 */
function listResponseStatuses(operation) {
  const responses = operation?.responses;

  if (responses === null || typeof responses !== 'object') {
    return [];
  }

  return Object.keys(responses);
}

/**
 * Walks an arbitrary spec node and collects every `$ref` string it contains.
 *
 * @param {*} node
 * @param {Set<string>} [acc]
 * @returns {Set<string>}
 */
function collectRefs(node, acc = new Set()) {
  if (Array.isArray(node)) {
    node.forEach((child) => collectRefs(child, acc));
    return acc;
  }

  if (node === null || typeof node !== 'object') {
    return acc;
  }

  Object.entries(node).forEach(([key, value]) => {
    if (key === '$ref' && typeof value === 'string') {
      acc.add(value);
    } else {
      collectRefs(value, acc);
    }
  });

  return acc;
}

/**
 * Resolves a local JSON pointer ref (e.g. `#/components/schemas/Foo`) against a
 * spec, returning the referenced node or `undefined` when it does not resolve.
 *
 * @param {OpenApiSpec} spec
 * @param {string} ref
 * @returns {*}
 */
function resolveRef(spec, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return undefined;
  }

  return ref
    .slice(2)
    .split('/')
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'))
    .reduce((node, segment) => (
      node !== null && typeof node === 'object' ? node[segment] : undefined
    ), /** @type {any} */ (spec));
}

/**
 * Returns the declared security scheme names (`components.securitySchemes`).
 *
 * @param {OpenApiSpec} spec
 * @returns {string[]}
 */
function listSecuritySchemeNames(spec) {
  const schemes = spec?.components?.securitySchemes;

  return schemes !== null && typeof schemes === 'object' ? Object.keys(schemes) : [];
}

module.exports = {
  GENERATED_SPEC_PATH,
  HTTP_METHODS,
  canonicalizeSpec,
  collectRefs,
  generateFreshSpec,
  listOperations,
  listResponseStatuses,
  listSecuritySchemeNames,
  loadSpec,
  readSpecText,
  resolveRef,
  serializeSpec,
};
