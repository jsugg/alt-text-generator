/**
 * Redaction for anything the contract runner writes to reports or CI summaries.
 *
 * Failure messages can quote request URLs, headers, or response bodies, so they
 * pass through `redactText` before leaving the process: credential headers,
 * bearer tokens, URL credentials and query strings, secret-looking JSON fields,
 * and the literal values (or comma-separated list items) of secret-named
 * environment variables are all replaced.
 */

const REDACTED = '[REDACTED]';
const DEFAULT_MAX_LENGTH = 500;
const MIN_SECRET_VALUE_LENGTH = 6;

// Mirrors the header set the app logger redacts (src/infrastructure/logger.js).
const SENSITIVE_HEADER_NAMES = Object.freeze([
  'authorization',
  'cookie',
  'ocp-apim-subscription-key',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
]);

const SECRET_ENV_NAME_PATTERN = /(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH)/iu;
const SECRET_JSON_FIELD_PATTERN = /("[\w-]*(?:token|secret|passw(?:or)?d|api[-_]?key|authorization|credential)[\w-]*"\s*:\s*)(?:"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?)/giu;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu;
const URL_CREDENTIALS_PATTERN = /(\bhttps?:\/\/)[^\s/@:'"`]+:[^\s/@'"`]+@/giu;
// Absolute URLs, or root-relative paths not glued to a preceding word or URL.
const URL_QUERY_PATTERN = /((?:\bhttps?:\/\/|(?<![\w.:/])\/)[^\s'"`?#<>]*)\?[^\s'"`#<>]*/giu;
// A header value is a quoted string, a printed array, or the rest of the line.
const HEADER_VALUE_SOURCE = '(?:"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\'|(?:Array\\s*)?\\[[^\\]]*\\]|[^\\r\\n]+)';
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/gu;

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const SENSITIVE_HEADER_PATTERN = new RegExp(
  `(\\b(?:${SENSITIVE_HEADER_NAMES.map(escapeRegExp).join('|')})["']?\\s*[:=]\\s*)${HEADER_VALUE_SOURCE}`,
  'giu',
);

/**
 * Collects the values of secret-named environment variables, longest first so
 * overlapping values are replaced whole. Comma-separated values (for example
 * API_AUTH_TOKENS) also contribute each list item.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string[]}
 */
function collectSecretValues(env = process.env) {
  return Array.from(new Set(
    Object.entries(env)
      .filter(([name, value]) => (
        SECRET_ENV_NAME_PATTERN.test(name)
        && typeof value === 'string'
        && value.trim().length >= MIN_SECRET_VALUE_LENGTH
      ))
      .flatMap(([, value]) => {
        const trimmed = /** @type {string} */ (value).trim();
        const items = trimmed.split(',').map((item) => item.trim());

        return [trimmed, ...items].filter((item) => item.length >= MIN_SECRET_VALUE_LENGTH);
      }),
  )).sort((left, right) => right.length - left.length);
}

/**
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}

/**
 * Redacts secrets from free text and bounds its length.
 *
 * @param {unknown} value
 * @param {{ secretValues?: string[], maxLength?: number }} [options]
 * @returns {string}
 */
function redactText(value, { secretValues = collectSecretValues(), maxLength = DEFAULT_MAX_LENGTH } = {}) {
  let text = String(value ?? '').replace(ANSI_PATTERN, '');

  secretValues.forEach((secret) => {
    text = text.split(secret).join(REDACTED);
  });

  text = text
    .replace(SENSITIVE_HEADER_PATTERN, `$1${REDACTED}`)
    .replace(BEARER_PATTERN, `$1 ${REDACTED}`)
    .replace(SECRET_JSON_FIELD_PATTERN, `$1"${REDACTED}"`)
    .replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}@`)
    .replace(URL_QUERY_PATTERN, `$1?${REDACTED}`);

  return truncate(text, maxLength);
}

/**
 * Strips the query string and fragment from a request path for safe logging.
 *
 * @param {string} requestPath
 * @returns {string}
 */
function redactRequestPath(requestPath) {
  const cut = requestPath.search(/[?#]/u);
  return cut === -1 ? requestPath : requestPath.slice(0, cut);
}

module.exports = {
  REDACTED,
  SENSITIVE_HEADER_NAMES,
  collectSecretValues,
  redactRequestPath,
  redactText,
};
