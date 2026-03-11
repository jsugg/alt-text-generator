const DescriptionController = require('../../../src/api/v1/controllers/descriptionController');
const { ApiError } = require('../../../src/errors/ApiError');
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

const makeResMock = () => ({
  json: jest.fn(),
});

describe('Unit | Controllers | Description Controller', () => {
  describe('DescriptionController.describe', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('forwards a validation error when image_source is missing', async () => {
      const controller = createController(new ImageDescriberFactory());
      const req = { query: { model: 'clip' } };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describe(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'QUERY_VALIDATION_ERROR',
        message: 'Missing required query parameters: image_source and model',
        details: [{ field: 'image_source', issue: 'required' }],
      });
    });

    it('forwards a validation error when model is missing', async () => {
      const controller = createController(new ImageDescriberFactory());
      const req = {
        query: { image_source: encodeURIComponent('https://example.com/img.jpg') },
      };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describe(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'QUERY_VALIDATION_ERROR',
        details: [{ field: 'model', issue: 'required' }],
      });
    });

    it('forwards a validation error for an invalid image_source URL', async () => {
      const controller = createController(new ImageDescriberFactory());
      const req = { query: { image_source: 'not-a-url', model: 'clip' } };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describe(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'INVALID_IMAGE_SOURCE_URL',
        message: 'Invalid image_source URL',
        details: [{ field: 'image_source', issue: 'invalid_url' }],
      });
    });

    it('forwards a validation error for an unknown model', async () => {
      const controller = createController(new ImageDescriberFactory().register('clip', {
        describeImage: jest.fn(),
      }));
      const req = {
        query: {
          image_source: encodeURIComponent('https://example.com/img.jpg'),
          model: 'unknown-model',
        },
      };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describe(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'UNKNOWN_MODEL',
        details: [{ field: 'model', issue: 'unsupported_value' }],
      });
      expect(next.mock.calls[0][0].message).toMatch(/Unknown model/);
    });

    it('returns the description array on success', async () => {
      const mockDescriber = {
        describeImage: jest.fn().mockResolvedValue({
          description: 'a sunset over the mountains',
          imageUrl: 'https://example.com/img.jpg',
        }),
      };
      const controller = createController(
        new ImageDescriberFactory().register('clip', mockDescriber),
      );
      const req = {
        query: {
          image_source: encodeURIComponent('https://example.com/img.jpg'),
          model: 'clip',
        },
        log: mockLogger,
      };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describe(req, res, next);

      expect(res.json).toHaveBeenCalledWith([{
        description: 'a sunset over the mountains',
        imageUrl: 'https://example.com/img.jpg',
      }]);
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards an internal error when the describer fails', async () => {
      const error = new Error('API timeout');
      const mockDescriber = {
        describeImage: jest.fn().mockRejectedValue(error),
      };
      const controller = createController(
        new ImageDescriberFactory().register('clip', mockDescriber),
      );
      const req = {
        query: {
          image_source: encodeURIComponent('https://example.com/img.jpg'),
          model: 'clip',
        },
        log: mockLogger,
      };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describe(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 500,
        code: 'DESCRIPTION_FETCH_FAILED',
        message: 'Error fetching description for the provided image',
        cause: error,
      });
    });
  });

  describe('DescriptionController.describePage', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('forwards a validation error when url is missing', async () => {
      const controller = createController(new ImageDescriberFactory());
      const req = { query: { model: 'clip' } };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describePage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'QUERY_VALIDATION_ERROR',
        message: 'Missing required query parameters: url and model',
        details: [{ field: 'url', issue: 'required' }],
      });
    });

    it('forwards a validation error when url is invalid', async () => {
      const controller = createController(new ImageDescriberFactory());
      const req = { query: { url: 'not-a-url', model: 'clip' } };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describePage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'INVALID_PAGE_URL',
        message: 'Invalid url parameter',
        details: [{ field: 'url', issue: 'invalid_url' }],
      });
    });

    it('forwards a validation error for an unknown model', async () => {
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
      const next = jest.fn();

      await controller.describePage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 400,
        code: 'UNKNOWN_MODEL',
        message: 'Unknown model: clip',
      });
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
        log: mockLogger,
      };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describePage(req, res, next);

      expect(pageDescriptionService.describePage).toHaveBeenCalledWith({
        pageUrl: 'https://example.com/page',
        model: 'clip',
      });
      expect(res.json).toHaveBeenCalledWith(expected);
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards an internal error when page orchestration fails', async () => {
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
        log: mockLogger,
      };
      const res = makeResMock();
      const next = jest.fn();

      await controller.describePage(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      expect(next.mock.calls[0][0]).toMatchObject({
        statusCode: 500,
        code: 'PAGE_DESCRIPTION_FETCH_FAILED',
        message: 'Error fetching descriptions for the provided page',
        cause: error,
      });
    });
  });
});
