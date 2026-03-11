const RATE_LIMIT_STORE_MODES = Object.freeze({
  AUTO: 'auto',
  MEMORY: 'memory',
  REDIS: 'redis',
});

const DEFAULT_RATE_LIMIT_REDIS_PREFIX = 'alt-text-generator:rate-limit:';
const VALID_RATE_LIMIT_STORE_MODES = new Set(Object.values(RATE_LIMIT_STORE_MODES));

const toNonEmptyString = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
};

const normalizeRedisPrefix = (value) => {
  const trimmedValue = toNonEmptyString(value);
  if (!trimmedValue) {
    return DEFAULT_RATE_LIMIT_REDIS_PREFIX;
  }

  return trimmedValue.endsWith(':') ? trimmedValue : `${trimmedValue}:`;
};

const resolveRateLimitRedisUrl = (envLike = {}) => (
  toNonEmptyString(envLike.RATE_LIMIT_REDIS_URL)
  ?? toNonEmptyString(envLike.REDIS_URL)
);

const resolveRateLimitStoreMode = (value) => (
  VALID_RATE_LIMIT_STORE_MODES.has(value)
    ? value
    : RATE_LIMIT_STORE_MODES.AUTO
);

const resolveEffectiveRateLimitStoreKind = ({
  mode = RATE_LIMIT_STORE_MODES.AUTO,
  redisUrl,
} = {}) => {
  if (mode !== RATE_LIMIT_STORE_MODES.AUTO) {
    return mode;
  }

  return redisUrl ? RATE_LIMIT_STORE_MODES.REDIS : RATE_LIMIT_STORE_MODES.MEMORY;
};

const buildRateLimitStoreConfig = (envLike = process.env) => {
  const mode = resolveRateLimitStoreMode(toNonEmptyString(envLike.RATE_LIMIT_STORE));
  const redisUrl = resolveRateLimitRedisUrl(envLike);

  return {
    kind: resolveEffectiveRateLimitStoreKind({ mode, redisUrl }),
    mode,
    redisPrefix: normalizeRedisPrefix(envLike.RATE_LIMIT_REDIS_PREFIX),
    redisUrl,
  };
};

module.exports = {
  buildRateLimitStoreConfig,
  DEFAULT_RATE_LIMIT_REDIS_PREFIX,
  RATE_LIMIT_STORE_MODES,
  resolveEffectiveRateLimitStoreKind,
  resolveRateLimitRedisUrl,
  resolveRateLimitStoreMode,
};
