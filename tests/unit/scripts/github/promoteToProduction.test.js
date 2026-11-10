const {
  buildPromotionDeploymentPayload,
  derivePromotionPlan,
  ensureRequiredChecksGreen,
  getCheckRuns,
  isProtectedBranchRefUpdateError,
  parseArgs,
  resolveRequiredChecks,
  resolveRunLogUrl,
} = require('../../../../scripts/github/promote-to-production');

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
      });
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

  describe('ensureRequiredChecksGreen', () => {
    it('accepts successful required checks even when duplicate runs exist', () => {
      expect(() => ensureRequiredChecksGreen(
        'abc123',
        ['lint', 'newman'],
        [
          { name: 'lint', conclusion: 'failure' },
          { name: 'lint', conclusion: 'success' },
          { name: 'newman', conclusion: 'success' },
        ],
      )).not.toThrow();
    });

    it('throws when a required check is missing success', () => {
      expect(() => ensureRequiredChecksGreen(
        'abc123',
        ['lint', 'newman'],
        [
          { name: 'lint', conclusion: 'success' },
          { name: 'newman', conclusion: 'failure' },
        ],
      )).toThrow(
        'Source commit abc123 is missing passing required checks: newman',
      );
    });

    it.each(['skipped', 'neutral'])('accepts a required check whose run concluded %s', (conclusion) => {
      expect(() => ensureRequiredChecksGreen(
        'abc123',
        ['lint', 'dependency-audit'],
        [
          { name: 'lint', conclusion: 'success' },
          { name: 'dependency-audit', conclusion },
        ],
      )).not.toThrow();
    });

    it.each(['failure', 'cancelled', 'timed_out', 'action_required', null])(
      'rejects a required check whose only run concluded %s',
      (conclusion) => {
        expect(() => ensureRequiredChecksGreen(
          'abc123',
          ['dependency-audit'],
          [{ name: 'dependency-audit', conclusion }],
        )).toThrow('Source commit abc123 is missing passing required checks: dependency-audit');
      },
    );

    it('rejects a required check with no run at all', () => {
      expect(() => ensureRequiredChecksGreen('abc123', ['Attribution Guard'], []))
        .toThrow('missing passing required checks: Attribution Guard');
    });
  });

  describe('getCheckRuns', () => {
    /**
     * @param {{ name: string, conclusion: string }[]} runs
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
    const runsNamed = (count) => Array.from({ length: count }, (_, index) => ({
      name: `check-${index}`,
      conclusion: 'success',
    }));

    it('pages through more than one page of check runs', () => {
      const runs = [...runsNamed(129), { name: 'Attribution Guard', conclusion: 'success' }];
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
      expect(() => ensureRequiredChecksGreen('abc123', ['Attribution Guard'], collected))
        .not.toThrow();
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
