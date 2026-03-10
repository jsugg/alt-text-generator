const {
  normalizeBaseUrl,
  parseArgs,
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
});
