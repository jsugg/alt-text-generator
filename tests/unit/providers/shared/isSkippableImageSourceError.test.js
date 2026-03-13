const {
  isSkippableImageSourceError,
} = require('../../../../src/providers/shared/isSkippableImageSourceError');

describe('Unit | Providers | Shared | Is Skippable Image Source Error', () => {
  it('returns false for provider-endpoint failures', () => {
    const error = new Error('provider failure');
    error.response = { status: 404 };
    error.config = {
      url: 'https://api.example.com/v1/chat/completions',
    };

    expect(isSkippableImageSourceError(error, 'https://api.example.com/v1')).toBe(false);
  });

  it('returns true for isolated image download failures', () => {
    const error = new Error('image missing');
    error.response = { status: 404 };
    error.config = {
      url: 'https://example.com/image.png',
    };

    expect(isSkippableImageSourceError(error, 'https://api.example.com/v1')).toBe(true);
  });

  it('returns false for unrelated failures', () => {
    const error = new Error('provider busy');
    error.response = { status: 500 };
    error.config = {
      url: 'https://example.com/image.png',
    };

    expect(isSkippableImageSourceError(error, 'https://api.example.com/v1')).toBe(false);
  });
});
