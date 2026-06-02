const {
  createOutboundUrlPolicy,
  isBlockedAddress,
  parseUrl,
  requestWithOutboundUrlPolicy,
} = require('../../../src/infrastructure/outboundUrlPolicy');

describe('Unit | Infrastructure | Outbound URL Policy', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.1.1',
    '192.168.1.20',
    '169.254.169.254',
    '::1',
    'fc00::1',
    'fe80::1',
  ])('blocks private or special-use address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it('rejects unsupported protocols and embedded credentials', () => {
    expect(() => parseUrl('file:///etc/passwd')).toThrow('protocol must be http or https');
    expect(() => parseUrl('https://user:pass@example.com/image.png'))
      .toThrow('must not include credentials');
  });

  it('allows public DNS records', async () => {
    const lookup = jest.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
    const policy = createOutboundUrlPolicy({ lookup });

    await expect(policy('https://example.com/page')).resolves.toBeInstanceOf(URL);
    expect(lookup).toHaveBeenCalledWith('example.com', {
      all: true,
      verbatim: true,
    });
  });

  it('rejects hostnames that resolve to blocked addresses', async () => {
    const policy = createOutboundUrlPolicy({
      lookup: jest.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]),
    });

    await expect(policy('https://internal.example.com/page'))
      .rejects
      .toThrow('blocked network address: 127.0.0.1');
  });

  it('allows explicitly configured host and port pairs without DNS resolution', async () => {
    const lookup = jest.fn();
    const policy = createOutboundUrlPolicy({
      allowedHosts: ['127.0.0.1:19090'],
      lookup,
    });

    await expect(policy('http://127.0.0.1:19090/assets/a.png'))
      .resolves
      .toBeInstanceOf(URL);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not allow private addresses on unlisted ports', async () => {
    const policy = createOutboundUrlPolicy({
      allowedHosts: ['127.0.0.1:19090'],
    });

    await expect(policy('http://127.0.0.1:19091/assets/a.png'))
      .rejects
      .toThrow('blocked network address: 127.0.0.1');
  });

  it('validates each redirect before following it', async () => {
    const policy = jest.fn()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error('blocked redirect'));
    const httpClient = {
      get: jest.fn().mockResolvedValue({
        status: 302,
        headers: {
          location: 'http://127.0.0.1/admin',
        },
      }),
    };

    await expect(requestWithOutboundUrlPolicy({
      httpClient,
      url: 'https://example.com/start',
      outboundUrlPolicy: policy,
      options: {
        maxRedirects: 1,
      },
    })).rejects.toThrow('blocked redirect');

    expect(policy).toHaveBeenCalledWith('https://example.com/start');
    expect(policy).toHaveBeenCalledWith('http://127.0.0.1/admin');
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });
});
