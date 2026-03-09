const { getUpstreamErrorSummary } = require('../../../src/utils/getUpstreamErrorSummary');

describe('getUpstreamErrorSummary', () => {
  it('extracts request and response details from fetch-style errors', () => {
    const error = new Error('Request failed');
    error.request = {
      method: 'POST',
      url: 'https://api.replicate.com/v1/predictions',
    };
    error.response = {
      status: 429,
      statusText: 'Too Many Requests',
      headers: {
        get: (name) => {
          const values = {
            'retry-after': '30',
            'x-ratelimit-remaining': '0',
          };

          return values[name] ?? null;
        },
      },
    };

    expect(getUpstreamErrorSummary(error)).toEqual({
      request: {
        method: 'POST',
        url: 'https://api.replicate.com/v1/predictions',
      },
      response: {
        status: 429,
        statusText: 'Too Many Requests',
        headers: {
          'retry-after': '30',
          'x-ratelimit-remaining': '0',
        },
      },
    });
  });

  it('extracts axios-style config, code, headers, and body preview', () => {
    const error = new Error('Network Error');
    error.code = 'ENOTFOUND';
    error.config = {
      method: 'post',
      baseURL: 'https://azure.example.com',
      url: '/vision/v3.2/describe',
    };
    error.response = {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Retry-After': '120',
      },
      data: {
        detail: 'Temporary upstream outage',
      },
    };

    expect(getUpstreamErrorSummary(error)).toEqual({
      code: 'ENOTFOUND',
      request: {
        method: 'POST',
        url: 'https://azure.example.com/vision/v3.2/describe',
      },
      response: {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {
          'retry-after': '120',
        },
        bodyPreview: JSON.stringify({ detail: 'Temporary upstream outage' }),
      },
    });
  });

  it('returns undefined when no upstream details are available', () => {
    expect(getUpstreamErrorSummary(new Error('boom'))).toBeUndefined();
  });
});
