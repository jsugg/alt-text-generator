const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '../..');
const LANE_DIR = path.join(ROOT_DIR, 'config', 'jest');

function loadLaneConfig(fileName) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(path.join(LANE_DIR, fileName));
}

describe('Unit | Jest Lane Configs', () => {
  it('keeps the unit lane fast and coverage-free', () => {
    const config = loadLaneConfig('jest.unit.cjs');

    expect(config.displayName).toBe('unit');
    expect(config.rootDir).toBe(ROOT_DIR);
    expect(config.collectCoverage).toBe(false);
    expect(config.testMatch).toEqual(['<rootDir>/tests/unit/**/*.test.js']);
  });

  it('excludes the Redis spec from the general integration lane', () => {
    const config = loadLaneConfig('jest.integration.cjs');

    expect(config.displayName).toBe('integration');
    expect(config.testMatch).toEqual(['<rootDir>/tests/integration/*.test.js']);
    expect(config.testPathIgnorePatterns).toEqual(
      expect.arrayContaining([expect.stringContaining('rateLimitRedis')]),
    );
  });

  it('targets only the Redis spec in the redis lane', () => {
    const config = loadLaneConfig('jest.integration.redis.cjs');

    expect(config.displayName).toBe('redis');
    expect(config.testMatch).toEqual([
      '<rootDir>/tests/integration/rateLimitRedis.test.js',
    ]);
  });

  it('extends the timeout for the script/git integration lane', () => {
    const config = loadLaneConfig('jest.integration.scripts.cjs');

    expect(config.displayName).toBe('scripts');
    expect(config.testMatch).toEqual([
      '<rootDir>/tests/integration/scripts/**/*.test.js',
    ]);
    expect(config.testTimeout).toBe(30000);
  });

  it('composes every tier and enforces the gate in the coverage lane', () => {
    const config = loadLaneConfig('jest.coverage.cjs');

    expect(config.projects).toHaveLength(4);
    expect(config.collectCoverage).toBe(true);
    expect(config.coverageThreshold.global.lines).toBe(80);
    expect(config.reporters).toBeUndefined();
  });

  it('composes every tier and emits JUnit in the CI lane', () => {
    const config = loadLaneConfig('jest.ci.cjs');

    expect(config.projects).toHaveLength(4);
    expect(config.collectCoverage).toBe(true);
    expect(config.reporters).toEqual(['default', 'jest-junit']);
  });
});
