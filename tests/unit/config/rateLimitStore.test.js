const {
  buildRateLimitStoreConfig,
  DEFAULT_RATE_LIMIT_REDIS_PREFIX,
  DEFAULT_UNIT_LOCAL_REDIS_URL,
  RATE_LIMIT_REDIS_TOPOLOGIES,
  RATE_LIMIT_STORE_MODES,
  resolveEffectiveRateLimitStoreKind,
} = require('../../../config/rateLimitStore');

describe('Unit | Config | Rate Limit Store', () => {
  it('defaults to auto mode with in-memory storage when no Redis URL is configured', () => {
    expect(buildRateLimitStoreConfig({})).toEqual({
      kind: RATE_LIMIT_STORE_MODES.MEMORY,
      mode: RATE_LIMIT_STORE_MODES.AUTO,
      redisTopology: RATE_LIMIT_REDIS_TOPOLOGIES.EXTERNAL,
      redisPrefix: DEFAULT_RATE_LIMIT_REDIS_PREFIX,
      redisUrl: undefined,
    });
  });

  it('prefers RATE_LIMIT_REDIS_URL and normalizes the prefix', () => {
    expect(buildRateLimitStoreConfig({
      RATE_LIMIT_STORE: 'auto',
      RATE_LIMIT_REDIS_PREFIX: 'custom-prefix',
      RATE_LIMIT_REDIS_URL: 'redis://rate-limit.example:6379',
      REDIS_URL: 'redis://shared.example:6379',
    })).toEqual({
      kind: RATE_LIMIT_STORE_MODES.REDIS,
      mode: RATE_LIMIT_STORE_MODES.AUTO,
      redisTopology: RATE_LIMIT_REDIS_TOPOLOGIES.EXTERNAL,
      redisPrefix: 'custom-prefix:',
      redisUrl: 'redis://rate-limit.example:6379',
    });
  });

  it('allows Redis to be disabled explicitly even when REDIS_URL is present', () => {
    expect(buildRateLimitStoreConfig({
      RATE_LIMIT_STORE: 'memory',
      REDIS_URL: 'redis://shared.example:6379',
    })).toEqual({
      kind: RATE_LIMIT_STORE_MODES.MEMORY,
      mode: RATE_LIMIT_STORE_MODES.MEMORY,
      redisTopology: RATE_LIMIT_REDIS_TOPOLOGIES.EXTERNAL,
      redisPrefix: DEFAULT_RATE_LIMIT_REDIS_PREFIX,
      redisUrl: 'redis://shared.example:6379',
    });
  });

  it('supports a future unit-local Redis topology behind an explicit flag', () => {
    expect(buildRateLimitStoreConfig({
      RATE_LIMIT_REDIS_TOPOLOGY: 'unit-local',
      RATE_LIMIT_STORE: 'auto',
    })).toEqual({
      kind: RATE_LIMIT_STORE_MODES.REDIS,
      mode: RATE_LIMIT_STORE_MODES.AUTO,
      redisTopology: RATE_LIMIT_REDIS_TOPOLOGIES.UNIT_LOCAL,
      redisPrefix: DEFAULT_RATE_LIMIT_REDIS_PREFIX,
      redisUrl: DEFAULT_UNIT_LOCAL_REDIS_URL,
    });
  });

  it('resolves the effective kind from the configured mode and Redis URL', () => {
    expect(resolveEffectiveRateLimitStoreKind({
      mode: RATE_LIMIT_STORE_MODES.AUTO,
      redisUrl: undefined,
    })).toBe(RATE_LIMIT_STORE_MODES.MEMORY);

    expect(resolveEffectiveRateLimitStoreKind({
      mode: RATE_LIMIT_STORE_MODES.AUTO,
      redisUrl: 'redis://shared.example:6379',
    })).toBe(RATE_LIMIT_STORE_MODES.REDIS);

    expect(resolveEffectiveRateLimitStoreKind({
      mode: RATE_LIMIT_STORE_MODES.REDIS,
      redisUrl: undefined,
    })).toBe(RATE_LIMIT_STORE_MODES.REDIS);
  });
});
