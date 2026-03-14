const Replicate = require('replicate');

const ReplicateDescriberService = require('../../services/ReplicateDescriberService');
const { isExplicitlyDisabled } = require('./helpers');

const buildReplicateClient = (providerConfig, fetch) => new Replicate({
  auth: providerConfig.apiToken,
  baseUrl: providerConfig.apiEndpoint,
  fetch,
  userAgent: providerConfig.userAgent,
});

module.exports = {
  key: 'clip',
  configKey: 'replicate',
  displayName: 'Replicate CLIP',
  startupHint: 'REPLICATE_API_TOKEN to enable clip',
  buildEnvSchema: (Joi) => ({
    REPLICATE_ENABLED: Joi.string().valid('true', 'false').optional(),
    REPLICATE_API_TOKEN: Joi.string().optional(),
    REPLICATE_API_ENDPOINT: Joi.string().uri().optional(),
    REPLICATE_USER_AGENT: Joi.string().optional(),
    REPLICATE_MODEL_OWNER: Joi.string().optional(),
    REPLICATE_MODEL_NAME: Joi.string().optional(),
    REPLICATE_MODEL_VERSION: Joi.string().optional(),
  }),
  buildConfig: (env) => ({
    enabled: !isExplicitlyDisabled('REPLICATE_ENABLED', env) && Boolean(env.REPLICATE_API_TOKEN),
    apiToken: env.REPLICATE_API_TOKEN,
    apiEndpoint: env.REPLICATE_API_ENDPOINT,
    userAgent: env.REPLICATE_USER_AGENT || 'alt-text-generator/1.0.0',
    modelOwner: env.REPLICATE_MODEL_OWNER || 'rmokady',
    modelName: env.REPLICATE_MODEL_NAME || 'clip_prefix_caption',
    modelVersion:
      env.REPLICATE_MODEL_VERSION
      || '9a34a6339872a03f45236f114321fb51fc7aa8269d38ae0ce5334969981e4cd8',
  }),
  isConfiguredInEnv: (env = {}) => (
    !isExplicitlyDisabled('REPLICATE_ENABLED', env) && Boolean(env.REPLICATE_API_TOKEN)
  ),
  isConfiguredInConfig: (config = {}) => (
    config.replicate?.enabled !== false && Boolean(config.replicate?.apiToken)
  ),
  validateEnv: () => [],
  providerValidation: {
    scopeKey: 'replicate',
    autoPriority: 20,
    folderName: '90 Provider Validation',
    requestEnvVars: ['model=clip'],
    scopeRequirement: 'REPLICATE_API_TOKEN',
    allRequirement: 'REPLICATE_API_TOKEN',
  },
  createRuntime: ({
    config,
    logger,
    outboundClients,
    providerClient,
  }) => {
    const providerConfig = config.replicate;
    const replicateClient = providerClient ?? buildReplicateClient(
      providerConfig,
      outboundClients.fetch,
    );

    return new ReplicateDescriberService({
      logger,
      replicateClient,
      providerConfig,
    });
  },
};
