const DescriptionController = require('../../../src/api/v1/controllers/descriptionController');
const ImageDescriberFactory = require('../../../src/services/ImageDescriberFactory');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const createController = (imageDescriberFactory, pageDescriptionService = {
  describePage: jest.fn(),
}) => new DescriptionController({
  imageDescriberFactory,
  pageDescriptionService,
  logger: mockLogger,
});

const makeResMock = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('DescriptionController.describe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when image_source is missing', async () => {
    const factory = new ImageDescriberFactory();
    const controller = createController(factory);
    const req = { query: { model: 'clip' } };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when model is missing', async () => {
    const factory = new ImageDescriberFactory();
    const controller = createController(factory);
    const req = { query: { image_source: encodeURIComponent('https://example.com/img.jpg') } };
    const res = makeResMock();

    await controller.describe(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 for an invalid image_source URL', async () => {
    const factory = new ImageDescriberFactory();
    const controller = createController(factory);
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
    const controller = createController(factory);
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
    const controller = createController(factory);
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
    const error = new Error('API timeout');
    const mockDescriber = {
      describeImage: jest.fn().mockRejectedValue(error),
    };
    const factory = new ImageDescriberFactory().register('clip', mockDescriber);
    const controller = createController(factory);
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
    expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      model: 'clip',
      imageSource: 'https://example.com/img.jpg',
    }), 'Error generating description');
  });
});

describe('DescriptionController.describePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 when url is missing', async () => {
    const controller = createController(new ImageDescriberFactory());
    const req = { query: { model: 'clip' } };
    const res = makeResMock();

    await controller.describePage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Missing required query parameters: url and model',
    });
  });

  it('returns 400 when url is invalid', async () => {
    const controller = createController(new ImageDescriberFactory());
    const req = { query: { url: 'not-a-url', model: 'clip' } };
    const res = makeResMock();

    await controller.describePage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid url parameter' });
  });

  it('returns 400 for an unknown model', async () => {
    const controller = createController(
      new ImageDescriberFactory(),
      { describePage: jest.fn().mockRejectedValue(new Error('Unknown model: clip')) },
    );
    const req = {
      query: {
        url: encodeURIComponent('https://example.com/page'),
        model: 'clip',
      },
    };
    const res = makeResMock();

    await controller.describePage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown model: clip' });
  });

  it('returns ordered descriptions on success', async () => {
    const expected = {
      pageUrl: 'https://example.com/page',
      model: 'clip',
      totalImages: 3,
      uniqueImages: 2,
      descriptions: [
        {
          description: 'first',
          imageUrl: 'https://example.com/a.jpg',
        },
        {
          description: 'second',
          imageUrl: 'https://example.com/b.jpg',
        },
        {
          description: 'first',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    };
    const pageDescriptionService = {
      describePage: jest.fn().mockResolvedValue(expected),
    };
    const controller = createController(
      new ImageDescriberFactory(),
      pageDescriptionService,
    );
    const req = {
      query: {
        url: encodeURIComponent('https://example.com/page'),
        model: 'clip',
      },
    };
    const res = makeResMock();

    await controller.describePage(req, res);

    expect(pageDescriptionService.describePage).toHaveBeenCalledWith({
      pageUrl: 'https://example.com/page',
      model: 'clip',
    });
    expect(res.json).toHaveBeenCalledWith(expected);
  });

  it('returns 500 when the page orchestration fails', async () => {
    const error = new Error('network error');
    const controller = createController(
      new ImageDescriberFactory(),
      { describePage: jest.fn().mockRejectedValue(error) },
    );
    const req = {
      query: {
        url: encodeURIComponent('https://example.com/page'),
        model: 'clip',
      },
    };
    const res = makeResMock();

    await controller.describePage(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Error fetching descriptions for the provided page',
    });
    expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({
      err: error,
      model: 'clip',
      pageUrl: 'https://example.com/page',
    }), 'Error generating page descriptions');
  });
});
