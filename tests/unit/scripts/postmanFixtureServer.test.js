const request = require('supertest');

const { getProviderValidationAsset } = require('../../../src/providerValidation/fixtures');
const { createFixtureApp } = require('../../../scripts/postman-fixture-server');

describe('Unit | Scripts | Postman Fixture Server', () => {
  const baseUrl = 'http://127.0.0.1:19090';

  it('accepts provider-validation data-url payloads above the express default json limit', async () => {
    const app = createFixtureApp({ baseUrl });
    const imageBuffer = getProviderValidationAsset('a.png');
    const dataUrl = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    const response = await request(app)
      .post('/huggingface/v1/chat/completions')
      .send({
        model: 'stub-model',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe the image.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.choices[0].message.content).toBe('huggingface stub caption');
  });

  it('advances replicate predictions through processing to success', async () => {
    const app = createFixtureApp({ baseUrl });
    const createResponse = await request(app)
      .post('/predictions')
      .send({
        version: 'stub-version',
        input: {
          image: `${baseUrl}/assets/a.png`,
        },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body).toMatchObject({
      id: expect.stringMatching(/^stub-prediction-/),
      input: {
        image: `${baseUrl}/assets/a.png`,
      },
      status: 'starting',
    });

    const { id: predictionId } = createResponse.body;
    let { status } = createResponse.body;
    let output;

    while (status !== 'succeeded') {
      // The fixture app advances Replicate state deterministically on each poll.
      // eslint-disable-next-line no-await-in-loop
      const pollResponse = await request(app).get(`/predictions/${predictionId}`);
      expect(pollResponse.status).toBe(200);
      ({ status, output } = pollResponse.body);
    }

    expect(status).toBe('succeeded');
    expect(output).toBe('replicate stub caption');
  });

  it('advances replicate predictions through processing to failure', async () => {
    const app = createFixtureApp({ baseUrl });
    const createResponse = await request(app)
      .post('/predictions')
      .send({
        version: 'stub-version',
        input: {
          image: `${baseUrl}/assets/provider-error.png`,
        },
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.status).toBe('starting');

    const { id: predictionId } = createResponse.body;
    let { status } = createResponse.body;
    let errorMessage;

    while (status !== 'failed') {
      // The failure path is also deterministic and should never silently succeed.
      // eslint-disable-next-line no-await-in-loop
      const pollResponse = await request(app).get(`/predictions/${predictionId}`);
      expect(pollResponse.status).toBe(200);
      ({ status, error: errorMessage } = pollResponse.body);
    }

    expect(status).toBe('failed');
    expect(errorMessage).toBe('stub replicate provider failure');
  });

  it('supports canceling replicate predictions', async () => {
    const app = createFixtureApp({ baseUrl });
    const createResponse = await request(app)
      .post('/predictions')
      .send({
        version: 'stub-version',
        input: {
          image: `${baseUrl}/assets/a.png`,
        },
      });

    const predictionId = createResponse.body.id;
    const cancelResponse = await request(app).post(`/predictions/${predictionId}/cancel`);

    expect(cancelResponse.status).toBe(200);
    expect(cancelResponse.body).toMatchObject({
      id: predictionId,
      status: 'canceled',
      error: 'stub replicate prediction canceled',
    });

    const followUpPollResponse = await request(app).get(`/predictions/${predictionId}`);

    expect(followUpPollResponse.status).toBe(200);
    expect(followUpPollResponse.body.status).toBe('canceled');
  });
});
