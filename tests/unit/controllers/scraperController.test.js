const ScraperController = require('../../../src/api/v1/controllers/scraperController');
const { ApiError } = require('../../../src/errors/ApiError');

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const makeResMock = () => ({
  json: jest.fn(),
});

describe('Unit | Controllers | Scraper Controller', () => {
  it('forwards a validation error when url is missing', async () => {
    const controller = new ScraperController({
      scraperService: {},
      logger: mockLogger,
    });
    const req = { query: {} };
    const res = makeResMock();
    const next = jest.fn();

    await controller.getImages(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 400,
      code: 'QUERY_VALIDATION_ERROR',
      details: [{ field: 'url', issue: 'required' }],
    });
  });

  it('forwards a validation error for an invalid URL', async () => {
    const controller = new ScraperController({
      scraperService: {},
      logger: mockLogger,
    });
    const req = { query: { url: 'not-a-url' } };
    const res = makeResMock();
    const next = jest.fn();

    await controller.getImages(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 400,
      code: 'INVALID_PAGE_URL',
      message: 'Invalid URL format',
    });
  });

  it('returns scraped images on success', async () => {
    const mockScraperService = {
      getImages: jest.fn().mockResolvedValue({ imageSources: ['https://example.com/a.jpg'] }),
    };
    const controller = new ScraperController({
      scraperService: mockScraperService,
      logger: mockLogger,
    });
    const req = { query: { url: encodeURIComponent('https://example.com') } };
    const res = makeResMock();
    const next = jest.fn();

    await controller.getImages(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ imageSources: ['https://example.com/a.jpg'] });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards an internal error when the scraper service fails', async () => {
    const mockScraperService = {
      getImages: jest.fn().mockRejectedValue(new Error('fetch failed')),
    };
    const controller = new ScraperController({
      scraperService: mockScraperService,
      logger: mockLogger,
    });
    const req = { query: { url: encodeURIComponent('https://example.com') } };
    const res = makeResMock();
    const next = jest.fn();

    await controller.getImages(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 500,
      code: 'SCRAPE_FETCH_FAILED',
      message: 'Error fetching images from the provided URL',
    });
  });
});
