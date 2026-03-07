const config = require('./index');

module.exports = {
  httpPort: config.http.port,
  httpsPort: config.https.port,
};
