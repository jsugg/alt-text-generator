const fs = require('node:fs');
const path = require('node:path');

const yaml = require('js-yaml');

const DEFAULT_PROVIDER_OVERRIDES_FILE = path.join(__dirname, 'providers.yaml');
const PROVIDER_OVERRIDE_AUTO = 'auto';

const normalizeEnabledValue = (value, providerKey) => {
  if (value === undefined) {
    return PROVIDER_OVERRIDE_AUTO;
  }

  if (value === true || value === false) {
    return value;
  }

  if (typeof value === 'string' && value.trim().toLowerCase() === PROVIDER_OVERRIDE_AUTO) {
    return PROVIDER_OVERRIDE_AUTO;
  }

  throw new Error(
    `Provider override for '${providerKey}' must set enabled to true, false, or auto`,
  );
};

const parseProviderOverridesDocument = (document, filePath) => {
  if (document === undefined || document === null) {
    return {};
  }

  if (typeof document !== 'object' || Array.isArray(document)) {
    throw new Error(`Provider override file '${filePath}' must contain a top-level mapping`);
  }

  if (document.providers === undefined || document.providers === null) {
    return {};
  }

  if (typeof document.providers !== 'object' || Array.isArray(document.providers)) {
    throw new Error(`Provider override file '${filePath}' must contain a 'providers' mapping`);
  }

  return Object.entries(document.providers).reduce((providers, [providerKey, providerConfig]) => {
    if (typeof providerConfig !== 'object' || providerConfig === null || Array.isArray(providerConfig)) {
      throw new Error(`Provider override for '${providerKey}' in '${filePath}' must be a mapping`);
    }

    return {
      ...providers,
      [providerKey]: {
        enabled: normalizeEnabledValue(providerConfig.enabled, providerKey),
      },
    };
  }, {});
};

const resolveProviderOverridesFile = (env = process.env) => (
  env.PROVIDER_OVERRIDES_FILE
    ? path.resolve(env.PROVIDER_OVERRIDES_FILE)
    : DEFAULT_PROVIDER_OVERRIDES_FILE
);

const loadProviderOverrides = (env = process.env) => {
  const filePath = resolveProviderOverridesFile(env);

  if (!fs.existsSync(filePath)) {
    return {
      filePath,
      providers: {},
    };
  }

  const source = fs.readFileSync(filePath, 'utf8');
  const document = yaml.load(source);

  return {
    filePath,
    providers: parseProviderOverridesDocument(document, filePath),
  };
};

module.exports = {
  DEFAULT_PROVIDER_OVERRIDES_FILE,
  PROVIDER_OVERRIDE_AUTO,
  loadProviderOverrides,
  resolveProviderOverridesFile,
};
