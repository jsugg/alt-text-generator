const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_PROVIDER_OVERRIDES_FILE,
  loadProviderOverrides,
  resolveProviderOverridesFile,
} = require('../../../config/providerOverrides');

describe('Unit | Config | Provider Overrides', () => {
  it('uses the default provider override file path when no env override is set', () => {
    expect(resolveProviderOverridesFile({})).toBe(DEFAULT_PROVIDER_OVERRIDES_FILE);
  });

  it('returns an empty provider map when the override file is missing', () => {
    expect(loadProviderOverrides({
      PROVIDER_OVERRIDES_FILE: path.join(__dirname, '../../fixtures/provider-overrides.missing.yaml'),
    })).toEqual({
      filePath: path.join(__dirname, '../../fixtures/provider-overrides.missing.yaml'),
      providers: {},
    });
  });

  it('parses provider override states from yaml', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-overrides-config-'));
    const providerOverridesFile = path.join(tempDir, 'providers.yaml');
    fs.writeFileSync(providerOverridesFile, [
      'providers:',
      '  azure:',
      '    enabled: false',
      '  openai:',
      '    enabled: auto',
      '  replicate:',
      '    enabled: true',
      '',
    ].join('\n'));

    expect(loadProviderOverrides({
      PROVIDER_OVERRIDES_FILE: providerOverridesFile,
    })).toEqual({
      filePath: providerOverridesFile,
      providers: {
        azure: { enabled: false },
        openai: { enabled: 'auto' },
        replicate: { enabled: true },
      },
    });
  });
});
