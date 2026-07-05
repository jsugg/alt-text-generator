// QE-016 / ATG-QE-03A: performance-budget evaluation for the warning-only perf
// smoke. Route budgets are PROVISIONAL until a human explicitly accepts them, so
// an over-budget sample only WARNS (non-blocking). Once a budget is accepted, an
// over-budget sample FAILS (blocking) and the smoke can gate. This keeps latency
// signal visible without turning noisy, environment-sensitive numbers into a red
// build before the team agrees on the thresholds.

const PERF_STATUS = Object.freeze({
  OK: 'ok',
  WARN: 'warn',
  FAIL: 'fail',
});

/**
 * @typedef {object} PerformanceSample
 * @property {string} label - route/scenario name
 * @property {number} durationMs - observed latency
 * @property {number} budgetMs - target latency
 * @property {boolean} [accepted] - whether the budget is an accepted gate
 */

/**
 * @typedef {{label: string, durationMs: number, budgetMs: number, accepted: boolean, withinBudget: boolean, status: string, blocking: boolean}} EvaluatedSample
 */

/**
 * Evaluate a single latency sample against a (possibly provisional) budget.
 *
 * @param {PerformanceSample} sample
 * @returns {EvaluatedSample}
 */
const evaluatePerformanceSample = ({
  label,
  durationMs,
  budgetMs,
  accepted = false,
}) => {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new Error('Performance sample requires a non-empty label');
  }

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error(`Performance sample "${label}" requires a non-negative durationMs`);
  }

  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error(`Performance sample "${label}" requires a positive budgetMs`);
  }

  const withinBudget = durationMs <= budgetMs;
  const resolveStatus = () => {
    if (withinBudget) {
      return PERF_STATUS.OK;
    }

    return accepted ? PERF_STATUS.FAIL : PERF_STATUS.WARN;
  };
  const status = resolveStatus();

  return {
    label,
    durationMs,
    budgetMs,
    accepted: Boolean(accepted),
    withinBudget,
    status,
    blocking: status === PERF_STATUS.FAIL,
  };
};

/**
 * Evaluate many samples and summarize. Warnings never fail the run; only an
 * over-budget ACCEPTED budget is blocking.
 *
 * @param {PerformanceSample[]} samples
 * @returns {{results: EvaluatedSample[], warnings: EvaluatedSample[], failures: EvaluatedSample[], ok: boolean, blocking: boolean}}
 */
const summarizePerformanceReport = (samples) => {
  if (!Array.isArray(samples)) {
    throw new Error('summarizePerformanceReport requires an array of samples');
  }

  const results = samples.map(evaluatePerformanceSample);
  const warnings = results.filter((result) => result.status === PERF_STATUS.WARN);
  const failures = results.filter((result) => result.status === PERF_STATUS.FAIL);

  return {
    results,
    warnings,
    failures,
    ok: failures.length === 0,
    blocking: failures.length > 0,
  };
};

/**
 * Human-readable one-line summary for a single evaluated sample.
 *
 * @param {EvaluatedSample} result - an evaluatePerformanceSample result
 * @returns {string}
 */
const formatSampleLine = (result) => {
  const verdict = result.status.toUpperCase();
  const budgetKind = result.accepted ? 'accepted' : 'provisional';

  return `[perf:${verdict}] ${result.label}: `
    + `${result.durationMs.toFixed(1)}ms / ${result.budgetMs}ms budget (${budgetKind})`;
};

module.exports = {
  PERF_STATUS,
  evaluatePerformanceSample,
  summarizePerformanceReport,
  formatSampleLine,
};
