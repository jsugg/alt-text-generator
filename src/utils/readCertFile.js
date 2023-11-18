// utils/readCertFile.js
const fs = require('fs');
const path = require('path');

module.exports.readCertFile = () => {
  const keyPath = process.env.TLS_KEY || '../../certs/localhost-key.pem';
  const certPath = process.env.TLS_CERT || '../../certs/localhost.pem';

  return {
    key: fs.readFileSync(path.resolve(__dirname, keyPath)),
    cert: fs.readFileSync(path.resolve(__dirname, certPath)),
  };
};
