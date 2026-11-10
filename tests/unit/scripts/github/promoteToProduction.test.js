const {
  buildPromotionDeploymentPayload,
  classifyRequiredChecks,
  derivePromotionPlan,
  getCheckRuns,
  isProtectedBranchRefUpdateError,
  parseArgs,
  resolveRequiredChecks,
  resolveRunLogUrl,
  waitForRequiredChecks,
} = require('../../../../scripts/github/promote-to-production');

const REQUIRED_ARGS = [
  '--repo',
  'jsugg/alt-text-generator',
  '--source-branch',
  'main',
  '--target-branch',
  'production',
];

/**
 * @param {string} name
 * @param {string|null} conclusion
 * @param {string} [status]
 */
const run = (name, conclusion, status = conclusion === null ? 'in_progress' : 'completed') => ({
  name,
  status,
  conclusion,
});

/**
 * Builds a fake clock whose sleep advances time, so polling is deterministic.
 *
 * @param {number} [startMs]
 */
const createFakeClock = (startMs = 1_000_000) => {
  let nowMs = startMs;

  return {
    now: jest.fn(() => nowMs),
    sleep: jest.fn((ms) => {
      nowMs += ms;
    }),
    elapsedMs: () => nowMs - startMs,
  };
};

describe('Unit | Scripts | GitHub | Promote To Production', () => {
  describe('parseArgs', () => {
    it('parses supported CLI arguments including required checks', () => {
      expect(parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--source-branch',
        'main',
        '--target-branch',
        'production',
        '--required-checks',
        'actionlint, lint, newman',
        '--output-file',
        '/tmp/output.txt',
        '--summary-file',
        '/tmp/summary.md',
      ])).toEqual({
        repo: 'jsugg/alt-text-generator',
        sourceBranch: 'main',
        targetBranch: 'production',
        requiredChecks: ['actionlint', 'lint', 'newman'],
        outputFile: '/tmp/output.txt',
        summaryFile: '/tmp/summary.md',
        checksTimeoutMs: 600_000,
        checksPollIntervalMs: 20_000,
      });
    });

    it('parses the required-check wait timeout and poll interval in seconds', () => {
      expect(parseArgs([
        ...REQUIRED_ARGS,
        '--checks-timeout-seconds',
        '0',
        '--checks-poll-interval-seconds=5',
      ])).toMatchObject({
        checksTimeoutMs: 0,
        checksPollIntervalMs: 5_000,
      });
    });

    it.each([
      ['--checks-timeout-seconds', '-1', 0],
      ['--checks-timeout-seconds', '1.5', 0],
      ['--checks-timeout-seconds', 'ten', 0],
      ['--checks-poll-interval-seconds', '0', 1],
    ])('rejects %s %s', (flag, value, minimum) => {
      expect(() => parseArgs([...REQUIRED_ARGS, flag, value])).toThrow(
        `${flag} must be a whole number of seconds >= ${minimum}`,
      );
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs([
        '--repo',
        'jsugg/alt-text-generator',
        '--source-branch',
        'main',
        '--target-branch',
        'production',
        '--nope',
        'value',
      ])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('resolveRequiredChecks', () => {
    it('prefers explicitly provided required checks', () => {
      expect(resolveRequiredChecks({
        repo: 'jsugg/alt-text-generator',
        sourceBranch: 'main',
        requiredChecks: ['actionlint', 'lint'],
      })).toEqual(['actionlint', 'lint']);
    });

    it('derives required checks from live branch protection when none are provided', () => {
      jest.isolateModules(() => {
        jest.doMock('node:child_process', () => ({
          execFileSync: jest.fn((command, args) => {
            expect(command).toBe('gh');
            expect(args).toEqual([
              'api',
              'repos/jsugg/alt-text-generator/branches/main/protection',
            ]);

            return JSON.stringify({
              required_status_checks: {
                contexts: ['actionlint', 'test:ci (24)'],
              },
            });
          }),
        }));

        const promotion = require('../../../../scripts/github/promote-to-production');

        expect(promotion.resolveRequiredChecks({
          repo: 'jsugg/alt-text-generator',
          sourceBranch: 'main',
          requiredChecks: null,
        })).toEqual(['actionlint', 'test:ci (24)']);
      });

      jest.dontMock('node:child_process');
    });
  });

  describe('classifyRequiredChecks', () => {
    it('accepts successful required checks even when duplicate runs exist', () => {
      expect(classifyRequiredChecks(
        ['lint', 'newman'],
        [run('lint', 'failure'), run('lint', 'success'), run('newman', 'success')],
      )).toEqual({ failed: [], pending: [] });
    });

    it.each(['skipped', 'neutral'])('accepts a required check whose run concluded %s', (conclusion) => {
      expect(classifyRequiredChecks(
        ['lint', 'dependency-audit'],
        [run('lint', 'success'), run('dependency-audit', conclusion)],
      )).toEqual({ failed: [], pending: [] });
    });

    it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])(
      'fails a required check whose only run completed %s',
      (conclusion) => {
        expect(classifyRequiredChecks(
          ['dependency-audit'],
          [run('dependency-audit', conclusion)],
        )).toEqual({ failed: ['dependency-audit'], pending: [] });
      },
    );

    it.each(['queued', 'in_progress', 'waiting', 'requested', 'pending'])(
      'keeps a required check whose run is %s pending',
      (status) => {
        expect(classifyRequiredChecks(['codeql'], [run('codeql', null, status)])).toEqual({
          failed: [],
          pending: [`codeql (${status})`],
        });
      },
    );

    it('keeps a required check pending while it has not been reported at all', () => {
      expect(classifyRequiredChecks(['Attribution Guard'], [])).toEqual({
        failed: [],
        pending: ['Attribution Guard (not reported)'],
      });
    });

    it('keeps a failed required check pending while a re-run is still in progress', () => {
      expect(classifyRequiredChecks(
        ['codeql'],
        [run('codeql', 'failure'), run('codeql', null, 'queued')],
      )).toEqual({ failed: [], pending: ['codeql (queued)'] });
    });

    it('reports failed and pending checks together', () => {
      expect(classifyRequiredChecks(
        ['lint', 'codeql', 'newman', 'actionlint'],
        [run('lint', 'success'), run('codeql', null), run('newman', 'failure')],
      )).toEqual({
        failed: ['newman'],
        pending: ['codeql (in_progress)', 'actionlint (not reported)'],
      });
    });
  });

  describe('waitForRequiredChecks', () => {
    /**
     * @param {ReturnType<typeof createFakeClock>} clock
     * @param {Array<ReturnType<typeof run>[]>} snapshots - check runs per poll; the last repeats
     * @param {Partial<Parameters<typeof waitForRequiredChecks>[0]>} [overrides]
     */
    const waitWith = (clock, snapshots, overrides = {}) => {
      const listCheckRuns = jest.fn(() => snapshots[
        Math.min(listCheckRuns.mock.calls.length - 1, snapshots.length - 1)
      ]);
      const log = jest.fn();

      return {
        listCheckRuns,
        log,
        wait: () => waitForRequiredChecks({
          repo: 'jsugg/alt-text-generator',
          sha: 'ea29c73',
          requiredChecks: ['lint', 'codeql'],
          timeoutMs: 600_000,
          pollIntervalMs: 20_000,
          listCheckRuns,
          sleep: clock.sleep,
          now: clock.now,
          log,
          ...overrides,
        }),
      };
    };

    it('returns on the first poll without sleeping when every required check passed', () => {
      const clock = createFakeClock();
      const { listCheckRuns, wait } = waitWith(clock, [
        [run('lint', 'success'), run('codeql', 'success')],
      ]);

      expect(wait).not.toThrow();
      expect(listCheckRuns).toHaveBeenCalledTimes(1);
      expect(listCheckRuns).toHaveBeenCalledWith('jsugg/alt-text-generator', 'ea29c73');
      expect(clock.sleep).not.toHaveBeenCalled();
    });

    it('waits for an in-progress required check that later succeeds', () => {
      const clock = createFakeClock();
      const { listCheckRuns, log, wait } = waitWith(clock, [
        [run('lint', 'success'), run('codeql', null)],
        [run('lint', 'success'), run('codeql', null)],
        [run('lint', 'success'), run('codeql', 'success')],
      ]);

      expect(wait).not.toThrow();
      expect(listCheckRuns).toHaveBeenCalledTimes(3);
      expect(clock.sleep).toHaveBeenCalledTimes(2);
      expect(clock.sleep).toHaveBeenCalledWith(20_000);
      expect(log).toHaveBeenCalledWith(
        'Waiting for required checks on ea29c73: codeql (in_progress)',
      );
    });

    it('waits for a required check that has not been reported yet', () => {
      const clock = createFakeClock();
      const { wait } = waitWith(clock, [
        [run('lint', 'success')],
        [run('lint', 'success'), run('codeql', 'success')],
      ]);

      expect(wait).not.toThrow();
      expect(clock.sleep).toHaveBeenCalledTimes(1);
    });

    it('fails immediately when a required check completes without passing', () => {
      const clock = createFakeClock();
      const { listCheckRuns, wait } = waitWith(clock, [
        [run('lint', 'failure'), run('codeql', null)],
      ]);

      expect(wait).toThrow('Source commit ea29c73 is missing passing required checks: lint');
      expect(listCheckRuns).toHaveBeenCalledTimes(1);
      expect(clock.sleep).not.toHaveBeenCalled();
    });

    it('fails as soon as a pending required check completes without passing', () => {
      const clock = createFakeClock();
      const { listCheckRuns, wait } = waitWith(clock, [
        [run('lint', 'success'), run('codeql', null)],
        [run('lint', 'success'), run('codeql', 'cancelled')],
      ]);

      expect(wait).toThrow('Source commit ea29c73 is missing passing required checks: codeql');
      expect(listCheckRuns).toHaveBeenCalledTimes(2);
    });

    it('fails with the still-pending checks once the timeout elapses', () => {
      const clock = createFakeClock();
      const { listCheckRuns, wait } = waitWith(clock, [
        [run('lint', 'success'), run('codeql', null, 'queued')],
      ], { requiredChecks: ['lint', 'codeql', 'Attribution Guard'], timeoutMs: 50_000 });

      expect(wait).toThrow(
        'Timed out after 50s waiting for required checks on source commit ea29c73; '
        + 'still pending: codeql (queued), Attribution Guard (not reported)',
      );
      // Sleeps are capped at the remaining budget, so the wait never overshoots it.
      expect(clock.sleep.mock.calls.map(([ms]) => ms)).toEqual([20_000, 20_000, 10_000]);
      expect(clock.elapsedMs()).toBe(50_000);
      expect(listCheckRuns).toHaveBeenCalledTimes(4);
    });

    it('checks exactly once when the timeout is zero', () => {
      const clock = createFakeClock();
      const { listCheckRuns, wait } = waitWith(clock, [
        [run('lint', 'success'), run('codeql', null)],
      ], { timeoutMs: 0 });

      expect(wait).toThrow('Timed out after 0s');
      expect(listCheckRuns).toHaveBeenCalledTimes(1);
      expect(clock.sleep).not.toHaveBeenCalled();
    });
  });

  describe('getCheckRuns', () => {
    /**
     * @param {{ name: string, status: string, conclusion: string }[]} runs
     * @returns {jest.Mock}
     */
    const pagedApi = (runs) => jest.fn((args) => {
      const [, endpoint] = args;
      const query = new URLSearchParams(endpoint.split('?')[1]);
      const perPage = Number(query.get('per_page'));
      const page = Number(query.get('page'));

      return {
        total_count: runs.length,
        check_runs: runs.slice((page - 1) * perPage, page * perPage),
      };
    });
    const runsNamed = (count) => Array.from(
      { length: count },
      (_, index) => run(`check-${index}`, 'success'),
    );

    it('pages through more than one page of check runs', () => {
      const runs = [...runsNamed(129), run('Attribution Guard', 'success')];
      const api = pagedApi(runs);

      const collected = getCheckRuns('jsugg/alt-text-generator', 'abc123', api);

      expect(collected).toHaveLength(130);
      expect(api).toHaveBeenCalledTimes(2);
      expect(api).toHaveBeenNthCalledWith(1, [
        'api',
        'repos/jsugg/alt-text-generator/commits/abc123/check-runs?per_page=100&page=1',
      ]);
      expect(api).toHaveBeenNthCalledWith(2, [
        'api',
        'repos/jsugg/alt-text-generator/commits/abc123/check-runs?per_page=100&page=2',
      ]);
      // The required check lives only on the second page.
      expect(classifyRequiredChecks(['Attribution Guard'], collected))
        .toEqual({ failed: [], pending: [] });
    });

    it('stops after an exactly full final page when total_count is reached', () => {
      const api = pagedApi(runsNamed(100));

      expect(getCheckRuns('jsugg/alt-text-generator', 'abc123', api)).toHaveLength(100);
      expect(api).toHaveBeenCalledTimes(1);
    });

    it('returns an empty list when the commit has no check runs', () => {
      const api = jest.fn(() => ({ total_count: 0, check_runs: [] }));

      expect(getCheckRuns('jsugg/alt-text-generator', 'abc123', api)).toEqual([]);
      expect(api).toHaveBeenCalledTimes(1);
    });
  });

  describe('derivePromotionPlan', () => {
    it('returns no-op when both branches already share the same tip SHA', () => {
      expect(derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceAheadBy: 0,
        targetAheadBy: 0,
        targetBranch: 'production',
        targetSha: 'abc123',
      })).toEqual({
        force: false,
        mode: 'already-aligned',
        needsUpdate: false,
        reason: 'production already points to main@abc123.',
      });
    });

    it('uses a fast-forward update when target has no unique commits', () => {
      expect(derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceAheadBy: 2,
        targetAheadBy: 0,
        targetBranch: 'production',
        targetSha: 'def456',
      })).toEqual({
        force: false,
        mode: 'fast-forward',
        needsUpdate: true,
        reason: 'Advancing production to main@abc123.',
      });
    });

    it('uses a force realignment when only branch-only history differs', () => {
      expect(derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceAheadBy: 0,
        targetAheadBy: 4,
        targetBranch: 'production',
        targetSha: 'def456',
      })).toEqual({
        force: true,
        mode: 'history-realignment',
        needsUpdate: true,
        reason: 'production contains branch-only history. Resetting it to main@abc123 keeps both branches on the exact same commit.',
      });
    });

    it('realigns when both branches diverge but production must track main exactly', () => {
      expect(derivePromotionPlan({
        sourceBranch: 'main',
        sourceSha: 'abc123',
        sourceAheadBy: 3,
        targetAheadBy: 1,
        targetBranch: 'production',
        targetSha: 'def456',
      })).toEqual({
        force: true,
        mode: 'history-realignment',
        needsUpdate: true,
        reason: 'production contains branch-only history. Resetting it to main@abc123 keeps both branches on the exact same commit.',
      });
    });
  });

  describe('deployment evidence', () => {
    it('records how the promotion happened in the deployment payload', () => {
      expect(buildPromotionDeploymentPayload({
        plan: { mode: 'fast-forward' },
        requiredChecks: ['actionlint', 'test:ci (24)'],
        sourceBranch: 'main',
        sourceSha: 'abc123',
        targetShaBefore: 'def456',
      })).toEqual({
        promotion_mode: 'fast-forward',
        required_checks: ['actionlint', 'test:ci (24)'],
        source_branch: 'main',
        source_sha: 'abc123',
        target_sha_before: 'def456',
      });
    });

    it('resolves the Actions run log URL only when the env is complete', () => {
      expect(resolveRunLogUrl({
        GITHUB_REPOSITORY: 'jsugg/alt-text-generator',
        GITHUB_RUN_ID: '7',
        GITHUB_SERVER_URL: 'https://github.com',
      })).toBe('https://github.com/jsugg/alt-text-generator/actions/runs/7');
      expect(resolveRunLogUrl({})).toBeNull();
    });

    it('creates the production deployment and marks it in progress through gh', () => {
      jest.isolateModules(() => {
        const calls = [];

        jest.doMock('node:child_process', () => ({
          execFileSync: jest.fn((command, args, options) => {
            calls.push({ args, input: options.input ? JSON.parse(options.input) : null });

            return calls.length === 1 ? '{"id": 42}' : '{"state": "in_progress"}';
          }),
        }));

        const promotion = require('../../../../scripts/github/promote-to-production');
        const deploymentId = promotion.recordPromotionDeployment({
          repo: 'jsugg/alt-text-generator',
          plan: { mode: 'fast-forward' },
          requiredChecks: ['actionlint'],
          sourceBranch: 'main',
          sourceSha: 'abc123def',
          targetBranch: 'production',
          targetShaBefore: 'def456',
        });

        expect(deploymentId).toBe(42);
        expect(calls[0].args).toEqual([
          'api', '--method', 'POST',
          'repos/jsugg/alt-text-generator/deployments',
          '--input', '-',
        ]);
        expect(calls[0].input).toMatchObject({
          ref: 'abc123def',
          environment: 'production',
          auto_merge: false,
          required_contexts: [],
          payload: { promotion_mode: 'fast-forward', target_sha_before: 'def456' },
        });
        expect(calls[1].args).toEqual([
          'api', '--method', 'POST',
          'repos/jsugg/alt-text-generator/deployments/42/statuses',
          '--input', '-',
        ]);
        expect(calls[1].input).toMatchObject({ state: 'in_progress' });
      });

      jest.dontMock('node:child_process');
    });

    it('degrades deployment evidence failures to a null id without throwing', () => {
      jest.isolateModules(() => {
        jest.doMock('node:child_process', () => ({
          execFileSync: jest.fn(() => {
            throw new Error('gh: Not Found (HTTP 404)');
          }),
        }));

        const promotion = require('../../../../scripts/github/promote-to-production');

        expect(promotion.recordPromotionDeployment({
          repo: 'jsugg/alt-text-generator',
          plan: { mode: 'fast-forward' },
          requiredChecks: [],
          sourceBranch: 'main',
          sourceSha: 'abc123',
          targetBranch: 'production',
          targetShaBefore: 'def456',
        })).toBeNull();
      });

      jest.dontMock('node:child_process');
    });
  });

  describe('isProtectedBranchRefUpdateError', () => {
    it('recognizes protected-branch ref update rejections', () => {
      expect(isProtectedBranchRefUpdateError(
        new Error('gh: Changes must be made through a pull request. Cannot force-push to this branch (HTTP 422)'),
      )).toBe(true);
    });

    it('ignores unrelated GitHub API failures', () => {
      expect(isProtectedBranchRefUpdateError(
        new Error('gh: Not Found (HTTP 404)'),
      )).toBe(false);
    });
  });
});
