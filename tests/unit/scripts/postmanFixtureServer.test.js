const request = require('supertest');

const { getProviderValidationAsset } = require('../../../src/providerValidation/fixtures');
const { createFixtureApp } = require('../../../scripts/postman-fixture-server');

describe('Unit | Scripts | Postman Fixture Server', () => {
  it('accepts provider-validation data-url payloads above the express default json limit', async () => {
    const app = createFixtureApp({ baseUrl: 'http://127.0.0.1:19090' });
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
});
