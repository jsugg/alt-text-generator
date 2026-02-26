const DescriptionController = require('../../../src/api/v1/controllers/descriptionController');
const ImageDescriberFactory = require('../../../src/services/ImageDescriberFactory');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const makeResMock = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('DescriptionController.describe', () => {
  it('returns 400 when image_source is missing', async () => {
    const factory = new ImageDescriberFactory();
    const controller = new DescriptionController({ imageDescriberFactory: factory, logger: mockLogger });
    const req = { query: { model: 'clip' } };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when model is missing', async () => {
    const factory = new ImageDescriberFactory();
    const controller = new DescriptionController({ imageDescriberFactory: factory, logger: mockLogger });
    const req = { query: { image_source: encodeURIComponent('https://example.com/img.jpg') } };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an invalid image_source URL', async () => {
    const factory = new ImageDescriberFactory();
    const controller = new DescriptionController({ imageDescriberFactory: factory, logger: mockLogger });
    const req = { query: { image_source: 'not-a-url', model: 'clip' } };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid image_source URL' });
  });

  it('returns 400 for an unknown model', async () => {
    const factory = new ImageDescriberFactory().register('clip', {
      describeImage: jest.fn(),
    });
    const controller = new DescriptionController({ imageDescriberFactory: factory, logger: mockLogger });
    const req = {
      query: {
        image_source: encodeURIComponent('https://example.com/img.jpg'),
        model: 'unknown-model',
      },
    };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/Unknown model/);
  });

  it('returns description array on success', async () => {
    const mockDescriber = {
      describeImage: jest.fn().mockResolvedValue({
        description: 'a sunset over the mountains',
        imageUrl: 'https://example.com/img.jpg',
      }),
    };
    const factory = new ImageDescriberFactory().register('clip', mockDescriber);
    const controller = new DescriptionController({ imageDescriberFactory: factory, logger: mockLogger });
    const req = {
      query: {
        image_source: encodeURIComponent('https://example.com/img.jpg'),
        model: 'clip',
      },
    };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.json).toHaveBeenCalledWith([{
      description: 'a sunset over the mountains',
      imageUrl: 'https://example.com/img.jpg',
    }]);
  });

  it('returns 500 when describer throws a non-model error', async () => {
    const mockDescriber = {
      describeImage: jest.fn().mockRejectedValue(new Error('API timeout')),
    };
    const factory = new ImageDescriberFactory().register('clip', mockDescriber);
    const controller = new DescriptionController({ imageDescriberFactory: factory, logger: mockLogger });
    const req = {
      query: {
        image_source: encodeURIComponent('https://example.com/img.jpg'),
        model: 'clip',
      },
    };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Error fetching description for the provided image',
    });
  });
});
