const express = require('express');

const {
  buildProviderValidationPageHtml,
  getProviderValidationAsset,
} = require('../providerValidation/fixtures');

/**
 * @typedef {object} ValidationRequest
 * @property {string} protocol
 * @property {(name: string) => string | undefined} get
 * @property {Record<string, string>} params
 */

/**
 * @typedef {object} ValidationResponse
 * @property {(contentType: string) => ValidationResponse} type
 * @property {(body: unknown) => unknown} send
 * @property {(code: number) => ValidationResponse} status
 */

/**
 * @typedef {object} ValidationRouter
 * @property {(path: string, handler: (req: ValidationRequest, res: ValidationResponse) => unknown) => unknown} get
 */

/**
 * Builds the public provider-validation router used by production live checks.
 *
 * @returns {object} Express Router
 */
module.exports.createProviderValidationRouter = () => {
  const router = /** @type {ValidationRouter} */ (express.Router());

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
