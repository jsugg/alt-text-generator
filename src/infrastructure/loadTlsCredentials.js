const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');
const config = require('../../config');

const INLINE_PEM_PATTERN = /-----BEGIN [A-Z ]+-----/;
const DEFAULT_LOCAL_TLS_PATHS = {
  key: path.resolve(__dirname, '../../certs/localhost-key.pem'),
  cert: path.resolve(__dirname, '../../certs/localhost.pem'),
};

let generatedDevelopmentCredentialsPromise;

const resolveInlineCredential = (source) => {
  const trimmedSource = source.trim();
  if (INLINE_PEM_PATTERN.test(trimmedSource)) {
    return trimmedSource;
  }

  const normalizedBase64 = trimmedSource.replace(/\s+/g, '');
  if (
    normalizedBase64.length === 0
    || normalizedBase64.length % 4 !== 0
    || /[^A-Za-z0-9+/=]/.test(normalizedBase64)
  ) {
    return undefined;
  }

  const decoded = Buffer.from(normalizedBase64, 'base64').toString('utf8').trim();
  return INLINE_PEM_PATTERN.test(decoded) ? decoded : undefined;
};

const readCredential = (source, envVarName) => {
  if (!source) {
    throw new Error(`${envVarName} is not configured.`);
  }

  const inlineCredential = resolveInlineCredential(source);
  if (inlineCredential) {
    return inlineCredential;
  }

  return fs.readFileSync(path.resolve(__dirname, source.trim()));
};

const readLocalDevelopmentCredentials = () => {
  if (
    !fs.existsSync(DEFAULT_LOCAL_TLS_PATHS.key)
    || !fs.existsSync(DEFAULT_LOCAL_TLS_PATHS.cert)
  ) {
    return undefined;
  }

  return {
    key: fs.readFileSync(DEFAULT_LOCAL_TLS_PATHS.key),
    cert: fs.readFileSync(DEFAULT_LOCAL_TLS_PATHS.cert),
  };
};

const generateDevelopmentCredentials = async () => {
  if (!generatedDevelopmentCredentialsPromise) {
    const attributes = [{ name: 'commonName', value: 'localhost' }];
    generatedDevelopmentCredentialsPromise = selfsigned.generate(attributes, {
      algorithm: 'sha256',
      days: 30,
      keySize: 2048,
      extensions: [
        {
          name: 'basicConstraints',
          cA: false,
        },
        {
          name: 'keyUsage',
          digitalSignature: true,
          keyEncipherment: true,
        },
        {
          name: 'extKeyUsage',
          serverAuth: true,
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ],
        },
      ],
    }).then(({ private: key, cert }) => ({
      key,
      cert,
    }));
  }

  return generatedDevelopmentCredentialsPromise;
};

const loadTlsCredentials = async () => {
  try {
    if (config.https.keyPath && config.https.certPath) {
      return {
        key: readCredential(config.https.keyPath, 'TLS_KEY'),
        cert: readCredential(config.https.certPath, 'TLS_CERT'),
      };
    }

    if (config.env !== 'production') {
      return readLocalDevelopmentCredentials()
        ?? await generateDevelopmentCredentials();
    }

    return {
      key: readCredential(config.https.keyPath, 'TLS_KEY'),
      cert: readCredential(config.https.certPath, 'TLS_CERT'),
    };
  } catch (err) {
    throw new Error(
      'TLS credentials could not be loaded. '
      + 'Ensure TLS_KEY and TLS_CERT are valid file paths, PEM values, or base64-encoded PEM values. '
      + `Detail: ${err.message}`,
    );
  }
};

module.exports = { loadTlsCredentials };
