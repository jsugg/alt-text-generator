const express = require('express');

const {
  buildProviderValidationPageHtml,
  getProviderValidationAsset,
} = require('../providerValidation/fixtures');

/**
 * Builds the public provider-validation router used by hosted live checks.
 *
 * @returns {object} Express Router
 */
module.exports.createProviderValidationRouter = () => {
  const router = express.Router();

  router.get('/provider-validation/page', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.type('html').send(buildProviderValidationPageHtml(baseUrl));
  });

  router.get('/provider-validation/assets/:name', (req, res) => {
    const asset = getProviderValidationAsset(req.params.name);

    if (!asset) {
      res.status(404).type('text/plain').send('asset not found');
      return;
    }

    res.type('image/png').send(asset);
  });

  return router;
};
