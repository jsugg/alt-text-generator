const {
  REDIS_INTEGRATION_MODES,
  REDIS_INTEGRATION_MODE_ENV,
  REDIS_INTEGRATION_URL_ENV,
  resolveRedisIntegrationRuntime,
} = require('../helpers/redisTestServer');

const missingRedisServerBinary = () => false;
const availableRedisServerBinary = () => true;

describe('Unit | Redis Test Server Helper', () => {
  it('skips Redis integration only in explicit optional local mode with actionable diagnostics', () => {
    const runtime = resolveRedisIntegrationRuntime({
      env: {},
      hasRedisServerBinaryFn: missingRedisServerBinary,
    });

    expect(runtime).toMatchObject({
      enabled: false,
      mode: REDIS_INTEGRATION_MODES.OPTIONAL,
      source: 'missing',
    });
    expect(runtime.diagnostic).toContain('optional mode');
    expect(runtime.diagnostic).toContain('docker compose -f docker-compose.redis.yml');
    expect(runtime.diagnostic).toContain('npm run test:integration:redis');
  });

  it('marks explicit Redis integration runs as required locally', () => {
    const runtime = resolveRedisIntegrationRuntime({
      env: {
        [REDIS_INTEGRATION_MODE_ENV]: REDIS_INTEGRATION_MODES.REQUIRED,
      },
      hasRedisServerBinaryFn: missingRedisServerBinary,
    });

    expect(runtime).toMatchObject({
      enabled: false,
      mode: REDIS_INTEGRATION_MODES.REQUIRED,
      source: 'missing',
    });
    expect(runtime.diagnostic).toContain('required mode');
  });

  it('requires Redis in CI even if a caller requests optional mode', () => {
    const runtime = resolveRedisIntegrationRuntime({
      env: {
        CI: 'true',
        [REDIS_INTEGRATION_MODE_ENV]: REDIS_INTEGRATION_MODES.OPTIONAL,
      },
      hasRedisServerBinaryFn: missingRedisServerBinary,
    });

    expect(runtime.mode).toBe(REDIS_INTEGRATION_MODES.REQUIRED);
    expect(runtime.diagnostic).toContain('CI must provide the pinned Redis service container');
  });

  it('uses an explicit Redis integration URL without requiring a host binary', () => {
    const runtime = resolveRedisIntegrationRuntime({
      env: {
        [REDIS_INTEGRATION_URL_ENV]: ' redis://127.0.0.1:6380 ',
      },
      hasRedisServerBinaryFn: missingRedisServerBinary,
    });

    expect(runtime).toMatchObject({
      enabled: true,
      redisUrl: 'redis://127.0.0.1:6380',
      source: 'url',
    });
  });

  it('uses a local redis-server binary when no URL is configured', () => {
    const runtime = resolveRedisIntegrationRuntime({
      env: {},
      hasRedisServerBinaryFn: availableRedisServerBinary,
    });

    expect(runtime).toMatchObject({
      enabled: true,
      redisUrl: undefined,
      source: 'binary',
    });
  });

  it('rejects invalid Redis integration mode and URL values', () => {
    expect(() => resolveRedisIntegrationRuntime({
      env: {
        [REDIS_INTEGRATION_MODE_ENV]: 'silent',
      },
      hasRedisServerBinaryFn: missingRedisServerBinary,
    })).toThrow(`${REDIS_INTEGRATION_MODE_ENV} must be "required" or "optional"`);

    expect(() => resolveRedisIntegrationRuntime({
      env: {
        [REDIS_INTEGRATION_URL_ENV]: 'http://127.0.0.1:6379',
      },
      hasRedisServerBinaryFn: missingRedisServerBinary,
    })).toThrow(`${REDIS_INTEGRATION_URL_ENV} must be a redis:// or rediss:// URL`);
  });
});
