const {
  buildDeployEnvVars,
  normalizeBooleanFlag,
  normalizeBaseUrl,
  parseArgs,
  resolveProductionDeployAuthConfig,
} = require('../../../scripts/run-postman-deploy');

describe('scripts/run-postman-deploy', () => {
  describe('parseArgs', () => {
    it('uses the production base URL by default', () => {
      expect(parseArgs([])).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br',
      });
    });

    it('parses the supported base-url flag', () => {
      expect(parseArgs(['--base-url', 'https://wcag.qcraft.com.br/preview'])).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br/preview',
      });
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs(['--nope', 'value'])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('normalizeBaseUrl', () => {
    it('strips trailing slashes from the base URL', () => {
      expect(normalizeBaseUrl('https://wcag.qcraft.com.br/')).toBe('https://wcag.qcraft.com.br');
    });
  });

  describe('buildDeployEnvVars', () => {
    it('targets the hosted api-docs page for deploy scraper verification', () => {
      expect(buildDeployEnvVars('https://wcag.qcraft.com.br', {
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: 'deploy-token',
      })).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br',
        deployScrapePageUrl: 'https://wcag.qcraft.com.br/api-docs/',
        deployValidationApiToken: 'deploy-token',
        expectedSwaggerServerUrl: 'https://wcag.qcraft.com.br',
        productionApiAuthEnabled: 'true',
      });
    });
  });

  describe('normalizeBooleanFlag', () => {
    it('defaults empty values to false', () => {
      expect(normalizeBooleanFlag(undefined)).toBe('false');
      expect(normalizeBooleanFlag('')).toBe('false');
    });

    it('accepts true and false', () => {
      expect(normalizeBooleanFlag('true')).toBe('true');
      expect(normalizeBooleanFlag('false')).toBe('false');
    });

    it('rejects unsupported values', () => {
      expect(() => normalizeBooleanFlag('auto', { label: 'PRODUCTION_API_AUTH_ENABLED' })).toThrow(
        'PRODUCTION_API_AUTH_ENABLED must be either "true" or "false"',
      );
    });
  });

  describe('resolveProductionDeployAuthConfig', () => {
    it('skips protected deploy verification when auth is enabled without a token', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'true',
      })).toEqual({
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: '',
        protectedVerificationEnabled: false,
        protectedVerificationSkipReason: 'Skipping 96 Deploy Protected Verification because '
          + 'PRODUCTION_API_AUTH_ENABLED=true but PRODUCTION_DEPLOY_VALIDATION_API_TOKEN is not set. '
          + 'Protected deploy checks require Render API_AUTH_ENABLED=true and API_AUTH_TOKENS '
          + 'to include the same token.',
      });
    });

    it('runs protected deploy verification when auth is enabled with a token', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'true',
        PRODUCTION_DEPLOY_VALIDATION_API_TOKEN: ' deploy-token ',
      })).toEqual({
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: 'deploy-token',
        protectedVerificationEnabled: true,
        protectedVerificationSkipReason: null,
      });
    });

    it('treats blank deploy validation tokens as missing when auth is enabled', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'true',
        PRODUCTION_DEPLOY_VALIDATION_API_TOKEN: '   ',
      })).toEqual({
        productionApiAuthEnabled: 'true',
        deployValidationApiToken: '',
        protectedVerificationEnabled: false,
        protectedVerificationSkipReason: 'Skipping 96 Deploy Protected Verification because '
          + 'PRODUCTION_API_AUTH_ENABLED=true but PRODUCTION_DEPLOY_VALIDATION_API_TOKEN is not set. '
          + 'Protected deploy checks require Render API_AUTH_ENABLED=true and API_AUTH_TOKENS '
          + 'to include the same token.',
      });
    });

    it('runs protected deploy verification without a token when auth is disabled', () => {
      expect(resolveProductionDeployAuthConfig({
        PRODUCTION_API_AUTH_ENABLED: 'false',
      })).toEqual({
        productionApiAuthEnabled: 'false',
        deployValidationApiToken: '',
        protectedVerificationEnabled: true,
        protectedVerificationSkipReason: null,
      });
    });
  });
});
