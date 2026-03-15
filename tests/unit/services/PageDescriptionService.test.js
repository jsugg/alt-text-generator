const PageDescriptionService = require('../../../src/services/PageDescriptionService');
const ImageDescriberFactory = require('../../../src/services/ImageDescriberFactory');

describe('Unit | Services | Page Description Service', () => {
  it('preserves duplicate image entries while deduping provider work', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/a.jpg',
          'https://example.com/b.jpg',
          'https://example.com/a.jpg',
        ],
      }),
    };
    const describeImage = jest
      .fn()
      .mockImplementation(async (imageUrl) => ({
        description: `description for ${imageUrl}`,
        imageUrl,
      }));
    const imageDescriberFactory = new ImageDescriberFactory().register('replicate', {
      describeImage,
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
    });

    const result = await service.describePage({
      pageUrl: 'https://example.com/page',
      model: 'replicate',
    });

    expect(scraperService.getImages).toHaveBeenCalledWith('https://example.com/page');
    expect(describeImage).toHaveBeenCalledTimes(2);
    expect(describeImage).toHaveBeenNthCalledWith(1, 'https://example.com/a.jpg');
    expect(describeImage).toHaveBeenNthCalledWith(2, 'https://example.com/b.jpg');
    expect(result).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'replicate',
      totalImages: 3,
      uniqueImages: 2,
      descriptions: [
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
        {
          description: 'description for https://example.com/b.jpg',
          imageUrl: 'https://example.com/b.jpg',
        },
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    });
  });

  it('filters model-incompatible image sources before describing a page', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/logo.svg',
          'https://example.com/photo.jpg',
          'https://example.com/logo.svg',
        ],
      }),
    };
    const describeImage = jest
      .fn()
      .mockImplementation(async (imageUrl) => ({
        description: `description for ${imageUrl}`,
        imageUrl,
      }));
    const imageDescriberFactory = new ImageDescriberFactory().register('azure', {
      describeImage,
      filterSupportedImageSources: jest.fn((imageSources) => imageSources
        .filter((imageSource) => !imageSource.endsWith('.svg'))),
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
    });

    const result = await service.describePage({
      pageUrl: 'https://example.com/page',
      model: 'azure',
    });

    expect(describeImage).toHaveBeenCalledTimes(1);
    expect(describeImage).toHaveBeenCalledWith('https://example.com/photo.jpg');
    expect(result).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'azure',
      totalImages: 1,
      uniqueImages: 1,
      descriptions: [
        {
          description: 'description for https://example.com/photo.jpg',
          imageUrl: 'https://example.com/photo.jpg',
        },
      ],
    });
  });

  it('skips image-specific provider failures during page descriptions', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/a.jpg',
          'https://example.com/missing.jpg',
          'https://example.com/a.jpg',
        ],
      }),
    };
    const imageError = new Error('image unavailable');
    const describeImage = jest.fn().mockImplementation(async (imageUrl) => {
      if (imageUrl === 'https://example.com/missing.jpg') {
        throw imageError;
      }

      return {
        description: `description for ${imageUrl}`,
        imageUrl,
      };
    });
    const shouldSkipDescriptionError = jest.fn((error) => error === imageError);
    const imageDescriberFactory = new ImageDescriberFactory().register('azure', {
      describeImage,
      shouldSkipDescriptionError,
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
    });

    const result = await service.describePage({
      pageUrl: 'https://example.com/page',
      model: 'azure',
    });

    expect(describeImage).toHaveBeenCalledTimes(2);
    expect(shouldSkipDescriptionError).toHaveBeenCalledWith(imageError);
    expect(result).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'azure',
      totalImages: 2,
      uniqueImages: 1,
      descriptions: [
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
        {
          description: 'description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    });
  });

  it('still fails page descriptions on non-skippable provider errors', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: ['https://example.com/a.jpg'],
      }),
    };
    const fatalError = new Error('provider unavailable');
    const imageDescriberFactory = new ImageDescriberFactory().register('azure', {
      describeImage: jest.fn().mockRejectedValue(fatalError),
      shouldSkipDescriptionError: jest.fn(() => false),
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
    });

    await expect(service.describePage({
      pageUrl: 'https://example.com/page',
      model: 'azure',
    })).rejects.toThrow('provider unavailable');
  });

  it('limits concurrent provider calls while preserving output order', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/a.jpg',
          'https://example.com/b.jpg',
          'https://example.com/c.jpg',
        ],
      }),
    };
    let inFlight = 0;
    let maxInFlight = 0;
    const describeImage = jest.fn().mockImplementation(async (imageUrl) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      inFlight -= 1;
      return {
        description: `description for ${imageUrl}`,
        imageUrl,
      };
    });
    const imageDescriberFactory = new ImageDescriberFactory().register('replicate', {
      describeImage,
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
      concurrency: 2,
    });

    const result = await service.describePage({
      pageUrl: 'https://example.com/page',
      model: 'replicate',
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(result.descriptions.map((item) => item.imageUrl)).toEqual([
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
      'https://example.com/c.jpg',
    ]);
  });

  it('waits for async-capable provider jobs when describing a page in async mode', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/a.jpg',
          'https://example.com/b.jpg',
          'https://example.com/a.jpg',
        ],
      }),
    };
    const createDescriptionJob = jest
      .fn()
      .mockImplementation(async (imageUrl) => ({
        providerJobId: `job:${imageUrl}`,
        imageUrl,
        status: 'processing',
      }));
    const getDescriptionJob = jest
      .fn()
      .mockImplementation(async (providerJobId, imageUrl) => ({
        providerJobId,
        imageUrl,
        status: 'succeeded',
        result: {
          description: `async description for ${imageUrl}`,
          imageUrl,
        },
      }));
    const imageDescriberFactory = new ImageDescriberFactory().register('replicate', {
      createDescriptionJob,
      getDescriptionJob,
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
      asyncPollIntervalMs: 1,
      sleep: jest.fn().mockResolvedValue(undefined),
    });

    const result = await service.describePageWithAsyncJobs({
      pageUrl: 'https://example.com/page',
      model: 'replicate',
    });

    expect(createDescriptionJob).toHaveBeenCalledTimes(2);
    expect(getDescriptionJob).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'replicate',
      totalImages: 3,
      uniqueImages: 2,
      descriptions: [
        {
          description: 'async description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
        {
          description: 'async description for https://example.com/b.jpg',
          imageUrl: 'https://example.com/b.jpg',
        },
        {
          description: 'async description for https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    });
  });

  it('falls back to synchronous image descriptions when async mode is requested for a sync provider', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: ['https://example.com/a.jpg'],
      }),
    };
    const describeImage = jest.fn().mockResolvedValue({
      description: 'sync fallback',
      imageUrl: 'https://example.com/a.jpg',
    });
    const imageDescriberFactory = new ImageDescriberFactory().register('azure', {
      describeImage,
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
    });

    const result = await service.describePageWithAsyncJobs({
      pageUrl: 'https://example.com/page',
      model: 'azure',
    });

    expect(describeImage).toHaveBeenCalledWith('https://example.com/a.jpg');
    expect(result).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'azure',
      totalImages: 1,
      uniqueImages: 1,
      descriptions: [
        {
          description: 'sync fallback',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    });
  });

  it('supports caller-provided image resolvers for page job orchestration', async () => {
    const scraperService = {
      getImages: jest.fn().mockResolvedValue({
        imageSources: [
          'https://example.com/a.jpg',
          'https://example.com/a.jpg',
        ],
      }),
    };
    const imageDescriberFactory = new ImageDescriberFactory().register('replicate', {});
    const describeImage = jest.fn().mockImplementation(async (imageUrl) => ({
      description: `resolved by job ${imageUrl}`,
      imageUrl,
    }));
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
    });

    const result = await service.describePageWithResolver({
      pageUrl: 'https://example.com/page',
      model: 'replicate',
      describeImage,
    });

    expect(describeImage).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'replicate',
      totalImages: 2,
      uniqueImages: 1,
      descriptions: [
        {
          description: 'resolved by job https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
        {
          description: 'resolved by job https://example.com/a.jpg',
          imageUrl: 'https://example.com/a.jpg',
        },
      ],
    });
  });
});
