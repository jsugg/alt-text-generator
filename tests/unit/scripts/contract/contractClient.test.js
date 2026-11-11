const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  ContractResponseError,
  createContractClient,
  createContractResponse,
  normalizeHeaders,
  prepareRequest,
  resolveContractTarget,
} = require('../../../../scripts/contract/contract-client');
const { readRequestLogs } = require('../../../../scripts/contract/request-log');

/**
 * Echoes the request so both transports can be compared byte for byte.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
const echoHandler = (req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    if (req.url.startsWith('/gzip')) {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' });
      res.end(zlib.gzipSync('\uFEFFcompressed'));
      return;
    }

    if (req.url.startsWith('/slow')) {
      return;
    }

    if (req.url.startsWith('/redirect')) {
      res.writeHead(302, { Location: '/target' });
      res.end();
      return;
    }

    res.setHeader('Set-Cookie', ['a=1', 'b=2']);
    res.writeHead(req.url.startsWith('/missing') ? 404 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      method: req.method,
      url: req.url,
      header: req.headers['x-probe'] ?? null,
      contentType: req.headers['content-type'] ?? null,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
};

describe('Unit | Scripts | Contract | Contract Client', () => {
  describe('prepareRequest', () => {
    it('merges default headers, encodes the query, and serializes JSON bodies', () => {
      expect(prepareRequest({
        method: 'post',
        path: '/api/items?existing=1',
        query: { url: 'https://example.test/a b', limit: 2 },
        headers: { 'X-Probe': 'request' },
        body: { ok: true },
      }, { 'X-Probe': 'default', Accept: 'application/json' })).toEqual({
        method: 'POST',
        target: '/api/items?existing=1&url=https%3A%2F%2Fexample.test%2Fa+b&limit=2',
        headers: {
          'accept-encoding': 'gzip, deflate',
          'x-probe': 'request',
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: Buffer.from('{"ok":true}'),
      });
    });

    it('sends string bodies as untyped buffers and rejects bad methods or relative paths', () => {
      expect(prepareRequest({ path: '/a', body: 'raw', headers: { 'Accept-Encoding': 'identity' } }))
        .toEqual({
          method: 'GET', target: '/a', body: Buffer.from('raw'), headers: { 'accept-encoding': 'identity' },
        });
      expect(() => prepareRequest({ method: 'TRACE', path: '/a' })).toThrow('Unsupported contract request method');
      expect(() => prepareRequest({ path: 'api/a' })).toThrow('must start with "/"');
    });
  });

  it('normalizes header names and repeated values', () => {
    expect(normalizeHeaders({ 'Set-Cookie': ['a=1', 'b=2'], 'Content-Length': 2, Skip: undefined }))
      .toEqual({ 'set-cookie': 'a=1, b=2', 'content-length': '2' });
  });

  it('strips a leading byte-order mark before parsing', () => {
    expect(createContractResponse({
      status: 200, headers: {}, text: '\uFEFF{"ok":true}', durationMs: 1,
    }).json()).toEqual({ ok: true });
  });

  it('parses JSON lazily without quoting invalid bodies in the error', () => {
    const response = createContractResponse({
      status: 500, headers: { 'content-type': 'text/html' }, text: '<secret>', durationMs: 1,
    });

    expect(() => response.json()).toThrow(ContractResponseError);
    expect(() => response.json()).toThrow('status 500, content-type "text/html", 8 bytes');
    expect(() => response.json()).not.toThrow(/secret/u);
  });

  describe('resolveContractTarget', () => {
    it('defaults to the in-process transport', () => {
      expect(resolveContractTarget({})).toEqual({ transport: 'supertest', baseUrl: null, insecureTls: false });
    });

    it('selects the black-box transport for an http(s) base URL', () => {
      expect(resolveContractTarget({
        CONTRACT_BASE_URL: ' https://api.example.test/prefix/ ',
        CONTRACT_INSECURE_TLS: 'true',
      })).toEqual({ transport: 'undici', baseUrl: 'https://api.example.test/prefix', insecureTls: true });
      expect(() => resolveContractTarget({ CONTRACT_BASE_URL: 'ftp://x.test' })).toThrow('http(s) URL');
    });
  });

  it('requires an app for in-process runs', () => {
    expect(() => createContractClient({ env: {} })).toThrow('need an app');
  });

  describe('transport adapters', () => {
    let server;
    let baseUrl;

    beforeAll(async () => {
      server = http.createServer(echoHandler);
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    afterAll(async () => {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    });

    const clients = () => [
      createContractClient({ app: echoHandler, env: {}, defaultHeaders: { 'X-Probe': 'p' } }),
      createContractClient({ env: { CONTRACT_BASE_URL: baseUrl }, defaultHeaders: { 'X-Probe': 'p' } }),
    ];

    it('return identical normalized responses on both transports', async () => {
      const [inProcess, blackBox] = clients();
      const request = { method: 'POST', path: '/echo', query: { q: 'v' }, body: { a: 1 } };
      const [local, remote] = await Promise.all([inProcess.send(request), blackBox.send(request)]);

      [local, remote].forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.headers['set-cookie']).toBe('a=1, b=2');
        expect(response.json()).toEqual({
          method: 'POST',
          url: '/echo?q=v',
          header: 'p',
          contentType: 'application/json',
          body: '{"a":1}',
        });
        expect(response.durationMs).toBeGreaterThanOrEqual(0);
      });
      expect(remote.text).toBe(local.text);
      expect([inProcess.transport, blackBox.transport]).toEqual(['supertest', 'undici']);
      await Promise.all([inProcess.close(), blackBox.close()]);
    });

    it('send raw string bodies without a content-type on both transports', async () => {
      const [inProcess, blackBox] = clients();
      const request = { method: 'POST', path: '/echo', body: 'a=1' };
      const responses = await Promise.all([inProcess.send(request), blackBox.send(request)]);

      responses.forEach((response) => {
        expect(response.json()).toMatchObject({ contentType: null, body: 'a=1' });
      });
      await Promise.all([inProcess.close(), blackBox.close()]);
    });

    it('decode compressed bodies identically on both transports', async () => {
      const [inProcess, blackBox] = clients();
      const responses = await Promise.all([
        inProcess.send({ path: '/gzip' }),
        blackBox.send({ path: '/gzip' }),
      ]);

      expect(responses.map((response) => response.text)).toEqual(['compressed', 'compressed']);
      await Promise.all([inProcess.close(), blackBox.close()]);
    });

    it('time out hung requests on both transports', async () => {
      const inProcess = createContractClient({ app: echoHandler, env: {}, timeoutMs: 100 });
      const blackBox = createContractClient({ env: { CONTRACT_BASE_URL: baseUrl }, timeoutMs: 100 });

      await expect(inProcess.send({ path: '/slow' })).rejects.toThrow(/timeout/iu);
      await expect(blackBox.send({ path: '/slow' })).rejects.toThrow();
      await Promise.all([inProcess.close(), blackBox.close()]);
    });

    it('keep the transport error when the observer also fails', async () => {
      const failingObserver = () => {
        throw new Error('observer failed');
      };
      const unreachable = createContractClient({
        env: { CONTRACT_BASE_URL: 'http://127.0.0.1:1' }, observer: failingObserver, timeoutMs: 2000,
      });
      const reachable = createContractClient({
        env: { CONTRACT_BASE_URL: baseUrl }, observer: failingObserver,
      });

      await expect(unreachable.send({ path: '/down' })).rejects.not.toThrow('observer failed');
      await expect(reachable.send({ path: '/echo' })).rejects.toThrow('observer failed');
      await Promise.all([unreachable.close(), reachable.close()]);
    });

    it('surface non-2xx statuses and redirects without following them', async () => {
      const [inProcess, blackBox] = clients();
      const responses = await Promise.all([
        inProcess.send({ path: '/missing' }),
        blackBox.send({ path: '/missing' }),
        inProcess.send({ path: '/redirect' }),
        blackBox.send({ path: '/redirect' }),
      ]);

      expect(responses.map((response) => response.status)).toEqual([404, 404, 302, 302]);
      expect(responses[2].headers.location).toBe('/target');
      expect(responses[3].headers.location).toBe('/target');
      await Promise.all([inProcess.close(), blackBox.close()]);
    });

    it('report every exchange, including transport failures, to the request log', async () => {
      const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-client-log-'));
      const blackBox = createContractClient({
        env: { CONTRACT_BASE_URL: baseUrl, CONTRACT_REQUEST_LOG_DIR: logDir },
        resolveTestName: () => 'logs exchanges',
      });
      const unreachable = createContractClient({
        env: { CONTRACT_BASE_URL: 'http://127.0.0.1:1', CONTRACT_REQUEST_LOG_DIR: logDir },
        timeoutMs: 2000,
      });

      await blackBox.send({ path: '/echo', query: { token: 'secret-value' } });
      await expect(unreachable.send({ path: '/down' })).rejects.toThrow();
      await Promise.all([blackBox.close(), unreachable.close()]);

      const { entries } = readRequestLogs(logDir);

      expect(entries).toEqual([
        expect.objectContaining({
          transport: 'undici', method: 'GET', path: '/echo', status: 200, testName: 'logs exchanges', error: null,
        }),
        expect.objectContaining({ path: '/down', status: null, testName: null, error: expect.any(String) }),
      ]);
      expect(JSON.stringify(entries)).not.toContain('secret-value');
    });
  });
});
