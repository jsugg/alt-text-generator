const replicateDefinition = require('../../../../src/providers/definitions/replicate');

const API_ENDPOINT = 'https://replicate.test/v1';
const IMAGE_URL = 'https://images.test/cat.png';

/**
 * Builds the describer exactly as production does, but with a fetch that
 * records requests and answers from `respond`, so the real SDK is exercised
 * without network access.
 *
 * @param {(url: string, init: RequestInit) => { status?: number, body: unknown }} respond
 */
const buildDescriber = (respond) => {
  /** @type {{ url: string, method: string, headers: Headers, body: any }[]} */
  const requests = [];
  const fetch = jest.fn(async (input, init = {}) => {
    const url = String(input);
    const headers = new Headers(init.headers);

    requests.push({
      url,
      method: init.method ?? 'GET',
      headers,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });

    const { status = 200, body } = respond(url, init);

    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  const config = {
    replicate: replicateDefinition.buildConfig({
      REPLICATE_API_TOKEN: 'test-token',
      REPLICATE_API_ENDPOINT: API_ENDPOINT,
      REPLICATE_POLL_INTERVAL_MS: '1',
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const describer = replicateDefinition.createRuntime({
    config,
    logger,
    outboundClients: { fetch },
  });

  return { describer, requests };
};

describe('Unit | Providers | Replicate SDK contract', () => {
  it('creates predictions through the injected fetch with bearer auth and our payload', async () => {
    const { describer, requests } = buildDescriber(() => ({
      status: 201,
      body: { id: 'pred-1', status: 'starting' },
    }));

    const prediction = await describer.createPrediction(IMAGE_URL);

    expect(prediction).toEqual({ id: 'pred-1', status: 'starting' });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: `${API_ENDPOINT}/predictions`,
      method: 'POST',
      body: {
        version: replicateDefinition.buildConfig({}).modelVersion,
        input: { image: IMAGE_URL },
      },
    });
    expect(requests[0].headers.get('authorization')).toBe('Bearer test-token');
    expect(requests[0].headers.get('user-agent')).toBe('alt-text-generator/1.0.0');
    // Synchronous "wait" mode would change latency semantics; it must stay off.
    expect(requests[0].headers.get('prefer')).toBeNull();
  });

  it('reads a finished prediction as plain JSON and extracts the description', async () => {
    const { describer, requests } = buildDescriber(() => ({
      body: { id: 'pred-2', status: 'succeeded', output: 'Caption: a cat on a sofa' },
    }));

    const job = await describer.pollPredictionUntilDeadline({
      deadline: Date.now() + 60_000,
      imageUrl: IMAGE_URL,
      predictionId: 'pred-2',
      timeoutMs: 60_000,
    });

    expect(requests.map(({ method, url }) => `${method} ${url}`))
      .toEqual([`GET ${API_ENDPOINT}/predictions/pred-2`]);
    expect(job).toMatchObject({
      providerJobId: 'pred-2',
      status: 'succeeded',
      result: { imageUrl: IMAGE_URL },
    });
    expect(typeof job.result.description).toBe('string');
    expect(job.result.description.length).toBeGreaterThan(0);
  });

  it('cancels predictions on the cancel endpoint', async () => {
    const { describer, requests } = buildDescriber(() => ({
      body: { id: 'pred-3', status: 'canceled' },
    }));

    await describer.cancelPrediction('pred-3', IMAGE_URL);

    expect(requests.map(({ method, url }) => `${method} ${url}`))
      .toEqual([`POST ${API_ENDPOINT}/predictions/pred-3/cancel`]);
  });

  it('surfaces API failures as the SDK error with the upstream status', async () => {
    const { describer } = buildDescriber(() => ({
      status: 422,
      body: { detail: 'Invalid version or not permitted' },
    }));

    await expect(describer.createPrediction(IMAGE_URL)).rejects.toMatchObject({
      name: 'ApiError',
      response: expect.objectContaining({ status: 422 }),
    });
  });
});
