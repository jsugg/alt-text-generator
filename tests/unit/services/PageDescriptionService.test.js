const PageDescriptionService = require('../../../src/services/PageDescriptionService');
const ImageDescriberFactory = require('../../../src/services/ImageDescriberFactory');

describe('PageDescriptionService', () => {
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
    const imageDescriberFactory = new ImageDescriberFactory().register('clip', {
      describeImage,
    });
    const service = new PageDescriptionService({
      scraperService,
      imageDescriberFactory,
    });

    const result = await service.describePage({
      pageUrl: 'https://example.com/page',
      model: 'clip',
    });

    expect(scraperService.getImages).toHaveBeenCalledWith('https://example.com/page');
    expect(describeImage).toHaveBeenCalledTimes(2);
    expect(describeImage).toHaveBeenNthCalledWith(1, 'https://example.com/a.jpg');
    expect(describeImage).toHaveBeenNthCalledWith(2, 'https://example.com/b.jpg');
    expect(result).toEqual({
      pageUrl: 'https://example.com/page',
      model: 'clip',
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
});
