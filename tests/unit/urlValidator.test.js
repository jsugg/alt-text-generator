const { isValidUrl } = require('../../src/utils/urlValidator');

describe('isValidUrl', () => {
  it('returns true for a valid http URL', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  it('returns true for a valid https URL', () => {
    expect(isValidUrl('https://example.com/path?q=1')).toBe(true);
  });

  it('returns false for a plain string', () => {
    expect(isValidUrl('not a url')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isValidUrl(undefined)).toBe(false);
  });

  it('returns false for a relative path', () => {
    expect(isValidUrl('/relative/path')).toBe(false);
  });
});
