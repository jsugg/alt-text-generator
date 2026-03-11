const express = require('express');
const axios = require('axios');
const Replicate = require('replicate');

const defaultConfig = require('../config');
const {
  appLogger: defaultAppLogger,
  requestLogger: defaultRequestLogger,
} = require('./infrastructure/logger');
const { createOutboundClients } = require('./infrastructure/outboundTrust');
const ScraperService = require('./services/ScraperService');
const ReplicateDescriberService = require('./services/ReplicateDescriberService');
const AzureDescriberService = require('./services/AzureDescriberService');
const ImageDescriberFactory = require('./services/ImageDescriberFactory');
const PageDescriptionService = require('./services/PageDescriptionService');
const { createHealthController } = require('./api/v1/controllers/healthController');
const ScraperController = require('./api/v1/controllers/scraperController');
const DescriptionController = require('./api/v1/controllers/descriptionController');
const { applyMiddlewares } = require('./utils/applyBaseMiddleware');
const { createStatusRateLimiter } = require('./api/v1/middleware/rate-limiters');
const {
  createAccessControlMiddleware,
} = require('./api/v1/middleware/access-control');
const { errorHandler } = require('./api/v1/middleware/error-handler');
const createRequestFilter = require('./api/v1/middleware/request-filter');
const { createRouter } = require('./utils/createRouter');
const buildApiRouter = require('./api/v1/routes/api');

const buildReplicateClient = (config, fetch) => new Replicate({
  auth: config.replicate.apiToken,
  baseUrl: config.replicate.apiEndpoint,
  fetch,
  userAgent: config.replicate.userAgent,
});

const hasReplicateProviderConfig = (replicateConfig = {}) => Boolean(
  replicateConfig.apiToken,
);

const hasAzureProviderConfig = (azureConfig = {}) => Boolean(
  azureConfig.apiEndpoint && azureConfig.subscriptionKey,
);

const buildImageDescriberFactory = ({
  config,
  logger,
  replicateClient,
  httpClient,
  requestOptions,
}) => {
  const factory = new ImageDescriberFactory();
  if (hasReplicateProviderConfig(config.replicate)) {
    const replicateDescriber = new ReplicateDescriberService({
      logger,
      replicateClient,
      config,
    });

    factory.register('clip', replicateDescriber);
  }

  if (hasAzureProviderConfig(config.azure)) {
    const azureDescriber = new AzureDescriberService({
      logger,
      httpClient,
      config,
      requestOptions,
    });

    factory.register('azure', azureDescriber);
  }

  return factory;
};

const createApp = ({
  config = defaultConfig,
  appLogger = defaultAppLogger,
  requestLogger = defaultRequestLogger,
  httpClient,
  scraperService,
  imageDescriberFactory,
  pageDescriptionService,
  health,
  outboundClients,
  replicateClient,
  runtimeState,
} = {}) => {
  const scraperConfig = config.scraper ?? defaultConfig.scraper;
  const proxyConfig = config.proxy ?? defaultConfig.proxy;
  const resolvedOutboundClients = outboundClients ?? createOutboundClients(config);
  const resolvedHttpClient = httpClient ?? resolvedOutboundClients.httpClient ?? axios;
  const resolvedScraperService = scraperService ?? new ScraperService({
    logger: appLogger,
    httpClient: resolvedHttpClient,
    requestOptions: {
      timeout: scraperConfig.requestTimeoutMs,
      maxRedirects: scraperConfig.maxRedirects,
      maxContentLength: scraperConfig.maxContentLengthBytes,
    },
  });
  const resolvedImageDescriberFactory = imageDescriberFactory
    ?? buildImageDescriberFactory({
      config,
      logger: appLogger,
      httpClient: resolvedHttpClient,
      requestOptions: {
        timeout: scraperConfig.requestTimeoutMs,
        maxRedirects: scraperConfig.maxRedirects,
        maxContentLength: scraperConfig.maxContentLengthBytes,
      },
      replicateClient: hasReplicateProviderConfig(config.replicate)
        ? (replicateClient ?? buildReplicateClient(config, resolvedOutboundClients.fetch))
        : undefined,
    });
  const resolvedPageDescriptionService = pageDescriptionService
    ?? new PageDescriptionService({
      scraperService: resolvedScraperService,
      imageDescriberFactory: resolvedImageDescriberFactory,
    });
  const resolvedHealthController = health ?? createHealthController({ runtimeState });
  const statusRateLimiter = createStatusRateLimiter(config);

  const scraperController = new ScraperController({
    scraperService: resolvedScraperService,
    logger: appLogger,
  });
  const descriptionController = new DescriptionController({
    imageDescriberFactory: resolvedImageDescriberFactory,
    pageDescriptionService: resolvedPageDescriptionService,
    logger: appLogger,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', proxyConfig.trustProxyHops);

  applyMiddlewares(app, requestLogger, config);
  const { loadRequestFilter } = createRequestFilter(appLogger);
  loadRequestFilter(app);
  app.use(createAccessControlMiddleware(config.auth));

  const apiRouter = buildApiRouter({
    health: resolvedHealthController,
    scraper: scraperController,
    description: descriptionController,
    statusRateLimiter,
  }, appLogger);
  const mainRouter = createRouter(appLogger, apiRouter);
  app.use(mainRouter);
  app.use(errorHandler);

  return {
    app,
    appLogger,
    requestLogger,
    services: {
      outboundClients: resolvedOutboundClients,
      scraperService: resolvedScraperService,
      imageDescriberFactory: resolvedImageDescriberFactory,
      pageDescriptionService: resolvedPageDescriptionService,
    },
  };
};

module.exports = { createApp };
