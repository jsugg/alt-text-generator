const {
  fetchImageAsset,
  normalizeContentType,
} = require('../../../../src/providers/shared/fetchImageAsset');

describe('Unit | Providers | Shared | Fetch Image Asset', () => {
  it('normalizes content types and preserves existing buffers', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: Buffer.from('image-bytes'),
        headers: {
          'content-type': 'image/png; charset=utf-8',
        },
      }),
    };

    const asset = await fetchImageAsset({
      httpClient,
      imageUrl: 'https://example.com/image.png',
      requestOptions: {
        timeout: 500,
        maxRedirects: 1,
        maxContentLength: 1024,
      },
    });

    expect(asset).toEqual({
      buffer: Buffer.from('image-bytes'),
      contentType: 'image/png',
      imageUrl: 'https://example.com/image.png',
    });
  });

  it('creates a buffer from non-buffer payloads and tolerates missing content type', async () => {
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        data: 'plain-text-image',
        headers: {},
      }),
    };

    const asset = await fetchImageAsset({
      httpClient,
      imageUrl: 'https://example.com/image.bin',
    });

    expect(Buffer.isBuffer(asset.buffer)).toBe(true);
    expect(asset.buffer.equals(Buffer.from('plain-text-image'))).toBe(true);
    expect(asset.contentType).toBeNull();
    expect(normalizeContentType(undefined)).toBeNull();
  });
});
