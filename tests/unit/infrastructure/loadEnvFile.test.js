const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadEnvFile } = require('../../../src/infrastructure/loadEnvFile');

const MODULE_PATH = path.resolve(__dirname, '../../../src/infrastructure/loadEnvFile.js');

describe('Unit | Infrastructure | Load Env File', () => {
  it('fills unset variables from .env by default', () => {
    const configure = jest.fn(() => ({ parsed: {} }));

    loadEnvFile({}, configure);

    expect(configure).toHaveBeenCalledWith({ path: '.env', override: false, quiet: true });
  });

  it('lets an explicit ENV_FILE override the inherited environment', () => {
    const configure = jest.fn(() => ({ parsed: {} }));

    loadEnvFile({ ENV_FILE: '.env.test' }, configure);

    expect(configure).toHaveBeenCalledWith({ path: '.env.test', override: true, quiet: true });
  });

  describe('with the real dotenv', () => {
    /** @type {string} */
    let dir;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-file-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    /**
     * Runs the loader in a fresh process so dotenv's banner, if any, is observable.
     *
     * @param {Record<string, string>} extraEnv
     */
    const runLoader = (extraEnv) => spawnSync(process.execPath, ['-e', [
      `require(${JSON.stringify(MODULE_PATH)}).loadEnvFile();`,
      'process.stdout.write(JSON.stringify({ value: process.env.LOAD_ENV_FILE_PROBE ?? null }));',
    ].join('\n')], {
      cwd: dir,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ...extraEnv },
    });

    it('loads the file and prints nothing besides the caller output', () => {
      const envFile = path.join(dir, 'custom.env');
      fs.writeFileSync(envFile, 'LOAD_ENV_FILE_PROBE=from-file\n');

      const result = runLoader({ ENV_FILE: envFile, LOAD_ENV_FILE_PROBE: 'inherited' });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({ value: 'from-file' });
    });

    it('keeps inherited values when only the default .env exists', () => {
      fs.writeFileSync(path.join(dir, '.env'), 'LOAD_ENV_FILE_PROBE=from-dotenv\n');

      const result = runLoader({ LOAD_ENV_FILE_PROBE: 'inherited' });

      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({ value: 'inherited' });
    });

    it('stays silent when no env file exists, as on Render', () => {
      const result = runLoader({});

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual({ value: null });
    });
  });
});
