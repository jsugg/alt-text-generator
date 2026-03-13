const Replicate = require('replicate');

const {
  getConfiguredProvidersFromConfig,
} = require('../../config/providerCatalog');
const ImageDescriberFactory = require('../services/ImageDescriberFactory');
const ReplicateDescriberService = require('../services/ReplicateDescriberService');
const AzureDescriberService = require('../services/AzureDescriberService');

const buildReplicateClient = (config, fetch) => new Replicate({
  auth: config.replicate.apiToken,
  baseUrl: config.replicate.apiEndpoint,
  fetch,
  userAgent: config.replicate.userAgent,
});

const runtimeProviderBuilders = {
  clip: ({
    config,
    logger,
    outboundClients,
    providerClient,
  }) => {
    const replicateClient = providerClient ?? buildReplicateClient(
      config,
      outboundClients.fetch,
    );

    return new ReplicateDescriberService({
      logger,
      replicateClient,
      config,
    });
  },
  azure: ({
    config,
    logger,
    httpClient,
    requestOptions,
  }) => new AzureDescriberService({
    logger,
    httpClient,
    config,
    requestOptions,
  }),
};

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
    const buildProvider = runtimeProviderBuilders[provider.key];

    if (!buildProvider) {
      throw new Error(`No runtime builder registered for provider '${provider.key}'`);
    }

    const describer = buildProvider({
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
