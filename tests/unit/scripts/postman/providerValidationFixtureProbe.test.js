const {
  assertProviderValidationFixturesReachable,
  normalizeContentType,
} = require('../../../../scripts/postman/provider-validation-fixture-probe');

const createHeaders = (entries = {}) => ({
  get: (name) => {
    const match = Object.entries(entries).find(([headerName]) => (
      headerName.toLowerCase() === name.toLowerCase()
    ));

    return match ? match[1] : null;
  },
});

const createImageResponse = () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: createHeaders({
    'content-type': 'image/png',
  }),
  arrayBuffer: jest.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]).buffer),
});

const createHtmlResponse = (body = '<html><body><img src="/a.png" alt="" /></body></html>') => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: createHeaders({
    'content-type': 'text/html; charset=utf-8',
  }),
  text: jest.fn().mockResolvedValue(body),
});

const createPlainTextHtmlResponse = (
  body = '<html><body><img src="/a.png" alt="" /></body></html>',
) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  headers: createHeaders({
    'content-type': 'text/plain; charset=utf-8',
  }),
  text: jest.fn().mockResolvedValue(body),
});

describe('Unit | Scripts | Postman | Provider Validation Fixture Probe', () => {
  it('normalizes content types without charset noise', () => {
    expect(normalizeContentType('text/html; charset=utf-8')).toBe('text/html');
  });

  it('accepts reachable image and page fixtures', async () => {
    const fetchFn = jest.fn(async (url) => (
      url.endsWith('.html') ? createHtmlResponse() : createImageResponse()
    ));

    await expect(assertProviderValidationFixturesReachable({
      providerValidationImageUrl: 'https://example.test/assets/a.png',
      providerValidationPageUrl: 'https://example.test/page.html',
      providerValidationAzureImageUrl: 'https://example.test/assets/a.png',
      providerValidationAzurePageUrl: 'https://example.test/page.html',
    }, {
      fetchFn,
      writeLog: jest.fn(),
    })).resolves.toBeUndefined();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('fails fast when the fixture page is not valid HTML', async () => {
    const fetchFn = jest.fn(async (url) => (
      url.endsWith('.html')
        ? createHtmlResponse('<html><body><p>missing image markup</p></body></html>')
        : createImageResponse()
    ));

    await expect(assertProviderValidationFixturesReachable({
      providerValidationImageUrl: 'https://example.test/assets/a.png',
      providerValidationPageUrl: 'https://example.test/page.html',
      providerValidationAzureImageUrl: 'https://example.test/assets/a.png',
      providerValidationAzurePageUrl: 'https://example.test/page.html',
    }, {
      fetchFn,
      writeLog: jest.fn(),
    })).rejects.toThrow('https://example.test/page.html does not look like an HTML fixture page');
  });

  it('accepts HTML fixture pages served as text/plain when the body is valid HTML', async () => {
    const fetchFn = jest.fn(async (url) => (
      url.endsWith('.html')
        ? createPlainTextHtmlResponse()
        : createImageResponse()
    ));

    await expect(assertProviderValidationFixturesReachable({
      providerValidationImageUrl: 'https://example.test/assets/a.png',
      providerValidationPageUrl: 'https://example.test/page.html',
      providerValidationAzureImageUrl: 'https://example.test/assets/a.png',
      providerValidationAzurePageUrl: 'https://example.test/page.html',
    }, {
      fetchFn,
      writeLog: jest.fn(),
    })).resolves.toBeUndefined();
  });

  it('fails when an image fixture returns the wrong content type', async () => {
    const fetchFn = jest.fn(async (url) => (
      url.endsWith('.html')
        ? createHtmlResponse()
        : {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: createHeaders({
            'content-type': 'application/json',
          }),
          arrayBuffer: jest.fn().mockResolvedValue(Uint8Array.from([1]).buffer),
        }
    ));

    await expect(assertProviderValidationFixturesReachable({
      providerValidationImageUrl: 'https://example.test/assets/a.png',
      providerValidationPageUrl: 'https://example.test/page.html',
      providerValidationAzureImageUrl: 'https://example.test/assets/a.png',
      providerValidationAzurePageUrl: 'https://example.test/page.html',
    }, {
      fetchFn,
      writeLog: jest.fn(),
    })).rejects.toThrow('expected image/*');
  });
});
