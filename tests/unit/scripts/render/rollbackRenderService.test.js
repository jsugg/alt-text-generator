const {
  parseArgs,
  selectRollbackDeploy,
  rollbackRenderService,
} = require('../../../../scripts/render/rollback-render-service');

describe('Unit | Scripts | Render | Rollback Render Service', () => {
  describe('parseArgs', () => {
    it('parses supported arguments with dry-run defaulting to true', () => {
      expect(parseArgs([
        '--service-id', 'srv-abc',
        '--reason', 'deploy regression',
      ])).toEqual({
        serviceId: 'srv-abc',
        toDeployId: null,
        reason: 'deploy regression',
        dryRun: true,
        outputFile: null,
        summaryFile: null,
      });
    });

    it('parses an explicit target deploy and real run', () => {
      const args = parseArgs([
        '--service-id', 'srv-abc',
        '--reason', 'regression',
        '--to-deploy-id', 'dep-good',
        '--dry-run', 'false',
      ]);
      expect(args.toDeployId).toBe('dep-good');
      expect(args.dryRun).toBe(false);
    });

    it('rejects non-boolean dry-run values', () => {
      expect(() => parseArgs([
        '--service-id', 'srv-abc', '--reason', 'x', '--dry-run', 'yes',
      ])).toThrow('--dry-run must be "true" or "false"');
    });

    it('requires service-id and reason', () => {
      expect(() => parseArgs(['--service-id', 'srv-abc'])).toThrow(
        '--service-id and --reason are required',
      );
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs(['--nope', 'true'])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('selectRollbackDeploy', () => {
    const deploys = [
      { id: 'dep-current', status: 'update_failed' },
      { id: 'dep-prev', status: 'deactivated' },
      { id: 'dep-older', status: 'deactivated' },
    ];

    it('auto-selects the most recent successful deploy that is not current', () => {
      expect(selectRollbackDeploy(deploys, null)).toEqual({
        target: { id: 'dep-prev', status: 'deactivated' },
        currentDeployId: 'dep-current',
      });
    });

    it('honours an explicit eligible target', () => {
      expect(selectRollbackDeploy(deploys, 'dep-older').target.id).toBe('dep-older');
    });

    it('rejects an explicit target that never served traffic', () => {
      expect(() => selectRollbackDeploy(
        [{ id: 'dep-current', status: 'update_failed' }, { id: 'dep-x', status: 'build_failed' }],
        'dep-x',
      )).toThrow('only a deploy that has served traffic');
    });

    it('rejects an unknown explicit target', () => {
      expect(() => selectRollbackDeploy(deploys, 'dep-missing')).toThrow(
        'was not found in this service',
      );
    });

    it('throws when there is no earlier successful deploy', () => {
      expect(() => selectRollbackDeploy(
        [{ id: 'dep-current', status: 'live' }],
        null,
      )).toThrow('No earlier successful deploy');
    });

    it('throws when the deploy list is empty', () => {
      expect(() => selectRollbackDeploy([], null)).toThrow('no deploys');
    });
  });

  describe('rollbackRenderService', () => {
    const listResponse = [
      { deploy: { id: 'dep-current', status: 'update_failed' } },
      { deploy: { id: 'dep-prev', status: 'deactivated', commit: { id: 'abc123' } } },
    ];

    /**
     * @param {Array<{ status: number, body: unknown }>} responses
     */
    const makeFetch = (responses) => {
      let call = 0;
      return jest.fn(async () => {
        const next = responses[Math.min(call, responses.length - 1)];
        call += 1;
        return {
          ok: next.status < 400,
          status: next.status,
          statusText: 'OK',
          text: async () => JSON.stringify(next.body),
        };
      });
    };

    it('does not call the rollback endpoint on a dry run', async () => {
      const fetchFn = makeFetch([{ status: 200, body: listResponse }]);
      const log = jest.fn();

      await rollbackRenderService(
        {
          serviceId: 'srv-abc',
          toDeployId: null,
          reason: 'regression',
          dryRun: true,
          outputFile: null,
          summaryFile: null,
        },
        { fetchFn, apiKey: 'key', log },
      );

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('DRY RUN'),
      );
    });

    it('triggers the rollback and waits for the deploy to go live', async () => {
      const fetchFn = makeFetch([
        { status: 200, body: listResponse },
        { status: 201, body: { id: 'dep-roll', status: 'update_in_progress' } },
        { status: 200, body: { id: 'dep-roll', status: 'live' } },
      ]);
      const log = jest.fn();

      await rollbackRenderService(
        {
          serviceId: 'srv-abc',
          toDeployId: 'dep-prev',
          reason: 'regression',
          dryRun: false,
          outputFile: null,
          summaryFile: null,
        },
        { fetchFn, apiKey: 'key', log },
      );

      const rollbackCall = fetchFn.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(rollbackCall).toBeDefined();
      expect(rollbackCall[0]).toContain('/services/srv-abc/rollback');
      expect(JSON.parse(rollbackCall[1].body)).toEqual({ deployId: 'dep-prev' });
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Rollback complete'));
    });

    it('throws when RENDER_API_KEY is absent', async () => {
      await expect(rollbackRenderService(
        {
          serviceId: 'srv-abc',
          toDeployId: null,
          reason: 'x',
          dryRun: true,
          outputFile: null,
          summaryFile: null,
        },
        { fetchFn: jest.fn(), apiKey: '' },
      )).rejects.toThrow('RENDER_API_KEY is not set');
    });
  });
});
