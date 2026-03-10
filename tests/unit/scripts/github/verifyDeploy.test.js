const {
  assertAzureDescriptionPayload,
  assertHealthPayload,
  assertScraperPayload,
  assertSwaggerServerUrl,
  extractServerUrls,
  normalizeBaseUrl,
  parseArgs,
} = require('../../../../scripts/github/verify-deploy');

describe('scripts/github/verify-deploy', () => {
  describe('parseArgs', () => {
    it('parses the supported CLI arguments', () => {
      expect(parseArgs([
        '--base-url',
        'https://wcag.qcraft.com.br/',
        '--event',
        'push',
        '--summary-file',
        '/tmp/summary.md',
      ])).toEqual({
        baseUrl: 'https://wcag.qcraft.com.br/',
        event: 'push',
        summaryFile: '/tmp/summary.md',
      });
    });

    it('rejects unsupported flags', () => {
      expect(() => parseArgs(['--nope', 'value'])).toThrow('Unsupported argument: --nope');
    });
  });

  describe('normalizeBaseUrl', () => {
    it('strips a trailing slash from the base URL', () => {
      expect(normalizeBaseUrl('https://wcag.qcraft.com.br/')).toBe('https://wcag.qcraft.com.br');
    });
  });

  describe('extractServerUrls', () => {
    it('extracts server URLs from a pretty-printed swagger-ui-init payload', () => {
      const swaggerUiInit = `
        window.onload = function() {
          var options = {
            "swaggerDoc": {
              "servers": [
                {
                  "url": "https://wcag.qcraft.com.br",
                  "description": "Production server"
                }
              ],
              "paths": {}
            },
            "customOptions": {}
          };
        };
      `;

      expect(extractServerUrls(swaggerUiInit)).toEqual(['https://wcag.qcraft.com.br']);
    });

    it('throws when the servers block is missing', () => {
      expect(() => extractServerUrls('window.onload = function() {};')).toThrow(
        'Unable to locate Swagger servers block',
      );
    });
  });

  describe('payload assertions', () => {
    it('accepts the expected health payload', () => {
      expect(() => assertHealthPayload({ message: 'OK' })).not.toThrow();
    });

    it('rejects an unexpected health payload', () => {
      expect(() => assertHealthPayload({ message: 'NOPE' })).toThrow(
        'Expected health payload to include message "OK"',
      );
    });

    it('accepts the expected scraper payload', () => {
      expect(() => assertScraperPayload({ imageSources: [] })).not.toThrow();
    });

    it('accepts the expected Azure description payload', () => {
      expect(() => assertAzureDescriptionPayload([{ description: 'icon' }])).not.toThrow();
    });

    it('rejects an invalid Azure description payload', () => {
      expect(() => assertAzureDescriptionPayload([{ description: '' }])).toThrow(
        'Expected Azure description payload to include a non-empty description',
      );
    });

    it('rejects a Swagger payload that does not include the expected server URL', () => {
      const swaggerUiInit = `
        "servers": [
          {
            "url": "https://localhost:8443"
          }
        ],
        "paths": {}
      `;

      expect(() => assertSwaggerServerUrl(swaggerUiInit, 'https://wcag.qcraft.com.br')).toThrow(
        'Expected Swagger UI config to include server URL https://wcag.qcraft.com.br',
      );
    });
  });
});
