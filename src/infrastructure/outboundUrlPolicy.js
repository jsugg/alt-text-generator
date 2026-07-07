const dns = require('dns');
const net = require('net');

const DEFAULT_MAX_URL_LENGTH = 2048;
const HTTP_REDIRECT_MIN = 300;
const HTTP_REDIRECT_MAX = 399;
const PRIVATE_IPV4_RANGES = [
  [0x00000000, 0x00ffffff],
  [0x0a000000, 0x0affffff],
  [0x7f000000, 0x7fffffff],
  [0xa9fe0000, 0xa9feffff],
  [0xac100000, 0xac1fffff],
  [0xc0000000, 0xc00000ff],
  [0xc0000200, 0xc00002ff],
  [0xc0a80000, 0xc0a8ffff],
  [0xc6336400, 0xc63364ff],
  [0xcb007100, 0xcb0071ff],
  [0xe0000000, 0xefffffff],
  [0xf0000000, 0xffffffff],
];
const BLOCKED_IPV6_PREFIXES = [
  '::',
  '::1',
  'fc',
  'fd',
  'fe8',
  'fe9',
  'fea',
  'feb',
  'ff',
];

/**
 * @param {string} address
 * @returns {number | null}
 */
const parseIpv4 = (address) => {
  const octets = address.split('.').map((octet) => Number.parseInt(octet, 10));
  if (
    octets.length !== 4
    || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return null;
  }

  return octets.reduce((value, octet) => (value * 256) + octet, 0);
};

/**
 * @param {string} address
 * @returns {string}
 */
const normalizeIpv6 = (address) => address.toLowerCase().replace(/^\[|\]$/g, '');

/**
 * @param {string} address
 * @returns {boolean}
 */
const isBlockedIpv4 = (address) => {
  const value = parseIpv4(address);
  if (value === null) {
    return true;
  }

  return PRIVATE_IPV4_RANGES.some(([start, end]) => value >= start && value <= end);
};

/**
 * @param {string} address
 * @returns {boolean}
 */
const isBlockedIpv6 = (address) => {
  const normalized = normalizeIpv6(address);
  if (normalized.includes('.')) {
    const embeddedIpv4 = normalized.slice(normalized.lastIndexOf(':') + 1);
    return isBlockedIpv4(embeddedIpv4);
  }

  return BLOCKED_IPV6_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

/**
 * @param {string} address
 * @returns {boolean}
 */
const isBlockedAddress = (address) => {
  const family = net.isIP(address);

  if (family === 4) {
    return isBlockedIpv4(address);
  }

  if (family === 6) {
    return isBlockedIpv6(address);
  }

  return true;
};

/**
 * @param {unknown} value
 * @param {number} [maxUrlLength]
 * @returns {URL}
 */
const parseUrl = (value, maxUrlLength = DEFAULT_MAX_URL_LENGTH) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxUrlLength) {
    throw new Error('Outbound URL must be a non-empty string within the configured length limit');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error('Outbound URL must be a valid absolute URL');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Outbound URL protocol must be http or https');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('Outbound URL must not include credentials');
  }

  if (!parsedUrl.hostname) {
    throw new Error('Outbound URL must include a hostname');
  }

  return parsedUrl;
};

/**
 * @param {string} address
 * @returns {void}
 */
const assertPublicAddress = (address) => {
  if (isBlockedAddress(address)) {
    throw new Error(`Outbound URL resolves to a blocked network address: ${address}`);
  }
};

/**
 * @param {string} hostname
 * @returns {string}
 */
const normalizeHostnameForAddressCheck = (hostname) => hostname.replace(/^\[|\]$/g, '');

/**
 * @param {unknown} value
 * @returns {string | null}
 */
const normalizeAllowedHost = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

/**
 * @param {Array<string | null | undefined> | null | undefined} allowedHosts
 * @returns {Set<string>}
 */
const createAllowedHostSet = (allowedHosts) => new Set(
  /** @type {string[]} */ (
    (allowedHosts ?? [])
      .map(normalizeAllowedHost)
      .filter(Boolean)
  ),
);

/**
 * @param {URL} parsedUrl
 * @param {Set<string>} allowedHosts
 * @returns {boolean}
 */
const isAllowedHost = (parsedUrl, allowedHosts) => {
  if (allowedHosts.size === 0) {
    return false;
  }

  const hostname = normalizeAllowedHost(parsedUrl.hostname);
  const host = normalizeAllowedHost(parsedUrl.host);

  return (
    allowedHosts.has(/** @type {string} */ (host))
    || allowedHosts.has(/** @type {string} */ (hostname))
  );
};

/**
 * @typedef {(
 *   hostname: string,
 *   options: { all: true, verbatim: true },
 * ) => Promise<Array<{ address?: unknown }>>} DnsLookupFn
 */

/**
 * @param {object} [options]
 * @param {string[]} [options.allowedHosts]
 * @param {DnsLookupFn} [options.lookup]
 * @param {number} [options.maxUrlLength]
 * @returns {(value: unknown) => Promise<URL>}
 */
const createOutboundUrlPolicy = ({
  allowedHosts = [],
  lookup = dns.promises.lookup,
  maxUrlLength = DEFAULT_MAX_URL_LENGTH,
} = {}) => {
  const allowedHostSet = createAllowedHostSet(allowedHosts);

  return async (value) => {
    const parsedUrl = parseUrl(value, maxUrlLength);

    if (isAllowedHost(parsedUrl, allowedHostSet)) {
      return parsedUrl;
    }

    const hostname = normalizeHostnameForAddressCheck(parsedUrl.hostname);
    const literalFamily = net.isIP(hostname);

    if (literalFamily) {
      assertPublicAddress(hostname);
      return parsedUrl;
    }

    const records = await lookup(hostname, {
      all: true,
      verbatim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      throw new Error(`Outbound URL hostname did not resolve: ${hostname}`);
    }

    records.forEach((record) => {
      if (!record || typeof record.address !== 'string') {
        throw new Error(`Outbound URL hostname returned an invalid DNS record: ${hostname}`);
      }
      assertPublicAddress(record.address);
    });

    return parsedUrl;
  };
};

const defaultOutboundUrlPolicy = createOutboundUrlPolicy();

/**
 * @param {number} status
 * @returns {boolean}
 */
const isRedirectStatus = (status) => (
  Number.isInteger(status) && status >= HTTP_REDIRECT_MIN && status <= HTTP_REDIRECT_MAX
);

/**
 * @typedef {{
 *   status: number,
 *   headers?: Record<string, string | string[] | undefined>,
 * } & Record<string, any>} PolicyHttpResponse
 */

/**
 * @typedef {(url: string, options?: object) => Promise<PolicyHttpResponse>} PolicyRequestFn
 */

/**
 * @param {PolicyHttpResponse} response
 * @returns {string | undefined}
 */
const getRedirectLocation = (response) => {
  const location = response?.headers?.location;
  if (Array.isArray(location)) {
    return location[0];
  }
  return location;
};

/**
 * @param {object} params
 * @param {Record<string, PolicyRequestFn>} params.httpClient
 * @param {string} [params.method]
 * @param {string} params.url
 * @param {{ maxRedirects?: number } & Record<string, any>} [params.options]
 * @param {(value: any) => Promise<URL>} [params.outboundUrlPolicy]
 * @returns {Promise<PolicyHttpResponse>}
 */
const requestWithOutboundUrlPolicy = async ({
  httpClient,
  method = 'get',
  url,
  options = {},
  outboundUrlPolicy = defaultOutboundUrlPolicy,
}) => {
  const maxRedirects = Number.isInteger(options.maxRedirects)
    ? /** @type {number} */ (options.maxRedirects)
    : 0;
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    // eslint-disable-next-line no-await-in-loop
    await outboundUrlPolicy(currentUrl);

    // eslint-disable-next-line no-await-in-loop
    const response = await httpClient[method](currentUrl, {
      ...options,
      maxRedirects: 0,
      validateStatus: (/** @type {number} */ status) => status >= 200 && status < 400,
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = getRedirectLocation(response);
    if (!location) {
      throw new Error('Outbound redirect response did not include a Location header');
    }

    if (redirectCount >= maxRedirects) {
      throw new Error('Outbound request exceeded the configured redirect limit');
    }

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error('Outbound request exceeded the configured redirect limit');
};

module.exports = {
  createOutboundUrlPolicy,
  defaultOutboundUrlPolicy,
  isBlockedAddress,
  parseUrl,
  requestWithOutboundUrlPolicy,
};
