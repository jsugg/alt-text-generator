const fs = require('fs');
const path = require('path');
const https = require('https');
const tls = require('tls');
const axios = require('axios');
const { Agent: UndiciAgent, fetch: undiciFetch } = require('undici');

const resolveOptionalFile = (filePath) => {
  if (!filePath) {
    return undefined;
  }

  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
};

const readCaBundle = (caBundleFile) => {
  const resolvedBundleFile = resolveOptionalFile(caBundleFile);
  if (!resolvedBundleFile) {
    return { caBundle: undefined, caBundleFile: undefined };
  }

  if (!fs.existsSync(resolvedBundleFile)) {
    throw new Error(`Outbound CA bundle file does not exist: ${resolvedBundleFile}`);
  }

  return {
    caBundle: fs.readFileSync(resolvedBundleFile, 'utf8'),
    caBundleFile: resolvedBundleFile,
  };
};

const createOutboundClients = (config) => {
  const { caBundle, caBundleFile } = readCaBundle(config.outboundTls?.caBundleFile);
  const trustedCas = caBundle
    ? [...tls.rootCertificates, caBundle]
    : undefined;
  const httpsAgent = new https.Agent({
    keepAlive: true,
    ...(trustedCas ? { ca: trustedCas } : {}),
  });
  const fetchDispatcher = new UndiciAgent(
    trustedCas ? { connect: { ca: trustedCas } } : {},
  );
  const fetch = (input, init = {}) => undiciFetch(input, {
    dispatcher: init.dispatcher ?? fetchDispatcher,
    ...init,
  });

  return {
    caBundle,
    caBundleFile,
    fetch,
    fetchDispatcher,
    httpClient: axios.create({
      httpsAgent,
    }),
    httpsAgent,
  };
};

module.exports = {
  createOutboundClients,
  readCaBundle,
  resolveOptionalFile,
};
