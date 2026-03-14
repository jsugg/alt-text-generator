const DESCRIPTION_JOB_STORE_MODES = Object.freeze({
  AUTO: 'auto',
  MEMORY: 'memory',
  REDIS: 'redis',
});

const DEFAULT_DESCRIPTION_JOB_REDIS_PREFIX = 'alt-text-generator:description-jobs:';
const DEFAULT_DESCRIPTION_JOB_WAIT_TIMEOUT_MS = 5000;
const DEFAULT_DESCRIPTION_JOB_POLL_INTERVAL_MS = 1000;
const DEFAULT_DESCRIPTION_JOB_PENDING_TTL_MS = 15 * 60 * 1000;
const DEFAULT_DESCRIPTION_JOB_COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DESCRIPTION_JOB_FAILED_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DESCRIPTION_JOB_CLAIM_TTL_MS = 30 * 1000;

const toNumber = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
};

const normalizeRedisPrefix = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULT_DESCRIPTION_JOB_REDIS_PREFIX;
  }

  return value.endsWith(':') ? value : `${value}:`;
};

const resolveDescriptionJobRedisUrl = (envLike = {}) => (
  envLike.DESCRIPTION_JOB_REDIS_URL
  || envLike.REDIS_URL
  || envLike.RATE_LIMIT_REDIS_URL
);

const resolveDescriptionJobStoreKind = ({ mode, redisUrl }) => {
  if (mode === DESCRIPTION_JOB_STORE_MODES.MEMORY) {
    return DESCRIPTION_JOB_STORE_MODES.MEMORY;
  }

  if (mode === DESCRIPTION_JOB_STORE_MODES.REDIS) {
    return DESCRIPTION_JOB_STORE_MODES.REDIS;
  }

  return redisUrl ? DESCRIPTION_JOB_STORE_MODES.REDIS : DESCRIPTION_JOB_STORE_MODES.MEMORY;
};

const buildDescriptionJobStoreConfig = (envLike = {}) => {
  const mode = Object.values(DESCRIPTION_JOB_STORE_MODES).includes(envLike.DESCRIPTION_JOB_STORE)
    ? envLike.DESCRIPTION_JOB_STORE
    : DESCRIPTION_JOB_STORE_MODES.AUTO;
  const redisUrl = resolveDescriptionJobRedisUrl(envLike);

  return {
    kind: resolveDescriptionJobStoreKind({ mode, redisUrl }),
    mode,
    redisPrefix: normalizeRedisPrefix(envLike.DESCRIPTION_JOB_REDIS_PREFIX),
    redisUrl,
    waitTimeoutMs: toNumber(
      envLike.DESCRIPTION_JOB_WAIT_TIMEOUT_MS,
      DEFAULT_DESCRIPTION_JOB_WAIT_TIMEOUT_MS,
    ),
    pollIntervalMs: toNumber(
      envLike.DESCRIPTION_JOB_POLL_INTERVAL_MS,
      DEFAULT_DESCRIPTION_JOB_POLL_INTERVAL_MS,
    ),
    pendingTtlMs: toNumber(
      envLike.DESCRIPTION_JOB_PENDING_TTL_MS,
      DEFAULT_DESCRIPTION_JOB_PENDING_TTL_MS,
    ),
    completedTtlMs: toNumber(
      envLike.DESCRIPTION_JOB_COMPLETED_TTL_MS,
      DEFAULT_DESCRIPTION_JOB_COMPLETED_TTL_MS,
    ),
    failedTtlMs: toNumber(
      envLike.DESCRIPTION_JOB_FAILED_TTL_MS,
      DEFAULT_DESCRIPTION_JOB_FAILED_TTL_MS,
    ),
    claimTtlMs: toNumber(
      envLike.DESCRIPTION_JOB_CLAIM_TTL_MS,
      DEFAULT_DESCRIPTION_JOB_CLAIM_TTL_MS,
    ),
  };
};

module.exports = {
  DEFAULT_DESCRIPTION_JOB_CLAIM_TTL_MS,
  buildDescriptionJobStoreConfig,
  DEFAULT_DESCRIPTION_JOB_COMPLETED_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_FAILED_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_PENDING_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_POLL_INTERVAL_MS,
  DEFAULT_DESCRIPTION_JOB_REDIS_PREFIX,
  DEFAULT_DESCRIPTION_JOB_WAIT_TIMEOUT_MS,
  DESCRIPTION_JOB_STORE_MODES,
  normalizeRedisPrefix,
  resolveDescriptionJobRedisUrl,
  resolveDescriptionJobStoreKind,
};
