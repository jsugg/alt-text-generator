const fs = require('fs');
const path = require('path');
const config = require('../../config');

module.exports.readCertFile = () => {
  const keyPath = config.https.keyPath;
  const certPath = config.https.certPath;

  try {
    return {
      key: fs.readFileSync(path.resolve(__dirname, keyPath)),
      cert: fs.readFileSync(path.resolve(__dirname, certPath)),
    };
  } catch (err) {
    throw new Error(
      `TLS certificate files not found. Ensure TLS_KEY and TLS_CERT env vars point to valid files. Detail: ${err.message}`,
    );
  }
};
