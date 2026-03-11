const {
  buildRateLimitStoreConfig,
  DEFAULT_RATE_LIMIT_REDIS_PREFIX,
  RATE_LIMIT_STORE_MODES,
  resolveEffectiveRateLimitStoreKind,
} = require('../../../config/rateLimitStore');

describe('rateLimitStore config helpers', () => {
  it('defaults to auto mode with in-memory storage when no Redis URL is configured', () => {
    expect(buildRateLimitStoreConfig({})).toEqual({
      kind: RATE_LIMIT_STORE_MODES.MEMORY,
      mode: RATE_LIMIT_STORE_MODES.AUTO,
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
      redisPrefix: DEFAULT_RATE_LIMIT_REDIS_PREFIX,
      redisUrl: 'redis://shared.example:6379',
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
