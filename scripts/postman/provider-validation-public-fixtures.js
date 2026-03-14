const DEFAULT_PUBLIC_FIXTURE_REPOSITORY = 'jsugg/alt-text-generator';
const DEFAULT_PUBLIC_FIXTURE_REF = 'main';
const DEFAULT_PUBLIC_FIXTURE_IMAGE_PATH = 'tests/fixtures/provider-validation/public/assets/a.png';
const DEFAULT_PUBLIC_FIXTURE_PAGE_PATH = 'tests/fixtures/provider-validation/public/page.html';

const REPO_SLUG_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * @param {string} value
 * @param {string} label
 * @returns {string}
 */
function normalizeRequiredValue(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a non-empty string`);
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new Error(`${label} must be a non-empty string`);
  }

  return normalizedValue;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRepositorySlug(value) {
  const repository = normalizeRequiredValue(value, 'provider validation public repository');

  if (!REPO_SLUG_PATTERN.test(repository)) {
    throw new Error(
      'provider validation public repository must use the "<owner>/<repo>" format',
    );
  }

  return repository;
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRepositoryRef(value) {
  return normalizeRequiredValue(value, 'provider validation public ref');
}

/**
 * @param {{
 *   repository?: string | undefined,
 *   ref?: string | undefined,
 * }} [options]
 * @returns {{ repository: string, ref: string }}
 */
function resolvePublicFixtureRepositoryContext(options = {}) {
  const repository = normalizeRepositorySlug(
    options.repository
      || process.env.PROVIDER_VALIDATION_PUBLIC_REPOSITORY
      || process.env.GITHUB_REPOSITORY
      || DEFAULT_PUBLIC_FIXTURE_REPOSITORY,
  );
  const ref = normalizeRepositoryRef(
    options.ref
      || process.env.PROVIDER_VALIDATION_PUBLIC_REF
      || process.env.GITHUB_SHA
      || DEFAULT_PUBLIC_FIXTURE_REF,
  );

  return { repository, ref };
}

/**
 * @param {{ repository: string, ref: string, relativePath: string }} params
 * @returns {string}
 */
function buildRawGitHubUrl({ repository, ref, relativePath }) {
  const normalizedRelativePath = normalizeRequiredValue(
    relativePath,
    'provider validation relative path',
  );
  const encodedPath = normalizedRelativePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `https://raw.githubusercontent.com/${repository}/${encodeURIComponent(ref)}/${encodedPath}`;
}

/**
 * @param {{
 *   repository?: string | undefined,
 *   ref?: string | undefined,
 * }} [options]
 * @returns {{
 *   providerValidationAzureImageUrl: string,
 *   providerValidationAzurePageUrl: string,
 *   providerValidationImageUrl: string,
 *   providerValidationPageUrl: string,
 * }}
 */
function buildPublicProviderValidationFixtureUrls(options = {}) {
  const { repository, ref } = resolvePublicFixtureRepositoryContext(options);

  const providerValidationImageUrl = buildRawGitHubUrl({
    repository,
    ref,
    relativePath: DEFAULT_PUBLIC_FIXTURE_IMAGE_PATH,
  });
  const providerValidationPageUrl = buildRawGitHubUrl({
    repository,
    ref,
    relativePath: DEFAULT_PUBLIC_FIXTURE_PAGE_PATH,
  });

  return {
    providerValidationImageUrl,
    providerValidationPageUrl,
    providerValidationAzureImageUrl: providerValidationImageUrl,
    providerValidationAzurePageUrl: providerValidationPageUrl,
  };
}

module.exports = {
  DEFAULT_PUBLIC_FIXTURE_IMAGE_PATH,
  DEFAULT_PUBLIC_FIXTURE_PAGE_PATH,
  DEFAULT_PUBLIC_FIXTURE_REF,
  DEFAULT_PUBLIC_FIXTURE_REPOSITORY,
  buildPublicProviderValidationFixtureUrls,
  buildRawGitHubUrl,
  normalizeRepositoryRef,
  normalizeRepositorySlug,
  resolvePublicFixtureRepositoryContext,
};
