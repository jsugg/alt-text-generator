const { buildAppServerEnv } = require('../../../../scripts/postman/app-server-env');

describe('Unit | Scripts | Postman | App Server Env', () => {
  it('sets an explicit outbound URL allowlist when provided', () => {
    const env = buildAppServerEnv({
      httpPort: '8080',
      httpsPort: '8443',
      outboundAllowedHosts: '127.0.0.1:19090',
    });

    expect(env.OUTBOUND_ALLOWED_HOSTS).toBe('127.0.0.1:19090');
  });
});
