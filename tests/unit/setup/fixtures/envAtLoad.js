// Fixture for loadFreshModule isolation: captures an env var at module-load
// time. Re-requiring it yields the cached value unless a fresh module registry
// re-evaluates this file, which is exactly what loadFreshModule must do.
module.exports = process.env.QE009_FRESH;
