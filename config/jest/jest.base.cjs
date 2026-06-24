const path = require('node:path');

// Repo root, two levels up from config/jest/.
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const JEST_CONFIG_DIR = __dirname;

// Shared lifecycle (env + mock restoration) every lane inherits, so the cleanup
// cannot drift between lanes or be forgotten in a single suite.
const JEST_SETUP_FILE = path.join(ROOT_DIR, 'tests', 'setup', 'jest.setup.js');

// Coverage gate shared by the coverage and CI lanes so the threshold is
// identical regardless of which entry point enforces it.
const COVERAGE_COLLECTION_PATTERNS = [
  'src/**/*.js',
  'config/**/*.js',
  'scripts/run-postman-deploy.js',
  'scripts/run-postman-live.js',
  'scripts/postman-fixture-server.js',
  'scripts/github/promote-to-production.js',
  '!**/node_modules/**',
  '!coverage/**',
  '!reports/**',
  '!tests/**',
];

const COVERAGE_PATH_IGNORE_PATTERNS = [
  '/node_modules/',
  '<rootDir>/coverage/',
  '<rootDir>/reports/',
  '<rootDir>/tests/',
];

const COVERAGE_THRESHOLD = {
  global: {
    statements: 80,
    lines: 80,
    functions: 80,
    branches: 70,
  },
  './scripts/github/promote-to-production.js': {
    statements: 47,
    branches: 56,
    functions: 42,
    lines: 47,
  },
  './scripts/postman-fixture-server.js': {
    statements: 60,
    branches: 41,
    functions: 59,
    lines: 60,
  },
  './scripts/run-postman-deploy.js': {
    statements: 70,
    branches: 62,
    functions: 62,
    lines: 71,
  },
  './scripts/run-postman-live.js': {
    statements: 25,
    branches: 12,
    functions: 14,
    lines: 25,
  },
  './src/server/serverFunctions.js': {
    statements: 78,
    branches: 44,
    functions: 62,
    lines: 80,
  },
  './src/server/startApplicationRuntime.js': {
    statements: 82,
    branches: 45,
    functions: 20,
    lines: 85,
  },
  './src/services/ReplicateDescriberService.js': {
    statements: 76,
    branches: 63,
    functions: 75,
    lines: 77,
  },
};

// Single source of truth for per-lane test selection. The standalone lane
// configs and the composite (coverage/CI/reporting) configs both read from
// here so the tiers can never drift apart.
//
// Redis-backed specs use the `*.redis.test.js` suffix so the dedicated redis
// lane owns them by convention: a new Redis spec joins the lane just by being
// named, and no lane list has to be hand-edited.
const REDIS_INTEGRATION_TEST_GLOB = '<rootDir>/tests/integration/**/*.redis.test.js';

const TEST_MATCH = {
  unit: ['<rootDir>/tests/unit/**/*.test.js'],
  // Top-level integration specs only: script/git specs live in a subdirectory
  // and Redis-backed specs (the `.redis.test.js` suffix) run in their own lane.
  integration: ['<rootDir>/tests/integration/*.test.js'],
  redis: [REDIS_INTEGRATION_TEST_GLOB],
  scripts: ['<rootDir>/tests/integration/scripts/**/*.test.js'],
};

// The general integration lane must skip every Redis-backed spec, which needs a
// Redis endpoint and runs in the dedicated redis lane instead.
const INTEGRATION_IGNORE_PATTERNS = [
  '/node_modules/',
  '<rootDir>/tests/integration/.*\\.redis\\.test\\.js$',
];

// Allure generation is reserved for the CI and reporting lanes: it only turns
// on when ALLURE_RESULTS_DIR is provided. Every other lane runs on the plain
// node environment for deterministic, dependency-free feedback.
function resolveTestEnvironment() {
  const allureResultsDir = process.env.ALLURE_RESULTS_DIR?.trim();

  if (!allureResultsDir) {
    return { testEnvironment: 'node' };
  }

  return {
    testEnvironment: 'allure-jest/node',
    testEnvironmentOptions: {
      resultsDir: path.resolve(ROOT_DIR, allureResultsDir),
    },
  };
}

// Build a standalone lane config. Each lane pins rootDir to the repo root so
// paths resolve identically whether Jest is launched from the root config or
// from one of the config/jest/* lane configs.
function createLaneConfig({
  displayName,
  testMatch,
  testPathIgnorePatterns,
}) {
  const config = {
    rootDir: ROOT_DIR,
    displayName,
    testMatch,
    setupFilesAfterEnv: [JEST_SETUP_FILE],
    ...resolveTestEnvironment(),
  };

  if (testPathIgnorePatterns) {
    config.testPathIgnorePatterns = testPathIgnorePatterns;
  }

  return config;
}

const LANE_CONFIG_PATH = {
  unit: path.join(JEST_CONFIG_DIR, 'jest.unit.cjs'),
  integration: path.join(JEST_CONFIG_DIR, 'jest.integration.cjs'),
  redis: path.join(JEST_CONFIG_DIR, 'jest.integration.redis.cjs'),
  scripts: path.join(JEST_CONFIG_DIR, 'jest.integration.scripts.cjs'),
};

// Tiers every composite lane (coverage, CI, reporting) runs, in order. Each is
// loaded as a Jest project so failures stay labelled by their lane.
const COMPOSED_LANES = [
  LANE_CONFIG_PATH.unit,
  LANE_CONFIG_PATH.integration,
  LANE_CONFIG_PATH.redis,
  LANE_CONFIG_PATH.scripts,
];

module.exports = {
  ROOT_DIR,
  JEST_SETUP_FILE,
  COVERAGE_COLLECTION_PATTERNS,
  COVERAGE_PATH_IGNORE_PATTERNS,
  COVERAGE_THRESHOLD,
  TEST_MATCH,
  INTEGRATION_IGNORE_PATTERNS,
  LANE_CONFIG_PATH,
  COMPOSED_LANES,
  resolveTestEnvironment,
  createLaneConfig,
};
