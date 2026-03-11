const RATE_LIMIT_STORE_MODES = Object.freeze({
  AUTO: 'auto',
  MEMORY: 'memory',
  REDIS: 'redis',
});

const DEFAULT_RATE_LIMIT_REDIS_PREFIX = 'alt-text-generator:rate-limit:';
const DEFAULT_UNIT_LOCAL_REDIS_URL = 'redis://127.0.0.1:6379';
const RATE_LIMIT_REDIS_TOPOLOGIES = Object.freeze({
  EXTERNAL: 'external',
  UNIT_LOCAL: 'unit-local',
});
const VALID_RATE_LIMIT_STORE_MODES = new Set(Object.values(RATE_LIMIT_STORE_MODES));
const VALID_RATE_LIMIT_REDIS_TOPOLOGIES = new Set(
  Object.values(RATE_LIMIT_REDIS_TOPOLOGIES),
);

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

const resolveRateLimitRedisTopology = (value) => (
  VALID_RATE_LIMIT_REDIS_TOPOLOGIES.has(value)
    ? value
    : RATE_LIMIT_REDIS_TOPOLOGIES.EXTERNAL
);

const resolveRateLimitRedisUrl = (
  envLike = {},
  redisTopology = RATE_LIMIT_REDIS_TOPOLOGIES.EXTERNAL,
) => (
  toNonEmptyString(envLike.RATE_LIMIT_REDIS_URL)
  ?? toNonEmptyString(envLike.REDIS_URL)
  ?? (
    redisTopology === RATE_LIMIT_REDIS_TOPOLOGIES.UNIT_LOCAL
      ? DEFAULT_UNIT_LOCAL_REDIS_URL
      : undefined
  )
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
  const redisTopology = resolveRateLimitRedisTopology(
    toNonEmptyString(envLike.RATE_LIMIT_REDIS_TOPOLOGY),
  );
  const redisUrl = resolveRateLimitRedisUrl(envLike, redisTopology);

  return {
    kind: resolveEffectiveRateLimitStoreKind({ mode, redisUrl }),
    mode,
    redisTopology,
    redisPrefix: normalizeRedisPrefix(envLike.RATE_LIMIT_REDIS_PREFIX),
    redisUrl,
  };
};

module.exports = {
  buildRateLimitStoreConfig,
  DEFAULT_RATE_LIMIT_REDIS_PREFIX,
  DEFAULT_UNIT_LOCAL_REDIS_URL,
  RATE_LIMIT_REDIS_TOPOLOGIES,
  RATE_LIMIT_STORE_MODES,
  resolveEffectiveRateLimitStoreKind,
  resolveRateLimitRedisTopology,
  resolveRateLimitRedisUrl,
  resolveRateLimitStoreMode,
};
