const {
  REDACTED,
  collectSecretValues,
  redactRequestPath,
  redactText,
} = require('../../../../scripts/contract/redaction');

describe('Unit | Scripts | Contract | Redaction', () => {
  it('collects secret-named environment values, longest first', () => {
    expect(collectSecretValues({
      API_AUTH_TOKENS: 'token-one, token-two,abc',
      PROVIDER_API_KEY: 'sk-abcdef',
      SHORT_TOKEN: 'abc',
      BASE_URL: 'https://not-a-secret.test',
      EMPTY_SECRET: '',
    })).toEqual(['token-one, token-two,abc', 'token-one', 'token-two', 'sk-abcdef']);
  });

  it('redacts credential headers, bearer tokens, secret JSON fields, and query strings', () => {
    const text = [
      'authorization: Bearer abc.def',
      '"x-api-key":"key-123"',
      'X-Api-Key=plain-key',
      'Bearer standalone-token',
      '{"apiKey":"k1","providerToken":"t1","status":"ok"}',
      'GET https://api.example.test/v1/describe?image_source=https://x.test/a.png&token=t#frag',
    ].join('\n');
    const redacted = redactText(text, { secretValues: [] });

    expect(redacted).toBe([
      `authorization: ${REDACTED}`,
      `"x-api-key":${REDACTED}`,
      `X-Api-Key=${REDACTED}`,
      `Bearer ${REDACTED}`,
      `{"apiKey":"${REDACTED}","providerToken":"${REDACTED}","status":"ok"}`,
      `GET https://api.example.test/v1/describe?${REDACTED}#frag`,
    ].join('\n'));
  });

  it('redacts whole header values that contain separators or print as arrays', () => {
    const redacted = redactText([
      '"set-cookie": "sid=S1; Path=/, csrf=S2"',
      '"set-cookie": Array ["sid=S1", "csrf=S2"]',
      "cookie: 'a=S1, b=S2'",
      'proxy-authorization: Basic S1, extra S2',
    ].join('\n'), { secretValues: [] });

    expect(redacted).not.toMatch(/S1|S2/u);
    expect(redacted.split('\n')).toEqual([
      `"set-cookie": ${REDACTED}`,
      `"set-cookie": ${REDACTED}`,
      `cookie: ${REDACTED}`,
      `proxy-authorization: ${REDACTED}`,
    ]);
  });

  it('redacts hyphenated or numeric secret fields, any-case bearer, relative queries, and URL credentials', () => {
    const redacted = redactText([
      '{"x-access-token": "S1", "api-key": "S2", "token": 12345678, "status": "ok"}',
      'bearer S3',
      'GET /api/v1/description?image_source=S4 failed',
      'https://user:S5@host.test/path',
      'ratio a/b?c stays',
    ].join('\n'), { secretValues: [] });

    expect(redacted).not.toMatch(/S[1-5]|12345678/u);
    expect(redacted).toContain('"status": "ok"');
    expect(redacted).toContain(`GET /api/v1/description?${REDACTED} failed`);
    expect(redacted).toContain(`https://${REDACTED}@host.test/path`);
    expect(redacted).toContain('ratio a/b?c stays');
  });

  it('replaces literal secret values and strips ANSI colors', () => {
    expect(redactText('\u001b[31mexpected sk-live-123 to equal x\u001b[39m', {
      secretValues: ['sk-live-123'],
    })).toBe(`expected ${REDACTED} to equal x`);
  });

  it('reads secrets from process.env by default', () => {
    process.env.CONTRACT_TEST_SECRET = 'env-secret-value';

    expect(redactText('leaked env-secret-value')).toBe(`leaked ${REDACTED}`);
  });

  it('truncates long text and stringifies non-string input', () => {
    expect(redactText('x'.repeat(20), { secretValues: [], maxLength: 5 }))
      .toBe('xxxxx... [truncated 15 chars]');
    expect(redactText(undefined, { secretValues: [] })).toBe('');
    expect(redactText(404, { secretValues: [] })).toBe('404');
  });

  it('strips query strings and fragments from request paths', () => {
    expect(redactRequestPath('/api/v1/description?image_source=x&model=y')).toBe('/api/v1/description');
    expect(redactRequestPath('/api/docs#section')).toBe('/api/docs');
    expect(redactRequestPath('/api/ping')).toBe('/api/ping');
  });
});
