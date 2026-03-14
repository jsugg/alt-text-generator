const {
  buildProviderValidationPageHtml,
  getProviderValidationAsset,
  PROVIDER_VALIDATION_PAGE_TITLE,
} = require('../../../src/providerValidation/fixtures');

const PNG_SIGNATURE = '89504e470d0a1a0a';

describe('provider validation fixtures', () => {
  test.each(['a.png', 'b.png'])('%s is a non-trivial PNG fixture', (assetName) => {
    const asset = getProviderValidationAsset(assetName);

    expect(Buffer.isBuffer(asset)).toBe(true);
    expect(asset.length).toBeGreaterThan(512);
    expect(asset.subarray(0, 8).toString('hex')).toBe(PNG_SIGNATURE);
  });

  test('returns null for unknown assets', () => {
    expect(getProviderValidationAsset('missing.png')).toBeNull();
  });

  test('renders a fixture page with both provider validation assets', () => {
    const html = buildProviderValidationPageHtml('https://example.test');

    expect(html).toContain(PROVIDER_VALIDATION_PAGE_TITLE);
    expect(html).toContain('/provider-validation/assets/a.png');
    expect(html).toContain('https://example.test/provider-validation/assets/b.png');
  });
});
