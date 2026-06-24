/**
 * QE-009 shared test-environment helpers.
 *
 * Pairs with tests/setup/jest.setup.js, which restores the file's baseline
 * environment (and Jest mock state) after every test. These helpers let a test
 * mutate the environment or load a module against a specific environment
 * without hand-rolling save/restore or module-cache juggling.
 */

/**
 * Applies environment overrides in place. A string (or number) value sets the
 * key; `null` or `undefined` deletes it. Values are coerced to strings to match
 * how process.env stores them.
 *
 * @param {Record<string, string | number | null | undefined>} [overrides]
 */
function setEnv(overrides = {}) {
  Object.entries(overrides).forEach(([key, value]) => {
    if (value === null || value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  });
}

/**
 * Runs `fn` with `overrides` applied to process.env, then restores the exact
 * prior environment — even if `fn` throws or rejects. Returns whatever `fn`
 * returns, awaiting it when it is a promise.
 *
 * @template T
 * @param {Record<string, string | number | null | undefined>} overrides
 * @param {() => T} fn
 * @returns {T}
 */
function withEnv(overrides, fn) {
  const snapshot = { ...process.env };
  const restore = () => {
    Object.keys(process.env).forEach((key) => {
      if (!(key in snapshot)) {
        delete process.env[key];
      }
    });
    Object.assign(process.env, snapshot);
  };

  setEnv(overrides);

  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }

  if (result !== null && typeof result === 'object' && typeof result.then === 'function') {
    return result.then(
      (value) => {
        restore();
        return value;
      },
      (error) => {
        restore();
        throw error;
      },
    );
  }

  restore();
  return result;
}

/**
 * Loads a module against a fresh registry so its module-level environment reads
 * run again, optionally applying `overrides` first. `loader` is a callback that
 * performs the require, keeping require resolution in the caller's module scope
 * (e.g. `loadFreshModule(() => require('../../../config'), { LOG_LEVEL: 'warn' })`).
 * Any overrides persist until the active test ends, where jest.setup.js restores
 * the file's baseline environment.
 *
 * @template T
 * @param {() => T} loader
 * @param {Record<string, string | number | null | undefined>} [overrides]
 * @returns {T}
 */
function loadFreshModule(loader, overrides) {
  if (overrides) {
    setEnv(overrides);
  }

  let loaded;
  jest.isolateModules(() => {
    loaded = loader();
  });
  return loaded;
}

module.exports = { setEnv, withEnv, loadFreshModule };
