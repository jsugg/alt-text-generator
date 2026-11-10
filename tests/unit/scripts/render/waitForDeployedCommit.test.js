const {
  evaluateHealthProbe,
  parseArgs,
  waitForDeployedCommit,
} = require('../../../../scripts/render/wait-for-deployed-commit');

const PUSHED_SHA = 'ea29c7320f0a7d2c6b8e4d1f9a3c5b7e2d4f6a8c';
const PREVIOUS_SHA = 'b5fca356c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5';
const HEALTH_URL = 'https://wcag.qcraft.com.br/api/health';

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {Response}
 */
const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

const healthBody = (fields = {}) => ({
  message: 'OK',
  ready: true,
  timestamp: 1,
  uptime: 1,
  ...fields,
});

/**
 * Builds a fake clock whose sleep advances time, so polling is deterministic.
 */
const createFakeClock = () => {
  let nowMs = 0;

  return {
    nowFn: jest.fn(() => nowMs),
    sleepFn: jest.fn(async (ms) => {
      nowMs += ms;
    }),
  };
};

/**
 * @param {Array<() => Promise<Response>>} responders - one per probe; the last repeats
 */
const sequenceFetch = (responders) => {
  const fetchFn = jest.fn(() => responders[
    Math.min(fetchFn.mock.calls.length - 1, responders.length - 1)
  ]());

  return fetchFn;
};

describe('Unit | Scripts | Render | Wait For Deployed Commit', () => {
  describe('parseArgs', () => {
    it('defaults the base URL, timeout, and interval', () => {
      expect(parseArgs(['--expected-commit', PUSHED_SHA])).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br',
        expectedCommit: PUSHED_SHA,
        timeoutMs: 900_000,
        pollIntervalMs: 15_000,
      });
    });

    it('parses explicit flags and normalizes the expected commit', () => {
      expect(parseArgs([
        '--base-url=https://staging.example.com/',
        '--expected-commit',
        ` ${PUSHED_SHA.toUpperCase()} `,
        '--timeout-seconds',
        '60',
        '--interval-seconds=5',
      ])).toEqual({
        baseUrl: 'https://staging.example.com/',
        expectedCommit: PUSHED_SHA,
        timeoutMs: 60_000,
        pollIntervalMs: 5_000,
      });
    });

    it.each([
      ['missing', []],
      ['empty', ['--expected-commit', '']],
      ['abbreviated', ['--expected-commit', 'ea29c73']],
      ['non-hex', ['--expected-commit', 'z'.repeat(40)]],
    ])('rejects a %s expected commit', (_label, argv) => {
      expect(() => parseArgs(argv)).toThrow(
        '--expected-commit must be a full 40-character commit SHA',
      );
    });

    it.each([
      ['--timeout-seconds', '0'],
      ['--timeout-seconds', '1.5'],
      ['--interval-seconds', '-3'],
      ['--interval-seconds', 'soon'],
    ])('rejects %s %s', (flag, value) => {
      expect(() => parseArgs(['--expected-commit', PUSHED_SHA, flag, value])).toThrow(
        `${flag} must be a whole number of seconds >= 1`,
      );
    });

    it('rejects unsupported flags, positional arguments, and missing values', () => {
      expect(() => parseArgs(['--nope', 'x'])).toThrow('Unsupported argument: --nope');
      expect(() => parseArgs(['positional'])).toThrow('Unexpected argument: positional');
      expect(() => parseArgs(['--base-url'])).toThrow('Missing value for --base-url');
    });
  });

  describe('evaluateHealthProbe', () => {
    it.each([
      [
        'a failed request',
        { error: new Error('fetch failed') },
        'health request failed: fetch failed',
      ],
      ['a non-200 response', { status: 502 }, 'health returned HTTP 502'],
      ['a non-JSON body', { status: 200 }, 'health returned a non-JSON body'],
      [
        'a build that predates commit reporting',
        { status: 200, jsonBody: healthBody() },
        'health payload has no commit field (build predates commit reporting)',
      ],
      [
        'a service without a reported commit',
        { status: 200, jsonBody: healthBody({ commit: null }) },
        'health reports commit null (is RENDER_GIT_COMMIT exposed to the service?)',
      ],
      [
        'the previous build',
        { status: 200, jsonBody: healthBody({ commit: PREVIOUS_SHA }) },
        `serving commit ${PREVIOUS_SHA}`,
      ],
    ])('does not match %s', (_label, probe, observation) => {
      expect(evaluateHealthProbe(probe, PUSHED_SHA)).toEqual({ matched: false, observation });
    });

    it('matches the expected commit regardless of case', () => {
      expect(evaluateHealthProbe(
        { status: 200, jsonBody: healthBody({ commit: PUSHED_SHA.toUpperCase() }) },
        PUSHED_SHA,
      )).toEqual({ matched: true, observation: `serving commit ${PUSHED_SHA.toUpperCase()}` });
    });

    it('does not trust a matching commit from an instance that is not ready', () => {
      expect(evaluateHealthProbe(
        { status: 503, jsonBody: healthBody({ ready: false, commit: PUSHED_SHA }) },
        PUSHED_SHA,
      ).matched).toBe(false);
    });
  });

  describe('waitForDeployedCommit', () => {
    it('returns after the first probe when the pushed commit is already live', async () => {
      const clock = createFakeClock();
      const fetchFn = sequenceFetch([
        async () => jsonResponse(200, healthBody({ commit: PUSHED_SHA })),
      ]);
      const log = jest.fn();

      await expect(waitForDeployedCommit({
        baseUrl: 'https://wcag.qcraft.com.br/',
        expectedCommit: PUSHED_SHA,
        timeoutMs: 900_000,
        pollIntervalMs: 15_000,
        fetchFn,
        ...clock,
        log,
      })).resolves.toBe(1);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn.mock.calls[0][0]).toBe(HEALTH_URL);
      expect(clock.sleepFn).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(`[deploy] ${HEALTH_URL} is serving ${PUSHED_SHA} (probe 1).`);
    });

    it('keeps polling through the bootstrap rollout until the new build is live', async () => {
      const clock = createFakeClock();
      const fetchFn = sequenceFetch([
        async () => jsonResponse(200, healthBody()),
        async () => {
          throw new Error('socket hang up');
        },
        async () => jsonResponse(502, { message: 'Bad Gateway' }),
        async () => jsonResponse(200, healthBody({ commit: PUSHED_SHA })),
      ]);
      const log = jest.fn();

      await expect(waitForDeployedCommit({
        baseUrl: 'https://wcag.qcraft.com.br',
        expectedCommit: PUSHED_SHA,
        timeoutMs: 900_000,
        pollIntervalMs: 15_000,
        fetchFn,
        ...clock,
        log,
      })).resolves.toBe(4);
      expect(clock.sleepFn.mock.calls.map(([ms]) => ms)).toEqual([15_000, 15_000, 15_000]);
      expect(log).toHaveBeenCalledWith(
        `[deploy] waiting for ${PUSHED_SHA} (probe 1): `
        + 'health payload has no commit field (build predates commit reporting)',
      );
      expect(log).toHaveBeenCalledWith(
        `[deploy] waiting for ${PUSHED_SHA} (probe 2): health request failed: socket hang up`,
      );
      expect(log).toHaveBeenCalledWith(
        `[deploy] waiting for ${PUSHED_SHA} (probe 3): health returned HTTP 502`,
      );
    });

    it('fails with the last observation once the timeout elapses', async () => {
      const clock = createFakeClock();
      const fetchFn = sequenceFetch([
        async () => jsonResponse(200, healthBody({ commit: PREVIOUS_SHA })),
      ]);

      await expect(waitForDeployedCommit({
        baseUrl: 'https://wcag.qcraft.com.br',
        expectedCommit: PUSHED_SHA,
        timeoutMs: 40_000,
        pollIntervalMs: 15_000,
        fetchFn,
        ...clock,
        log: jest.fn(),
      })).rejects.toThrow(
        `Timed out after 40s waiting for ${HEALTH_URL} to serve commit ${PUSHED_SHA}. `
        + `Last observation: serving commit ${PREVIOUS_SHA}. Check the Render deploy for this `
        + 'commit: it may still be building, or it failed and the previous build is live.',
      );
      // Sleeps are capped at the remaining budget, so the wait never overshoots it.
      expect(clock.sleepFn.mock.calls.map(([ms]) => ms)).toEqual([15_000, 15_000, 10_000]);
      expect(fetchFn).toHaveBeenCalledTimes(4);
    });
  });
});
