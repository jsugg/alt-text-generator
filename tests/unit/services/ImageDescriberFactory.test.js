const ImageDescriberFactory = require('../../../src/services/ImageDescriberFactory');

const mockDescriber = { describeImage: jest.fn() };
const mockAzureDescriber = { describeImage: jest.fn() };

describe('Unit | Services | Image Describer Factory', () => {
  it('returns a registered describer by name', () => {
    const factory = new ImageDescriberFactory().register('replicate', mockDescriber);
    expect(factory.get('replicate')).toBe(mockDescriber);
  });

  it('supports chained registration', () => {
    const factory = new ImageDescriberFactory()
      .register('replicate', mockDescriber)
      .register('azure', mockAzureDescriber);
    expect(factory.get('replicate')).toBe(mockDescriber);
    expect(factory.get('azure')).toBe(mockAzureDescriber);
  });

  it('throws a descriptive error for an unknown model', () => {
    const factory = new ImageDescriberFactory().register('replicate', mockDescriber);
    expect(() => factory.get('gpt4')).toThrow("Unknown model 'gpt4'. Available models: replicate");
  });

  it('lists available models', () => {
    const factory = new ImageDescriberFactory()
      .register('replicate', mockDescriber)
      .register('azure', mockAzureDescriber);
    expect(factory.getAvailableModels()).toEqual(['replicate', 'azure']);
  });

  it('returns empty array when no models registered', () => {
    const factory = new ImageDescriberFactory();
    expect(factory.getAvailableModels()).toEqual([]);
  });
});
