#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const execFileAsync = promisify(execFile);

/**
 * Parses CLI arguments.
 *
 * @param {string[]} argv
 * @returns {{
 *   artifactName: string,
 *   githubOutput: string | null,
 *   historyKey: string,
 *   resultsDir: string,
 * }}
 */
function parseArgs(argv) {
  let artifactName = null;
  let githubOutput = null;
  let historyKey = null;
  let resultsDir = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--artifact-name') {
      artifactName = argv[index + 1] || null;
      index += 1;
    } else if (token === '--github-output') {
      githubOutput = argv[index + 1] || null;
      index += 1;
    } else if (token === '--history-key') {
      historyKey = argv[index + 1] || null;
      index += 1;
    } else if (token === '--results-dir') {
      resultsDir = argv[index + 1] || null;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!artifactName) {
    throw new Error('Missing required argument: --artifact-name <name>');
  }

  if (!historyKey) {
    throw new Error('Missing required argument: --history-key <key>');
  }

  if (!resultsDir) {
    throw new Error('Missing required argument: --results-dir <path>');
  }

  return {
    artifactName,
    githubOutput,
    historyKey,
    resultsDir: path.resolve(process.cwd(), resultsDir),
  };
}

/**
 * Builds a GitHub API URL.
 *
 * @param {string} apiBaseUrl
 * @param {string} pathname
 * @param {Record<string, string>} [query]
 * @returns {string}
 */
function buildApiUrl(apiBaseUrl, pathname, query = {}) {
  const url = new URL(pathname, apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`);
  Object.entries(query).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });
  return url.toString();
}

/**
 * Fetches JSON from the GitHub API.
 *
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   token: string,
 *   url: string,
 * }} options
 * @returns {Promise<any>}
 */
async function fetchGitHubJson({
  fetchImpl = fetch,
  token,
  url,
}) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'alt-text-generator-allure-history',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed with status ${response.status}`);
  }

  return response.json();
}

/**
 * Lists matching repository artifacts.
 *
 * @param {{
 *   apiBaseUrl?: string,
 *   artifactName: string,
 *   fetchImpl?: typeof fetch,
 *   repository: string,
 *   token: string,
 * }} options
 * @returns {Promise<Array<{
 *   archive_download_url: string,
 *   created_at: string,
 *   expired: boolean,
 *   id: number,
 *   name: string,
 *   workflow_run?: { id?: number },
 * }>>}
 */
async function listArtifactsForName({
  apiBaseUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
  artifactName,
  fetchImpl = fetch,
  repository,
  token,
}) {
  const collectPage = async (page, artifacts = []) => {
    const response = await fetchGitHubJson({
      fetchImpl,
      token,
      url: buildApiUrl(apiBaseUrl, `/repos/${repository}/actions/artifacts`, {
        name: artifactName,
        page: String(page),
        per_page: '100',
      }),
    });
    const nextArtifacts = artifacts.concat(
      Array.isArray(response.artifacts) ? response.artifacts : [],
    );
    const nextTotalCount = typeof response.total_count === 'number'
      ? response.total_count
      : nextArtifacts.length;

    if (
      !response.artifacts
      || response.artifacts.length === 0
      || nextArtifacts.length >= nextTotalCount
    ) {
      return nextArtifacts;
    }

    return collectPage(page + 1, nextArtifacts);
  };

  return collectPage(1);
}

/**
 * Selects the newest eligible artifact for restoration.
 *
 * @param {{
 *   artifacts: Array<{
 *     archive_download_url: string,
 *     created_at: string,
 *     expired: boolean,
 *     id: number,
 *     name: string,
 *     workflow_run?: { id?: number },
 *   }>,
 *   currentRunId?: string,
 * }} options
 * @returns {{
 *   archive_download_url: string,
 *   created_at: string,
 *   expired: boolean,
 *   id: number,
 *   name: string,
 *   workflow_run?: { id?: number },
 * } | null}
 */
function selectArtifact({
  artifacts,
  currentRunId = process.env.GITHUB_RUN_ID || '',
}) {
  const currentRunIdNumber = Number(currentRunId);

  return [...artifacts]
    .filter((artifact) => !artifact.expired)
    .filter((artifact) => artifact.workflow_run?.id !== currentRunIdNumber)
    .sort((left, right) => (
      new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    ))[0] || null;
}

/**
 * Downloads a repository artifact archive.
 *
 * @param {{
 *   artifact: { archive_download_url: string },
 *   destinationPath: string,
 *   fetchImpl?: typeof fetch,
 *   token: string,
 * }} options
 * @returns {Promise<void>}
 */
async function downloadArtifactArchive({
  artifact,
  destinationPath,
  fetchImpl = fetch,
  token,
}) {
  const initialResponse = await fetchImpl(artifact.archive_download_url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'alt-text-generator-allure-history',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'manual',
  });

  const downloadUrl = initialResponse.headers.get('location');
  const archiveUrl = downloadUrl || artifact.archive_download_url;
  const archiveResponse = await fetchImpl(archiveUrl, {
    headers: downloadUrl ? undefined : {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'alt-text-generator-allure-history',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'follow',
  });

  if (!archiveResponse.ok) {
    throw new Error(`Artifact download failed with status ${archiveResponse.status}`);
  }

  await fs.writeFile(destinationPath, Buffer.from(await archiveResponse.arrayBuffer()));
}

/**
 * Extracts a zip archive into the target directory.
 *
 * @param {{
 *   archivePath: string,
 *   execFileImpl?: typeof execFileAsync,
 *   outputDir: string,
 * }} options
 * @returns {Promise<void>}
 */
async function extractArchive({
  archivePath,
  execFileImpl = execFileAsync,
  outputDir,
}) {
  await execFileImpl('unzip', ['-qq', archivePath, '-d', outputDir]);
}

/**
 * Reads and validates the history artifact manifest.
 *
 * @param {{
 *   extractedDir: string,
 *   expectedHistoryKey: string,
 * }} options
 * @returns {Promise<Record<string, unknown>>}
 */
async function readArtifactManifest({
  extractedDir,
  expectedHistoryKey,
}) {
  const manifestPath = path.join(extractedDir, 'manifest.json');
  const manifestContent = await fs.readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  if (manifest.historyKey !== expectedHistoryKey) {
    throw new Error(
      `History artifact manifest expected historyKey=${expectedHistoryKey} but received ${manifest.historyKey}`,
    );
  }

  return manifest;
}

/**
 * Copies the restored history directory into the current results directory.
 *
 * @param {{
 *   extractedDir: string,
 *   resultsDir: string,
 * }} options
 * @returns {Promise<void>}
 */
async function copyHistoryIntoResults({
  extractedDir,
  resultsDir,
}) {
  const sourceHistoryDir = path.join(extractedDir, 'history');
  const destinationHistoryDir = path.join(resultsDir, 'history');

  await fs.access(sourceHistoryDir);
  await fs.rm(destinationHistoryDir, { force: true, recursive: true });
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.cp(sourceHistoryDir, destinationHistoryDir, { recursive: true });
}

/**
 * Serializes GitHub Actions outputs.
 *
 * @param {Record<string, string>} values
 * @returns {string}
 */
function toOutputLines(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

/**
 * Restores Allure history from the most recent matching artifact stream.
 *
 * @param {{
 *   apiBaseUrl?: string,
 *   artifactName: string,
 *   currentRunId?: string,
 *   execFileImpl?: typeof execFileAsync,
 *   fetchImpl?: typeof fetch,
 *   historyKey: string,
 *   logger?: Pick<Console, 'info' | 'warn'>,
 *   repository?: string,
 *   resultsDir: string,
 *   token?: string,
 * }} options
 * @returns {Promise<{
 *   artifactId: string,
 *   restored: boolean,
 *   source: string,
 * }>}
 */
async function restoreAllureHistoryFromArtifact({
  apiBaseUrl = process.env.GITHUB_API_URL || 'https://api.github.com',
  artifactName,
  currentRunId = process.env.GITHUB_RUN_ID || '',
  downloadArtifactArchiveImpl = downloadArtifactArchive,
  execFileImpl = execFileAsync,
  extractArchiveImpl = extractArchive,
  fetchImpl = fetch,
  historyKey,
  listArtifactsForNameImpl = listArtifactsForName,
  logger = console,
  repository = process.env.GITHUB_REPOSITORY || '',
  resultsDir,
  token = process.env.GITHUB_TOKEN || '',
}) {
  if (!artifactName || !historyKey || !repository || !token) {
    logger.warn?.('Artifact-backed Allure history restore is missing repository, token, artifact name, or history key; skipping.');
    return {
      artifactId: '',
      restored: false,
      source: 'none',
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'allure-history-artifact-'));
  const archivePath = path.join(tempDir, 'artifact.zip');
  const extractDir = path.join(tempDir, 'extract');

  try {
    const artifacts = await listArtifactsForNameImpl({
      apiBaseUrl,
      artifactName,
      fetchImpl,
      repository,
      token,
    });
    const artifact = selectArtifact({
      artifacts,
      currentRunId,
    });

    if (!artifact) {
      logger.info?.(`No prior Allure history artifact named ${artifactName} was found.`);
      return {
        artifactId: '',
        restored: false,
        source: 'none',
      };
    }

    await fs.mkdir(extractDir, { recursive: true });
    await downloadArtifactArchiveImpl({
      artifact,
      destinationPath: archivePath,
      fetchImpl,
      token,
    });
    await extractArchiveImpl({
      archivePath,
      execFileImpl,
      outputDir: extractDir,
    });
    await readArtifactManifest({
      extractedDir: extractDir,
      expectedHistoryKey: historyKey,
    });
    await copyHistoryIntoResults({
      extractedDir: extractDir,
      resultsDir,
    });

    logger.info?.(`Restored Allure history from artifact ${artifact.name} (${artifact.id}).`);

    return {
      artifactId: String(artifact.id),
      restored: true,
      source: 'artifact',
    };
  } catch (error) {
    logger.warn?.(
      `Unable to restore Allure history from artifact ${artifactName}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      artifactId: '',
      restored: false,
      source: 'none',
    };
  } finally {
    await fs.rm(tempDir, { force: true, recursive: true });
  }
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));

  restoreAllureHistoryFromArtifact({
    artifactName: options.artifactName,
    historyKey: options.historyKey,
    resultsDir: options.resultsDir,
  })
    .then((result) => {
      const serializedResult = toOutputLines({
        artifact_id: result.artifactId,
        restored: String(result.restored),
        source: result.source,
      });

      if (options.githubOutput) {
        return fs.appendFile(options.githubOutput, serializedResult, 'utf8')
          .then(() => {
            process.stdout.write(serializedResult);
          });
      }

      process.stdout.write(serializedResult);
      return undefined;
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  buildApiUrl,
  copyHistoryIntoResults,
  downloadArtifactArchive,
  extractArchive,
  fetchGitHubJson,
  listArtifactsForName,
  parseArgs,
  readArtifactManifest,
  restoreAllureHistoryFromArtifact,
  selectArtifact,
  toOutputLines,
};
