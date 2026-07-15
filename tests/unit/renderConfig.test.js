const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const RENDER_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'render.yaml');

describe('Unit | Render Deploy Config', () => {
  const config = yaml.load(fs.readFileSync(RENDER_CONFIG_PATH, 'utf8'));
  const [service] = config.services;

  it('deploys the production branch web service', () => {
    expect(config.services).toHaveLength(1);
    expect(service.type).toBe('web');
    expect(service.runtime).toBe('node');
    expect(service.branch).toBe('production');
    expect(service.healthCheckPath).toBe('/api/health');
    expect(service.startCommand).toBe('npm run prod');
  });

  it('builds lockfile-exact so production installs are reproducible', () => {
    expect(service.buildCommand).toBe('npm ci');
  });

  it('keeps secret-bearing environment variables unsynced from the repo', () => {
    const envVars = new Map(service.envVars.map((entry) => [entry.key, entry]));

    expect(envVars.get('REPLICATE_API_TOKEN')).toEqual({
      key: 'REPLICATE_API_TOKEN',
      sync: false,
    });
    expect(envVars.get('NODE_ENV')).toEqual({ key: 'NODE_ENV', value: 'production' });
  });

  it('declares the edge-termination TLS posture as a string', () => {
    const envVars = new Map(service.envVars.map((entry) => [entry.key, entry]));

    // config/index.js keys off `TLS_ENABLED !== 'false'`, so the value has to be
    // the string "false" — bare `false` is a YAML boolean and would not match.
    expect(envVars.get('TLS_ENABLED')).toEqual({ key: 'TLS_ENABLED', value: 'false' });
  });

  it('does not declare TLS credentials the service never reads', () => {
    const declaredKeys = service.envVars.map((entry) => entry.key);

    // TLS terminates at the edge, so the app skips certificate loading entirely
    // and the validator no longer requires the credentials to boot. Re-declaring
    // them here would reintroduce the belief that production depends on them.
    expect(declaredKeys).not.toContain('TLS_KEY');
    expect(declaredKeys).not.toContain('TLS_CERT');

    // TLS_PORT is inert while TLS is off, and the file and the live service
    // disagreed on its value for as long as it was declared.
    expect(declaredKeys).not.toContain('TLS_PORT');
  });
});
