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

    ['REPLICATE_API_TOKEN', 'TLS_KEY', 'TLS_CERT'].forEach((key) => {
      expect(envVars.get(key)).toEqual({ key, sync: false });
    });
    expect(envVars.get('NODE_ENV')).toEqual({ key: 'NODE_ENV', value: 'production' });
  });
});
