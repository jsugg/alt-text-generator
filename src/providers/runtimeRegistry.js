const {
  getConfiguredProvidersFromConfig,
} = require('../../config/providerCatalog');
const ImageDescriberFactory = require('../services/ImageDescriberFactory');

const resolveProviderClient = (provider, providerClients = {}) => (
  providerClients[provider.key]
  ?? providerClients[provider.configKey]
);

/**
 * Creates the runtime image-describer registry from the shared provider catalog.
 *
 * @param {object} params
 * @param {object} params.config
 * @param {object} params.logger
 * @param {object} params.httpClient
 * @param {object} params.outboundClients
 * @param {object} params.requestOptions
 * @param {Record<string, object>} [params.providerClients]
 * @returns {ImageDescriberFactory}
 */
const buildImageDescriberFactory = ({
  config,
  logger,
  httpClient,
  outboundClients,
  requestOptions,
  providerClients = {},
}) => {
  const factory = new ImageDescriberFactory();

  getConfiguredProvidersFromConfig(config).forEach((provider) => {
    if (typeof provider.createRuntime !== 'function') {
      throw new Error(`No runtime builder registered for provider '${provider.key}'`);
    }

    const describer = provider.createRuntime({
      config,
      logger,
      httpClient,
      outboundClients,
      requestOptions,
      providerClient: resolveProviderClient(provider, providerClients),
    });

    factory.register(provider.key, describer);
  });

  return factory;
};

module.exports = {
  buildImageDescriberFactory,
};
