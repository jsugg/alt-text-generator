const { setEnv, withEnv, loadFreshModule } = require('../../setup/testEnv');

describe('Unit | Test Setup | testEnv helpers', () => {
  describe('setEnv', () => {
    it('sets string values and coerces numbers to strings', () => {
      setEnv({ QE009_A: 'x', QE009_B: 7 });

      expect(process.env.QE009_A).toBe('x');
      expect(process.env.QE009_B).toBe('7');
    });

    it('deletes keys given null or undefined', () => {
      process.env.QE009_DELME = 'present';

      setEnv({ QE009_DELME: undefined });

      expect('QE009_DELME' in process.env).toBe(false);
    });
  });

  describe('withEnv', () => {
    it('applies overrides for the callback then restores the prior environment', () => {
      process.env.QE009_KEEP = 'original';

      const seen = withEnv({ QE009_KEEP: 'temp', QE009_NEW: 'added' }, () => ({
        keep: process.env.QE009_KEEP,
        added: process.env.QE009_NEW,
      }));

      expect(seen).toEqual({ keep: 'temp', added: 'added' });
      expect(process.env.QE009_KEEP).toBe('original');
      expect('QE009_NEW' in process.env).toBe(false);
    });

    it('restores the environment even when the callback throws', () => {
      process.env.QE009_KEEP = 'original';

      expect(() => withEnv({ QE009_KEEP: 'temp' }, () => {
        throw new Error('boom');
      })).toThrow('boom');

      expect(process.env.QE009_KEEP).toBe('original');
    });

    it('awaits and restores after an async callback', async () => {
      delete process.env.QE009_ASYNC;

      const result = await withEnv({ QE009_ASYNC: 'on' }, async () => {
        expect(process.env.QE009_ASYNC).toBe('on');
        return 'done';
      });

      expect(result).toBe('done');
      expect('QE009_ASYNC' in process.env).toBe(false);
    });
  });

  describe('loadFreshModule', () => {
    it('applies overrides before invoking the loader', () => {
      delete process.env.QE009_FRESH;

      const seen = loadFreshModule(() => process.env.QE009_FRESH, { QE009_FRESH: 'ready' });

      expect(seen).toBe('ready');
    });

    it('re-evaluates module-level reads on each load via a fresh registry', () => {
      const first = loadFreshModule(() => require('./fixtures/envAtLoad'), { QE009_FRESH: 'first' });
      const second = loadFreshModule(() => require('./fixtures/envAtLoad'), { QE009_FRESH: 'second' });

      expect(first).toBe('first');
      expect(second).toBe('second');
    });
  });
});
