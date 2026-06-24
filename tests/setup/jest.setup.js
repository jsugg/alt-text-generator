/**
 * QE-009 shared Jest lifecycle, registered for every lane via
 * setupFilesAfterEnv.
 *
 * It snapshots the environment each test file inherits and restores it (and
 * resets Jest mock state) after every test, so a missed manual restore in one
 * test cannot contaminate another when Jest runs files in parallel. Tests that
 * need a specific environment use the helpers in tests/setup/testEnv.js; the
 * cleanup here is automatic and needs no per-file afterEach.
 */

const BASELINE_ENV = { ...process.env };

function restoreBaselineEnv() {
  Object.keys(process.env).forEach((key) => {
    if (!(key in BASELINE_ENV)) {
      delete process.env[key];
    }
  });
  Object.assign(process.env, BASELINE_ENV);
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  restoreBaselineEnv();
});
