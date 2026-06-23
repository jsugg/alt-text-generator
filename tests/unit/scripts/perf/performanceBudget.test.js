const {
  PERF_STATUS,
  evaluatePerformanceSample,
  summarizePerformanceReport,
  formatSampleLine,
} = require('../../../../scripts/perf/performanceBudget');

describe('Unit | Scripts | Performance Budget', () => {
  it('marks a within-budget sample ok and non-blocking', () => {
    const result = evaluatePerformanceSample({
      label: 'docs-steady-state',
      durationMs: 80,
      budgetMs: 150,
    });

    expect(result).toMatchObject({
      status: PERF_STATUS.OK,
      withinBudget: true,
      blocking: false,
      accepted: false,
    });
  });

  it('treats the budget boundary as within budget', () => {
    const result = evaluatePerformanceSample({
      label: 'boundary',
      durationMs: 150,
      budgetMs: 150,
    });

    expect(result.withinBudget).toBe(true);
    expect(result.status).toBe(PERF_STATUS.OK);
  });

  it('warns without blocking when a provisional budget is exceeded', () => {
    const result = evaluatePerformanceSample({
      label: 'page-fan-out',
      durationMs: 2500,
      budgetMs: 2000,
    });

    expect(result.status).toBe(PERF_STATUS.WARN);
    expect(result.blocking).toBe(false);
  });

  it('fails and blocks when an accepted budget is exceeded', () => {
    const result = evaluatePerformanceSample({
      label: 'page-fan-out',
      durationMs: 2500,
      budgetMs: 2000,
      accepted: true,
    });

    expect(result.status).toBe(PERF_STATUS.FAIL);
    expect(result.blocking).toBe(true);
  });

  it('rejects invalid samples', () => {
    expect(() => evaluatePerformanceSample({ label: '', durationMs: 1, budgetMs: 1 }))
      .toThrow('non-empty label');
    expect(() => evaluatePerformanceSample({ label: 'x', durationMs: -1, budgetMs: 1 }))
      .toThrow('non-negative durationMs');
    expect(() => evaluatePerformanceSample({ label: 'x', durationMs: 1, budgetMs: 0 }))
      .toThrow('positive budgetMs');
  });

  it('summarizes a mixed report: warnings do not fail, accepted breaches do', () => {
    const report = summarizePerformanceReport([
      { label: 'docs-steady-state', durationMs: 80, budgetMs: 150 },
      { label: 'page-fan-out', durationMs: 2500, budgetMs: 2000 },
    ]);

    expect(report.warnings).toHaveLength(1);
    expect(report.failures).toHaveLength(0);
    expect(report.ok).toBe(true);
    expect(report.blocking).toBe(false);
  });

  it('summarizes an accepted breach as blocking', () => {
    const report = summarizePerformanceReport([
      { label: 'docs-steady-state', durationMs: 80, budgetMs: 150, accepted: true },
      { label: 'page-fan-out', durationMs: 2500, budgetMs: 2000, accepted: true },
    ]);

    expect(report.failures).toHaveLength(1);
    expect(report.ok).toBe(false);
    expect(report.blocking).toBe(true);
  });

  it('formats provisional and accepted verdict lines distinctly', () => {
    const provisional = formatSampleLine(evaluatePerformanceSample({
      label: 'page-fan-out',
      durationMs: 2500.4,
      budgetMs: 2000,
    }));
    const accepted = formatSampleLine(evaluatePerformanceSample({
      label: 'docs-steady-state',
      durationMs: 80,
      budgetMs: 150,
      accepted: true,
    }));

    expect(provisional).toBe('[perf:WARN] page-fan-out: 2500.4ms / 2000ms budget (provisional)');
    expect(accepted).toBe('[perf:OK] docs-steady-state: 80.0ms / 150ms budget (accepted)');
  });
});
