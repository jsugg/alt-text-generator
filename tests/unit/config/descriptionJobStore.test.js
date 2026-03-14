const {
  DEFAULT_DESCRIPTION_JOB_CLAIM_TTL_MS,
  buildDescriptionJobStoreConfig,
  DEFAULT_DESCRIPTION_JOB_COMPLETED_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_FAILED_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_PENDING_TTL_MS,
  DEFAULT_DESCRIPTION_JOB_POLL_INTERVAL_MS,
  DEFAULT_DESCRIPTION_JOB_REDIS_PREFIX,
  DEFAULT_DESCRIPTION_JOB_WAIT_TIMEOUT_MS,
  DESCRIPTION_JOB_STORE_MODES,
} = require('../../../config/descriptionJobStore');

describe('Unit | Config | Description Job Store', () => {
  it('defaults to auto mode with in-memory storage when no Redis URL is configured', () => {
    expect(buildDescriptionJobStoreConfig({})).toEqual({
      kind: DESCRIPTION_JOB_STORE_MODES.MEMORY,
      mode: DESCRIPTION_JOB_STORE_MODES.AUTO,
      redisPrefix: DEFAULT_DESCRIPTION_JOB_REDIS_PREFIX,
      redisUrl: undefined,
      waitTimeoutMs: DEFAULT_DESCRIPTION_JOB_WAIT_TIMEOUT_MS,
      pollIntervalMs: DEFAULT_DESCRIPTION_JOB_POLL_INTERVAL_MS,
      pendingTtlMs: DEFAULT_DESCRIPTION_JOB_PENDING_TTL_MS,
      completedTtlMs: DEFAULT_DESCRIPTION_JOB_COMPLETED_TTL_MS,
      failedTtlMs: DEFAULT_DESCRIPTION_JOB_FAILED_TTL_MS,
      claimTtlMs: DEFAULT_DESCRIPTION_JOB_CLAIM_TTL_MS,
    });
  });

  it('prefers the explicit description-job Redis URL and normalizes the prefix', () => {
    expect(buildDescriptionJobStoreConfig({
      DESCRIPTION_JOB_STORE: 'auto',
      DESCRIPTION_JOB_REDIS_PREFIX: 'jobs-prefix',
      DESCRIPTION_JOB_REDIS_URL: 'redis://jobs.example:6379',
      REDIS_URL: 'redis://shared.example:6379',
      DESCRIPTION_JOB_WAIT_TIMEOUT_MS: '9000',
      DESCRIPTION_JOB_POLL_INTERVAL_MS: '250',
      DESCRIPTION_JOB_PENDING_TTL_MS: '120000',
      DESCRIPTION_JOB_COMPLETED_TTL_MS: '3600000',
      DESCRIPTION_JOB_FAILED_TTL_MS: '60000',
      DESCRIPTION_JOB_CLAIM_TTL_MS: '45000',
    })).toEqual({
      kind: DESCRIPTION_JOB_STORE_MODES.REDIS,
      mode: DESCRIPTION_JOB_STORE_MODES.AUTO,
      redisPrefix: 'jobs-prefix:',
      redisUrl: 'redis://jobs.example:6379',
      waitTimeoutMs: 9000,
      pollIntervalMs: 250,
      pendingTtlMs: 120000,
      completedTtlMs: 3600000,
      failedTtlMs: 60000,
      claimTtlMs: 45000,
    });
  });
});
