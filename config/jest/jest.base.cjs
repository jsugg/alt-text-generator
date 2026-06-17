const path = require('node:path');

// Repo root, two levels up from config/jest/.
const ROOT_DIR = path.resolve(__dirname, '..', '..');
const JEST_CONFIG_DIR = __dirname;

// Coverage gate shared by the coverage and CI lanes so the threshold is
// identical regardless of which entry point enforces it.
const COVERAGE_THRESHOLD = {
  global: {
    lines: 80,
    functions: 80,
    branches: 70,
  },
};

// Single source of truth for per-lane test selection. The standalone lane
// configs and the composite (coverage/CI/reporting) configs both read from
// here so the tiers can never drift apart.
const REDIS_INTEGRATION_TEST = '<rootDir>/tests/integration/rateLimitRedis.test.js';

const TEST_MATCH = {
  unit: ['<rootDir>/tests/unit/**/*.test.js'],
  // Top-level integration specs only: script/git specs live in a subdirectory
  // and Redis-backed specs run in their own lane.
  integration: ['<rootDir>/tests/integration/*.test.js'],
  redis: [REDIS_INTEGRATION_TEST],
  scripts: ['<rootDir>/tests/integration/scripts/**/*.test.js'],
};

// The general integration lane must skip the Redis-backed spec, which needs a
// redis-server binary and runs in the dedicated redis lane instead.
const INTEGRATION_IGNORE_PATTERNS = [
  '/node_modules/',
  '<rootDir>/tests/integration/rateLimitRedis\\.test\\.js$',
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
  testTimeout,
}) {
  const config = {
    rootDir: ROOT_DIR,
    displayName,
    testMatch,
    collectCoverage: false,
    ...resolveTestEnvironment(),
  };

  if (testPathIgnorePatterns) {
    config.testPathIgnorePatterns = testPathIgnorePatterns;
  }

  if (typeof testTimeout === 'number') {
    config.testTimeout = testTimeout;
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
  COVERAGE_THRESHOLD,
  TEST_MATCH,
  INTEGRATION_IGNORE_PATTERNS,
  LANE_CONFIG_PATH,
  COMPOSED_LANES,
  resolveTestEnvironment,
  createLaneConfig,
};
