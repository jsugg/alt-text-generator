const ScraperService = require('../../../src/services/ScraperService');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const makeService = (httpClientOverride) => new ScraperService({
  logger: mockLogger,
  httpClient: httpClientOverride || { get: jest.fn() },
});

describe('ScraperService.isImage', () => {
  const svc = makeService();

  it.each([
    ['https://example.com/photo.jpg', true],
    ['https://example.com/photo.jpeg', true],
    ['https://example.com/photo.png', true],
    ['https://example.com/photo.gif', true],
    ['https://example.com/photo.webp', true],
    ['https://example.com/photo.svg', true],
    ['https://example.com/photo.bmp', true],
    ['https://example.com/photo.jpg?v=123', true],
    ['https://example.com/page.html', false],
    ['https://example.com/script.js', false],
    ['https://example.com/noextension', false],
    ['', false],
  ])('isImage(%s) === %s', (url, expected) => {
    expect(svc.isImage(url)).toBe(expected);
  });
});

describe('ScraperService.extractImageSources', () => {
  const svc = makeService();

  it('extracts absolute image src attributes', () => {
    const html = `<html><body>
      <img src="https://example.com/a.jpg">
      <img src="https://example.com/b.png">
    </body></html>`;
    const result = svc.extractImageSources(html, 'https://example.com');
    expect(result.imageSources).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.png',
    ]);
  });

  it('resolves relative image paths to absolute URLs', () => {
    const html = '<html><body><img src="/images/photo.jpg"></body></html>';
    const result = svc.extractImageSources(html, 'https://example.com');
    expect(result.imageSources).toContain('https://example.com/images/photo.jpg');
  });

  it('prefers data-src over src for lazy-loaded images', () => {
    const html = '<html><body><img data-src="https://cdn.example.com/lazy.jpg" src="placeholder.gif"></body></html>';
    const result = svc.extractImageSources(html, 'https://example.com');
    expect(result.imageSources).toContain('https://cdn.example.com/lazy.jpg');
  });

  it('strips query strings from image URLs', () => {
    const html = '<html><body><img src="https://example.com/photo.jpg?size=large"></body></html>';
    const result = svc.extractImageSources(html, 'https://example.com');
    expect(result.imageSources).toContain('https://example.com/photo.jpg');
  });

  it('returns empty array when no images found', () => {
    const html = '<html><body><p>No images here</p></body></html>';
    const result = svc.extractImageSources(html, 'https://example.com');
    expect(result.imageSources).toEqual([]);
  });
});

describe('ScraperService.getImages', () => {
  it('returns image sources on success', async () => {
    const html = '<html><body><img src="https://example.com/photo.jpg"></body></html>';
    const mockHttpClient = { get: jest.fn().mockResolvedValue({ data: html }) };
    const svc = makeService(mockHttpClient);

    const result = await svc.getImages('https://example.com');
    expect(result.imageSources).toContain('https://example.com/photo.jpg');
  });

  it('throws when the HTTP client rejects', async () => {
    const mockHttpClient = { get: jest.fn().mockRejectedValue(new Error('Network error')) };
    const svc = makeService(mockHttpClient);

    await expect(svc.getImages('https://example.com')).rejects.toThrow('Network error');
  });
});
