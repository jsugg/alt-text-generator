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
});
