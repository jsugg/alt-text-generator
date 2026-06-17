const flushMicrotasks = async (iterations = 8) => Array.from(
  { length: iterations },
).reduce(
  (promise) => promise.then(() => Promise.resolve()),
  Promise.resolve(),
);

/**
 * Create deferred promise for deterministic async tests.
 *
 * @returns {{ promise: Promise<unknown>, reject: Function, resolve: Function, settled: boolean }}
 */
const createDeferred = () => {
  let settled = false;
  let resolveDeferred;
  let rejectDeferred;

  const settle = (callback) => (value) => {
    if (settled) {
      return;
    }

    settled = true;
    callback(value);
  };

  const promise = new Promise((resolve, reject) => {
    resolveDeferred = settle(resolve);
    rejectDeferred = settle(reject);
  });

  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
    get settled() {
      return settled;
    },
  };
};

/**
 * Create fake clock and timer scheduler for deterministic polling tests.
 *
 * @param {object} [options]
 * @param {number} [options.initialNow]
 * @returns {object}
 */
const createDeterministicScheduler = ({ initialNow = 0 } = {}) => {
  let now = initialNow;
  let nextHandleId = 0;
  let sleepers = [];
  const intervals = new Map();

  const getNextDueTime = () => {
    const nextDueTime = [
      ...sleepers.map((sleeper) => sleeper.at),
      ...[...intervals.values()].map((interval) => interval.nextAt),
    ].reduce(
      (earliest, candidate) => Math.min(earliest, candidate),
      Number.POSITIVE_INFINITY,
    );

    return Number.isFinite(nextDueTime) ? nextDueTime : null;
  };

  const releaseDueSleeps = () => {
    const dueSleeps = sleepers.filter((sleeper) => sleeper.at <= now);
    sleepers = sleepers.filter((sleeper) => sleeper.at > now);
    dueSleeps.forEach((sleeper) => sleeper.resolve());
  };

  const runDueInterval = (handle, interval) => {
    if (!intervals.has(handle) || interval.nextAt > now) {
      return;
    }

    const nextInterval = interval;
    nextInterval.nextAt += nextInterval.intervalMs;
    nextInterval.callback();
    runDueInterval(handle, nextInterval);
  };

  const runDueIntervals = () => {
    [...intervals.entries()].forEach(([handle, interval]) => {
      runDueInterval(handle, interval);
    });
  };

  const processDueEvents = async (targetNow) => {
    const nextDueTime = getNextDueTime();
    if (nextDueTime === null || nextDueTime > targetNow) {
      return;
    }

    now = nextDueTime;
    releaseDueSleeps();
    runDueIntervals();
    await flushMicrotasks();
    await processDueEvents(targetNow);
  };

  const advanceTo = async (targetNow) => {
    if (!Number.isFinite(targetNow) || targetNow < now) {
      throw new Error(`Invalid scheduler target time: ${targetNow}`);
    }

    await flushMicrotasks();
    releaseDueSleeps();
    runDueIntervals();
    await flushMicrotasks();
    await processDueEvents(targetNow);

    now = targetNow;
    releaseDueSleeps();
    runDueIntervals();
    await flushMicrotasks();
  };

  return {
    now: () => now,
    sleep: (durationMs) => new Promise((resolve) => {
      sleepers.push({
        at: now + Math.max(0, durationMs),
        resolve,
      });
    }),
    setInterval: (callback, intervalMs) => {
      const handle = { id: nextHandleId };
      nextHandleId += 1;
      intervals.set(handle, {
        callback,
        intervalMs: Math.max(1, intervalMs),
        nextAt: now + Math.max(1, intervalMs),
      });
      return handle;
    },
    clearInterval: (handle) => {
      intervals.delete(handle);
    },
    advanceBy: async (durationMs) => {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        throw new Error(`Invalid scheduler duration: ${durationMs}`);
      }

      await advanceTo(now + durationMs);
    },
    advanceTo,
    drain: async () => {
      await flushMicrotasks();
      releaseDueSleeps();
      runDueIntervals();
      await flushMicrotasks();
    },
    isoString: (offsetMs = 0) => new Date(now + offsetMs).toISOString(),
    pendingIntervalCount: () => intervals.size,
  };
};

module.exports = {
  createDeferred,
  createDeterministicScheduler,
};
