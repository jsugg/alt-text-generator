/**
 * Black-box contract transport: real HTTP(S) through Undici against a base URL
 * (a local listener or a deployed service). Redirects are never followed.
 */

const zlib = require('node:zlib');

const { Agent, request } = require('undici');

const {
  DEFAULT_TIMEOUT_MS,
  normalizeHeaders,
  prepareRequest,
  timeExchange,
} = require('./contract-client');

/** @typedef {import('./contract-client').ContractClient} ContractClient */
/** @typedef {import('./contract-client').ContractExchange} ContractExchange */

/** @type {Record<string, (buffer: Buffer) => Buffer>} */
const DECODERS = {
  gzip: (buffer) => zlib.gunzipSync(buffer),
  'x-gzip': (buffer) => zlib.gunzipSync(buffer),
  deflate: (buffer) => zlib.inflateSync(buffer),
};

/**
 * Decodes a response body the way superagent does for the in-process transport.
 *
 * @param {Buffer} buffer
 * @param {string | undefined} contentEncoding
 * @returns {string}
 */
function decodeBody(buffer, contentEncoding) {
  const encoding = String(contentEncoding ?? '').trim().toLowerCase();

  if (buffer.length === 0 || encoding === '' || encoding === 'identity') {
    return buffer.toString('utf8');
  }

  const decode = DECODERS[encoding];

  if (!decode) {
    throw new TypeError(`Unsupported response content-encoding "${encoding}"`);
  }

  return decode(buffer).toString('utf8');
}

/**
 * @param {{
 *   baseUrl: string,
 *   insecureTls?: boolean,
 *   defaultHeaders?: Record<string, string>,
 *   observer?: ((exchange: ContractExchange) => void) | null,
 *   timeoutMs?: number,
 * }} options
 * @returns {ContractClient}
 */
function createUndiciContractClient({
  baseUrl,
  insecureTls = false,
  defaultHeaders = {},
  observer = null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const { origin, pathname } = new URL(baseUrl);
  const basePath = pathname.replace(/\/+$/u, '');
  const dispatcher = new Agent({
    connect: { rejectUnauthorized: !insecureTls },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });

  return {
    transport: 'undici',
    send(contractRequest) {
      const prepared = prepareRequest(contractRequest, defaultHeaders);

      return timeExchange({
        transport: 'undici',
        prepared,
        observer,
        execute: async () => {
          const response = await request(`${origin}${basePath}${prepared.target}`, {
            method: prepared.method,
            headers: prepared.headers,
            body: prepared.body,
            dispatcher,
            signal: AbortSignal.timeout(timeoutMs),
          });

          const headers = normalizeHeaders(response.headers);

          return {
            status: response.statusCode,
            headers,
            text: decodeBody(Buffer.from(await response.body.arrayBuffer()), headers['content-encoding']),
          };
        },
      });
    },
    close() {
      return dispatcher.close();
    },
  };
}

module.exports = {
  createUndiciContractClient,
  decodeBody,
};
