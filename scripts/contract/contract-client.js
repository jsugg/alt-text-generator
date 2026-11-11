/**
 * Transport-neutral HTTP client contract for the API contract suites.
 *
 * One set of contract tests runs either in-process (Supertest against the
 * Express app) or black-box (Undici against a local listener or a deployed
 * `CONTRACT_BASE_URL`). Both adapters return the same normalized response
 * shape, decode gzip/deflate bodies, and never follow redirects, so a suite can
 * assert redirects, headers, and bodies identically on either transport.
 */

const { performance } = require('node:perf_hooks');

const { createRequestLogRecorder } = require('./request-log');

/** @typedef {'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS'} HttpMethod */
/** @typedef {'supertest' | 'undici'} ContractTransport */

/**
 * @typedef {object} ContractRequest
 * @property {HttpMethod} [method] defaults to GET
 * @property {string} path absolute path, optionally with a query string
 * @property {Record<string, string | number | boolean>} [query]
 * @property {Record<string, string>} [headers]
 * @property {string | Buffer | Record<string, unknown> | unknown[]} [body]
 *   plain objects and arrays are sent as JSON
 */

/**
 * @typedef {object} ContractResponse
 * @property {number} status
 * @property {Readonly<Record<string, string>>} headers lower-cased names; repeated values joined by ", "
 * @property {string} text raw body decoded as UTF-8
 * @property {number} durationMs
 * @property {() => unknown} json parses `text`; throws ContractResponseError when it is not JSON
 */

/**
 * @typedef {object} ContractClient
 * @property {ContractTransport} transport
 * @property {(request: ContractRequest) => Promise<ContractResponse>} send
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {object} ContractExchange
 * @property {ContractTransport} transport
 * @property {HttpMethod} method
 * @property {string} path
 * @property {number | null} status null when the transport failed
 * @property {number} startedAt epoch milliseconds
 * @property {number} durationMs
 * @property {Error | null} error
 */

/**
 * @typedef {object} PreparedRequest
 * @property {HttpMethod} method
 * @property {string} target path plus encoded query string
 * @property {Record<string, string>} headers
 * @property {Buffer | undefined} body
 */

class ContractResponseError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ContractResponseError';
  }
}

const SUPPORTED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const DEFAULT_TIMEOUT_MS = 30_000;
// Superagent advertises and decodes exactly these encodings; the Undici adapter
// decodes the same set, so both transports see compressed responses alike.
const DEFAULT_ACCEPT_ENCODING = 'gzip, deflate';
const BYTE_ORDER_MARK_PATTERN = /^\uFEFF/u;

/**
 * Validates a contract request and resolves its method, target, headers, and body.
 *
 * @param {ContractRequest} request
 * @param {Record<string, string>} [defaultHeaders]
 * @returns {PreparedRequest}
 */
function prepareRequest(request, defaultHeaders = {}) {
  const method = /** @type {HttpMethod} */ ((request.method ?? 'GET').toUpperCase());

  if (!SUPPORTED_METHODS.has(method)) {
    throw new TypeError(`Unsupported contract request method: ${request.method}`);
  }

  if (typeof request.path !== 'string' || !request.path.startsWith('/')) {
    throw new TypeError(`Contract request path must start with "/": ${String(request.path)}`);
  }

  const query = new URLSearchParams(
    Object.entries(request.query ?? {}).map(([key, value]) => [key, String(value)]),
  ).toString();
  const separator = request.path.includes('?') ? '&' : '?';
  /** @type {Record<string, string>} */
  const headers = Object.fromEntries(
    Object.entries({ 'accept-encoding': DEFAULT_ACCEPT_ENCODING, ...defaultHeaders, ...request.headers })
      .map(([name, value]) => [name.toLowerCase(), value]),
  );
  /** @type {Buffer | undefined} */
  let body;

  // Strings travel as Buffers: superagent would otherwise add a form content-type
  // that Undici never sends.
  if (typeof request.body === 'string') {
    body = Buffer.from(request.body, 'utf8');
  } else if (Buffer.isBuffer(request.body)) {
    ({ body } = request);
  } else if (request.body !== undefined) {
    body = Buffer.from(JSON.stringify(request.body), 'utf8');
    headers['content-type'] ??= 'application/json';
  }

  return {
    method,
    target: query ? `${request.path}${separator}${query}` : request.path,
    headers,
    body,
  };
}

/**
 * Normalizes transport header maps to lower-cased, single-string values.
 *
 * @param {Record<string, string | string[] | number | undefined> | null | undefined} rawHeaders
 * @returns {Readonly<Record<string, string>>}
 */
function normalizeHeaders(rawHeaders) {
  return Object.freeze(Object.fromEntries(
    Object.entries(rawHeaders ?? {})
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => [
        name.toLowerCase(),
        Array.isArray(value) ? value.join(', ') : String(value),
      ]),
  ));
}

/**
 * @param {{ status: number, headers: Readonly<Record<string, string>>, text: string, durationMs: number }} input
 * @returns {ContractResponse}
 */
function createContractResponse({
  status, headers, text: rawText, durationMs,
}) {
  const text = rawText.replace(BYTE_ORDER_MARK_PATTERN, '');

  return Object.freeze({
    status,
    headers,
    text,
    durationMs,
    json() {
      try {
        return JSON.parse(text);
      } catch {
        // The body is deliberately not quoted: it may carry secrets into reports.
        throw new ContractResponseError(
          `Response body is not valid JSON (status ${status}, `
          + `content-type "${headers['content-type'] ?? ''}", ${Buffer.byteLength(text)} bytes)`,
        );
      }
    },
  });
}

/**
 * Times a transport call and reports the exchange to an optional observer.
 *
 * @param {{
 *   transport: ContractTransport,
 *   prepared: PreparedRequest,
 *   observer?: ((exchange: ContractExchange) => void) | null,
 *   execute: () => Promise<{ status: number, headers: Readonly<Record<string, string>>, text: string }>,
 * }} options
 * @returns {Promise<ContractResponse>}
 */
async function timeExchange({
  transport, prepared, observer = null, execute,
}) {
  const startedAt = Date.now();
  const started = performance.now();
  /** @type {ContractExchange} */
  const exchange = {
    transport,
    method: prepared.method,
    path: prepared.target,
    status: null,
    startedAt,
    durationMs: 0,
    error: null,
  };

  try {
    const result = await execute();
    exchange.durationMs = Math.round(performance.now() - started);
    exchange.status = result.status;

    return createContractResponse({ ...result, durationMs: exchange.durationMs });
  } catch (error) {
    exchange.durationMs = Math.round(performance.now() - started);
    exchange.error = /** @type {Error} */ (error);
    throw error;
  } finally {
    try {
      observer?.(exchange);
    } catch (observerError) {
      // A failing observer must not mask the transport error it was recording.
      if (!exchange.error) {
        // eslint-disable-next-line no-unsafe-finally
        throw observerError;
      }
    }
  }
}

/**
 * @typedef {object} ContractTarget
 * @property {ContractTransport} transport
 * @property {string | null} baseUrl
 * @property {boolean} insecureTls
 */

/**
 * Resolves the contract target from the environment: `CONTRACT_BASE_URL`
 * selects the black-box Undici transport, otherwise suites run in-process.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {ContractTarget}
 */
function resolveContractTarget(env = process.env) {
  const baseUrl = env.CONTRACT_BASE_URL?.trim() || null;

  if (!baseUrl) {
    return { transport: 'supertest', baseUrl: null, insecureTls: false };
  }

  const parsed = new URL(baseUrl);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError(`CONTRACT_BASE_URL must be an http(s) URL, got protocol "${parsed.protocol}"`);
  }

  return {
    transport: 'undici',
    baseUrl: parsed.toString().replace(/\/+$/u, ''),
    insecureTls: ['1', 'true', 'yes'].includes(String(env.CONTRACT_INSECURE_TLS ?? '').trim().toLowerCase()),
  };
}

/**
 * Creates the client for the resolved target. The in-process transport needs
 * the Express app; the black-box transport only needs the base URL. When
 * `CONTRACT_REQUEST_LOG_DIR` is set and no observer is given, exchanges are
 * appended to the request log the report summarizer reads.
 *
 * @param {{
 *   app?: unknown,
 *   env?: NodeJS.ProcessEnv,
 *   defaultHeaders?: Record<string, string>,
 *   observer?: ((exchange: ContractExchange) => void) | null,
 *   resolveTestName?: () => string | null | undefined,
 *   timeoutMs?: number,
 * }} [options]
 * @returns {ContractClient}
 */
function createContractClient({
  app,
  env = process.env,
  defaultHeaders = {},
  observer: explicitObserver = null,
  resolveTestName,
  timeoutMs,
} = {}) {
  const target = resolveContractTarget(env);
  const requestLogDir = env.CONTRACT_REQUEST_LOG_DIR?.trim();
  const observer = explicitObserver ?? (
    requestLogDir ? createRequestLogRecorder({ dir: requestLogDir, resolveTestName }) : null
  );

  if (target.transport === 'undici') {
    // Lazy requires keep each transport's dependency off the other's load path.
    // eslint-disable-next-line global-require
    const { createUndiciContractClient } = require('./undici-contract-client');

    return createUndiciContractClient({
      baseUrl: /** @type {string} */ (target.baseUrl),
      insecureTls: target.insecureTls,
      defaultHeaders,
      observer,
      timeoutMs,
    });
  }

  if (!app) {
    throw new TypeError('In-process contract runs need an app; set CONTRACT_BASE_URL to run black-box');
  }

  // eslint-disable-next-line global-require
  const { createSupertestContractClient } = require('./supertest-contract-client');

  return createSupertestContractClient({
    app, defaultHeaders, observer, timeoutMs,
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  ContractResponseError,
  createContractClient,
  createContractResponse,
  normalizeHeaders,
  prepareRequest,
  resolveContractTarget,
  timeExchange,
};
