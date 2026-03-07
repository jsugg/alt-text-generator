const ScraperController = require('../../../src/api/v1/controllers/scraperController');

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

describe('ScraperController.getImages', () => {
  it('returns 400 when url param is missing', async () => {
    const controller = new ScraperController({
      scraperService: {},
      logger: mockLogger,
    });
    const req = { query: {} };
    const res = makeResMock();

    await controller.getImages(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing required query parameter: url' });
  });

  it('returns 400 for an invalid URL', async () => {
    const controller = new ScraperController({
      scraperService: {},
      logger: mockLogger,
    });
    const req = { query: { url: 'not-a-url' } };
    const res = makeResMock();

    await controller.getImages(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid URL format' });
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

    await controller.getImages(req, res);

    expect(res.json).toHaveBeenCalledWith({ imageSources: ['https://example.com/a.jpg'] });
  });

  it('returns 500 when scraper service throws', async () => {
    const mockScraperService = {
      getImages: jest.fn().mockRejectedValue(new Error('fetch failed')),
    };
    const controller = new ScraperController({
      scraperService: mockScraperService,
      logger: mockLogger,
    });
    const req = { query: { url: encodeURIComponent('https://example.com') } };
    const res = makeResMock();

    await controller.getImages(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Error fetching images from the provided URL',
    });
  });
});
