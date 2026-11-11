/**
 * In-process contract transport: Supertest against the Express app, with the
 * same raw-text body and no-redirect semantics as the Undici transport.
 */

const supertest = require('supertest');

const {
  DEFAULT_TIMEOUT_MS,
  normalizeHeaders,
  prepareRequest,
  timeExchange,
} = require('./contract-client');

/** @typedef {import('./contract-client').ContractClient} ContractClient */
/** @typedef {import('./contract-client').ContractExchange} ContractExchange */

/**
 * Buffers the raw body as UTF-8 text, bypassing superagent's content-type
 * parsers so both transports expose the identical `text`.
 *
 * @param {NodeJS.ReadableStream} response
 * @param {(error: Error | null, body: string) => void} callback
 */
function collectRawText(response, callback) {
  /** @type {Buffer[]} */
  const chunks = [];

  response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks).toString('utf8')));
  response.on('error', (error) => callback(/** @type {Error} */ (error), ''));
}

/**
 * @param {{
 *   app: unknown,
 *   defaultHeaders?: Record<string, string>,
 *   observer?: ((exchange: ContractExchange) => void) | null,
 *   timeoutMs?: number,
 * }} options
 * @returns {ContractClient}
 */
function createSupertestContractClient({
  app, defaultHeaders = {}, observer = null, timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const agent = supertest(app);

  return {
    transport: 'supertest',
    send(contractRequest) {
      const prepared = prepareRequest(contractRequest, defaultHeaders);

      return timeExchange({
        transport: 'supertest',
        prepared,
        observer,
        execute: async () => {
          let pending = agent[prepared.method.toLowerCase()](prepared.target)
            .redirects(0)
            .timeout(timeoutMs)
            .ok(() => true)
            // Bodies are already bytes; superagent would JSON-encode a Buffer again.
            .serialize((/** @type {unknown} */ body) => body)
            .buffer(true)
            .parse(collectRawText);

          Object.entries(prepared.headers).forEach(([name, value]) => {
            pending = pending.set(name, value);
          });

          const response = await (prepared.body === undefined ? pending : pending.send(prepared.body));

          return {
            status: response.status,
            headers: normalizeHeaders(response.headers),
            text: typeof response.body === 'string' ? response.body : '',
          };
        },
      });
    },
    close() {
      return Promise.resolve();
    },
  };
}

module.exports = {
  createSupertestContractClient,
};
