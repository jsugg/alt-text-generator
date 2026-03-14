const {
  DEFAULT_PUBLIC_FIXTURE_IMAGE_PATH,
  DEFAULT_PUBLIC_FIXTURE_PAGE_PATH,
  buildPublicProviderValidationFixtureUrls,
  buildRawGitHubUrl,
  resolvePublicFixtureRepositoryContext,
} = require('../../../../scripts/postman/provider-validation-public-fixtures');

describe('Unit | Scripts | Postman | Provider Validation Public Fixtures', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('builds raw GitHub urls for the default repository and ref', () => {
    expect(buildPublicProviderValidationFixtureUrls({
      repository: 'jsugg/alt-text-generator',
      ref: 'main',
    })).toEqual({
      providerValidationImageUrl: `https://raw.githubusercontent.com/jsugg/alt-text-generator/main/${encodeURIComponent(DEFAULT_PUBLIC_FIXTURE_IMAGE_PATH).replace(/%2F/g, '/')}`,
      providerValidationPageUrl: `https://raw.githubusercontent.com/jsugg/alt-text-generator/main/${encodeURIComponent(DEFAULT_PUBLIC_FIXTURE_PAGE_PATH).replace(/%2F/g, '/')}`,
      providerValidationAzureImageUrl: `https://raw.githubusercontent.com/jsugg/alt-text-generator/main/${encodeURIComponent(DEFAULT_PUBLIC_FIXTURE_IMAGE_PATH).replace(/%2F/g, '/')}`,
      providerValidationAzurePageUrl: `https://raw.githubusercontent.com/jsugg/alt-text-generator/main/${encodeURIComponent(DEFAULT_PUBLIC_FIXTURE_PAGE_PATH).replace(/%2F/g, '/')}`,
    });
  });

  it('prefers GitHub repository context when it is available', () => {
    process.env.GITHUB_REPOSITORY = 'octo/example';
    process.env.GITHUB_SHA = '0123456789abcdef';

    expect(resolvePublicFixtureRepositoryContext()).toEqual({
      repository: 'octo/example',
      ref: '0123456789abcdef',
    });
  });

  it('rejects invalid repository slugs', () => {
    expect(() => resolvePublicFixtureRepositoryContext({
      repository: 'not a slug',
      ref: 'main',
    })).toThrow(
      'provider validation public repository must use the "<owner>/<repo>" format',
    );
  });

  it('encodes raw GitHub paths without altering path separators', () => {
    expect(buildRawGitHubUrl({
      repository: 'octo/example',
      ref: 'abc123',
      relativePath: 'a folder/file #1.png',
    })).toBe(
      'https://raw.githubusercontent.com/octo/example/abc123/a%20folder/file%20%231.png',
    );
  });
});
