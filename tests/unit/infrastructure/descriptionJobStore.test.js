const {
  createMemoryDescriptionJobStore,
  createRedisDescriptionJobStore,
  initializeDescriptionJobStore,
} = require('../../../src/infrastructure/descriptionJobStore');

describe('Unit | Infrastructure | Description Job Store', () => {
  it('expires in-memory jobs on read and clears state on close', async () => {
    const store = createMemoryDescriptionJobStore();

    await store.set({
      id: 'job-expired',
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await store.set({
      id: 'job-active',
      status: 'succeeded',
      result: { description: 'done' },
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    await expect(store.get('job-expired')).resolves.toBeNull();
    await expect(store.get('job-active')).resolves.toEqual(expect.objectContaining({
      id: 'job-active',
      status: 'succeeded',
      result: { description: 'done' },
    }));

    await store.close();
    await expect(store.get('job-active')).resolves.toBeNull();
  });

  it('claims in-memory jobs when the lease is free or expired', async () => {
    const store = createMemoryDescriptionJobStore();

    await store.set({
      id: 'job-claim',
      status: 'pending',
      expiresAt: new Date(Date.now() + 2000).toISOString(),
    });

    await expect(store.claim('job-claim', 'runner-a', 1000)).resolves.toEqual(
      expect.objectContaining({
        id: 'job-claim',
        runnerId: 'runner-a',
      }),
    );
    await expect(store.claim('job-claim', 'runner-b', 1000)).resolves.toBeNull();

    await store.set({
      id: 'job-claim',
      status: 'pending',
      runnerId: 'runner-a',
      leaseExpiresAtEpochMs: Date.now() - 1000,
      expiresAt: new Date(Date.now() + 2000).toISOString(),
    });

    await expect(store.claim('job-claim', 'runner-b', 1000)).resolves.toEqual(
      expect.objectContaining({
        id: 'job-claim',
        runnerId: 'runner-b',
      }),
    );
  });

  it('stores Redis jobs with ttl, deletes expired payloads, and closes open clients', async () => {
    const backingMap = new Map();
    const transaction = {
      set: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => ['OK']),
    };
    const client = {
      isOpen: true,
      get: jest.fn(async (key) => backingMap.get(key) ?? null),
      watch: jest.fn().mockResolvedValue(undefined),
      unwatch: jest.fn().mockResolvedValue(undefined),
      multi: jest.fn(() => transaction),
      set: jest.fn(async (key, value, options) => {
        backingMap.set(key, value);
        expect(options).toEqual(expect.objectContaining({
          EX: expect.any(Number),
        }));
      }),
      del: jest.fn(async (key) => {
        backingMap.delete(key);
      }),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const store = createRedisDescriptionJobStore({
      client,
      prefix: 'jobs:',
    });

    await store.set({
      id: 'job-1',
      status: 'processing',
      expiresAt: new Date(Date.now() + 2000).toISOString(),
    });
    await expect(store.get('job-1')).resolves.toEqual(expect.objectContaining({
      id: 'job-1',
      status: 'processing',
    }));

    backingMap.set('jobs:job-expired', JSON.stringify({
      id: 'job-expired',
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }));
    await expect(store.get('job-expired')).resolves.toBeNull();
    expect(client.del).toHaveBeenCalledWith('jobs:job-expired');

    await expect(store.claim('job-1', 'runner-a', 1000)).resolves.toEqual(
      expect.objectContaining({
        id: 'job-1',
        runnerId: 'runner-a',
      }),
    );
    expect(client.watch).toHaveBeenCalledWith('jobs:job-1');
    expect(transaction.set).toHaveBeenCalledWith(
      'jobs:job-1',
      expect.any(String),
      expect.objectContaining({
        EX: expect.any(Number),
      }),
    );

    await store.delete('job-1');
    expect(client.del).toHaveBeenCalledWith('jobs:job-1');

    await store.close();
    expect(client.quit).toHaveBeenCalledTimes(1);

    client.isOpen = false;
    await store.close();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('initializes a memory store unless Redis is explicitly selected', async () => {
    const store = await initializeDescriptionJobStore({
      config: {
        descriptionJobs: {
          kind: 'memory',
        },
      },
    });

    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('fails fast when Redis mode is selected without a Redis URL', async () => {
    await expect(initializeDescriptionJobStore({
      config: {
        descriptionJobs: {
          kind: 'redis',
          redisPrefix: 'jobs:',
        },
      },
    })).rejects.toThrow(
      'Description job store is configured for Redis but no Redis URL was provided',
    );
  });

  it('initializes a Redis-backed store and wires client errors to the logger', async () => {
    const listeners = {};
    const connect = jest.fn().mockResolvedValue(undefined);
    const client = {
      isOpen: true,
      on: jest.fn((event, handler) => {
        listeners[event] = handler;
      }),
      connect,
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      quit: jest.fn().mockResolvedValue(undefined),
    };
    const createClientFn = jest.fn(() => client);
    const logger = {
      error: jest.fn(),
    };

    const store = await initializeDescriptionJobStore({
      config: {
        descriptionJobs: {
          kind: 'redis',
          redisUrl: 'redis://127.0.0.1:6379',
          redisPrefix: 'jobs:',
        },
      },
      logger,
      createClientFn,
    });

    expect(createClientFn).toHaveBeenCalledWith({
      url: 'redis://127.0.0.1:6379',
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(typeof listeners.error).toBe('function');

    const redisError = new Error('redis failed');
    listeners.error(redisError);
    expect(logger.error).toHaveBeenCalledWith({
      err: redisError,
    }, 'Description-job Redis client error');

    await store.close();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });
});
