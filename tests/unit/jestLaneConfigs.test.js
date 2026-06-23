const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const {
  assertDeepEqualInvariant,
  assertEqualInvariant,
  assertExpressionContainsInvariant,
  assertNoRunCommandContainsInvariant,
  assertStepUsesAction,
  findStepByName,
  getJob,
  loadWorkflow,
} = require('../helpers/workflowAssertions');

const ROOT_DIR = path.resolve(__dirname, '../..');
const LANE_DIR = path.join(ROOT_DIR, 'config', 'jest');
const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const DEVELOPMENT_PATH = path.join(ROOT_DIR, 'DEVELOPMENT.md');
const README_PATH = path.join(ROOT_DIR, 'README.md');
const REDIS_COMPOSE_PATH = path.join(ROOT_DIR, 'docker-compose.redis.yml');
const REDIS_INTEGRATION_TEST_PATH = path.join(ROOT_DIR, 'tests', 'integration', 'rateLimitRedis.redis.test.js');
const JEST_BIN_PATH = path.join(ROOT_DIR, 'node_modules', 'jest', 'bin', 'jest.js');
const {
  COVERAGE_COLLECTION_PATTERNS,
  COVERAGE_PATH_IGNORE_PATTERNS,
  COVERAGE_THRESHOLD,
} = require('../../config/jest/jest.base.cjs');

function loadLaneConfig(fileName) {
  // eslint-disable-next-line import/no-dynamic-require
  return require(path.join(LANE_DIR, fileName));
}

describe('Unit | Jest Lane Configs', () => {
  it('keeps the unit lane fast and coverage-free', () => {
    const config = loadLaneConfig('jest.unit.cjs');

    expect(config.displayName).toBe('unit');
    expect(config.rootDir).toBe(ROOT_DIR);
    expect(config).not.toHaveProperty('collectCoverage');
    expect(config.testMatch).toEqual(['<rootDir>/tests/unit/**/*.test.js']);
  });

  it('excludes Redis-suffixed specs from the general integration lane', () => {
    const config = loadLaneConfig('jest.integration.cjs');

    expect(config.displayName).toBe('integration');
    expect(config.testMatch).toEqual(['<rootDir>/tests/integration/*.test.js']);
    expect(config.testPathIgnorePatterns).toEqual(
      expect.arrayContaining([expect.stringContaining('\\.redis\\.test\\.js$')]),
    );
  });

  it('targets every Redis-suffixed spec in the redis lane', () => {
    const config = loadLaneConfig('jest.integration.redis.cjs');

    expect(config.displayName).toBe('redis');
    expect(config.testMatch).toEqual([
      '<rootDir>/tests/integration/**/*.redis.test.js',
    ]);
  });

  it('extends the timeout for the script/git integration lane', () => {
    const config = loadLaneConfig('jest.integration.scripts.cjs');
    const testFile = fs.readFileSync(
      path.join(
        ROOT_DIR,
        'tests',
        'integration',
        'scripts',
        'github',
        'syncPagesStateBranch.integration.test.js',
      ),
      'utf8',
    );

    expect(config.displayName).toBe('scripts');
    expect(config.testMatch).toEqual([
      '<rootDir>/tests/integration/scripts/**/*.test.js',
    ]);
    expect(config).not.toHaveProperty('testTimeout');
    expect(testFile).toContain('jest.setTimeout(30_000)');
  });

  it('composes every tier and enforces the gate in the coverage lane', () => {
    const config = loadLaneConfig('jest.coverage.cjs');

    expect(config.projects).toHaveLength(4);
    expect(config.collectCoverage).toBe(true);
    expect(config.collectCoverageFrom).toBe(COVERAGE_COLLECTION_PATTERNS);
    expect(config.coveragePathIgnorePatterns).toBe(COVERAGE_PATH_IGNORE_PATTERNS);
    expect(config.coverageThreshold).toBe(COVERAGE_THRESHOLD);
    expect(config.reporters).toBeUndefined();
  });

  it('composes every tier without reporters in the compatibility lane', () => {
    const config = loadLaneConfig('jest.all.cjs');

    expect(config.projects).toHaveLength(4);
    expect(config.collectCoverage).toBe(false);
    expect(config.reporters).toBeUndefined();
  });

  it('composes every tier and emits JUnit in the CI lane', () => {
    const config = loadLaneConfig('jest.ci.cjs');

    expect(config.projects).toHaveLength(4);
    expect(config.collectCoverage).toBe(true);
    expect(config.collectCoverageFrom).toBe(COVERAGE_COLLECTION_PATTERNS);
    expect(config.coveragePathIgnorePatterns).toBe(COVERAGE_PATH_IGNORE_PATTERNS);
    expect(config.coverageThreshold).toBe(COVERAGE_THRESHOLD);
    expect(config.reporters).toEqual(['default', 'jest-junit']);
  });

  it('keeps production coverage scoped away from test helpers', () => {
    expect(COVERAGE_COLLECTION_PATTERNS).toEqual(expect.arrayContaining([
      'src/**/*.js',
      'config/**/*.js',
      'scripts/run-postman-deploy.js',
      'scripts/run-postman-live.js',
      'scripts/postman-fixture-server.js',
      'scripts/github/promote-to-production.js',
      '!tests/**',
      '!coverage/**',
      '!reports/**',
    ]));
    expect(COVERAGE_PATH_IGNORE_PATTERNS).toEqual(expect.arrayContaining([
      '<rootDir>/tests/',
      '<rootDir>/coverage/',
      '<rootDir>/reports/',
    ]));
  });

  it('ratchets the QE critical runtime, provider, deploy, promotion, and Postman files', () => {
    expect(COVERAGE_THRESHOLD).toMatchObject({
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
    });
  });

  it('fails a critical-file coverage drop even when global coverage passes', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-coverage-gate-'));
    const criticalPath = './src/services/ReplicateDescriberService.js';
    const criticalThreshold = COVERAGE_THRESHOLD[criticalPath];

    try {
      fs.mkdirSync(path.join(tempDir, 'src', 'services'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });

      fs.writeFileSync(
        path.join(tempDir, 'src', 'services', 'ReplicateDescriberService.js'),
        [
          'function covered() { return "covered"; }',
          'function uncovered() { return "uncovered"; }',
          'module.exports = { covered, uncovered };',
          '',
        ].join('\n'),
      );

      const fillerFunctions = Array.from({ length: 100 }, (_value, index) => (
        `function covered${index}() { return ${index}; }`
      ));
      fs.writeFileSync(
        path.join(tempDir, 'src', 'filler.js'),
        [
          ...fillerFunctions,
          `module.exports = [${Array.from({ length: 100 }, (_value, index) => (
            `covered${index}`
          )).join(', ')}];`,
          '',
        ].join('\n'),
      );

      fs.writeFileSync(
        path.join(tempDir, 'tests', 'coverage.test.js'),
        [
          'const critical = require("../src/services/ReplicateDescriberService");',
          'const filler = require("../src/filler");',
          '',
          'test("keeps global coverage high while one critical file drops", () => {',
          '  expect(critical.covered()).toBe("covered");',
          '  expect(filler.reduce((sum, covered) => sum + covered(), 0)).toBe(4950);',
          '});',
          '',
        ].join('\n'),
      );

      fs.writeFileSync(
        path.join(tempDir, 'jest.config.cjs'),
        [
          'module.exports = {',
          '  testEnvironment: "node",',
          '  collectCoverage: true,',
          '  collectCoverageFrom: ["src/**/*.js"],',
          '  coverageReporters: ["json-summary", "text-summary"],',
          `  coverageThreshold: ${JSON.stringify({
            global: COVERAGE_THRESHOLD.global,
            [criticalPath]: { functions: criticalThreshold.functions },
          }, null, 4)},`,
          '};',
          '',
        ].join('\n'),
      );

      const result = spawnSync(
        process.execPath,
        [JEST_BIN_PATH, '--config', path.join(tempDir, 'jest.config.cjs'), '--runInBand'],
        {
          cwd: tempDir,
          encoding: 'utf8',
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      const summary = JSON.parse(fs.readFileSync(
        path.join(tempDir, 'coverage', 'coverage-summary.json'),
        'utf8',
      ));

      expect(result.status).toBe(1);
      expect(summary.total.statements.pct).toBeGreaterThan(COVERAGE_THRESHOLD.global.statements);
      expect(summary.total.lines.pct).toBeGreaterThan(COVERAGE_THRESHOLD.global.lines);
      expect(summary.total.functions.pct).toBeGreaterThan(COVERAGE_THRESHOLD.global.functions);
      expect(summary.total.branches.pct).toBeGreaterThan(COVERAGE_THRESHOLD.global.branches);
      expect(output).toContain(
        `Jest: "${criticalPath}" coverage threshold for functions `
        + `(${criticalThreshold.functions}%) not met`,
      );
    } finally {
      fs.rmSync(tempDir, { force: true, recursive: true });
    }
  });

  it('composes every tier without JUnit or coverage in the reporting lane', () => {
    const config = loadLaneConfig('jest.reporting.cjs');

    expect(config.projects).toHaveLength(4);
    expect(config.collectCoverage).toBe(false);
    expect(config.reporters).toBeUndefined();
  });

  it('keeps package scripts mapped to explicit Jest lane configs', () => {
    const { scripts } = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));

    expect(scripts['docs:validate']).toBe('node scripts/docs/validate-docs.js');
    expect(scripts.test).toBe('jest --config config/jest/jest.unit.cjs');
    expect(scripts['test:integration']).toBe('jest --config config/jest/jest.integration.cjs');
    expect(scripts['test:integration:redis']).toBe(
      'REDIS_INTEGRATION_MODE=required jest --config config/jest/jest.integration.redis.cjs',
    );
    expect(scripts['test:integration:scripts']).toBe(
      'jest --config config/jest/jest.integration.scripts.cjs --runInBand',
    );
    expect(scripts['test:all']).toBe('jest --config config/jest/jest.all.cjs');
    expect(scripts['test:coverage']).toBe(
      'REDIS_INTEGRATION_MODE=required jest --config config/jest/jest.coverage.cjs',
    );
    expect(scripts['test:ci']).toBe(
      'REDIS_INTEGRATION_MODE=required jest --config config/jest/jest.ci.cjs --ci',
    );
    expect(scripts['test:allure']).toBe(
      'ALLURE_RESULTS_DIR=reports/allure-results jest --config config/jest/jest.reporting.cjs',
    );
  });

  it('keeps CI topology split into fast unit matrix and canonical full gates', () => {
    const workflow = loadWorkflow('ci.yml');
    const docsJob = getJob(workflow, 'docs');
    const unitJob = getJob(workflow, 'test-unit');
    const testCiJob = getJob(workflow, 'test-ci');
    const newmanJob = getJob(workflow, 'newman');
    const unitStep = findStepByName(unitJob, 'test-unit', 'test:unit');
    const testCiStep = findStepByName(testCiJob, 'test-ci', 'test:ci');
    const uploadResultsStep = findStepByName(testCiJob, 'test-ci', 'Upload Jest test results');

    assertDeepEqualInvariant(
      'CI triggers main/production pushes and pull requests so docs-only changes receive docs validation',
      workflow.on,
      {
        push: { branches: ['main', 'production'] },
        pull_request: { branches: ['main', 'production'] },
      },
    );
    assertDeepEqualInvariant(
      'CI top-level GITHUB_TOKEN permissions remain read-only',
      workflow.permissions,
      { contents: 'read' },
    );
    assertDeepEqualInvariant(
      'CI workflow keeps the repository quality-gate job graph',
      Object.keys(workflow.jobs),
      [
        'changes',
        'docs',
        'actionlint',
        'lint',
        'openapi',
        'test-unit',
        'test-ci',
        'newman',
        'test-report',
        'allure-report',
        'allure-pages',
        'allure-pages-publish-dispatch',
        'ci-summary',
      ],
    );
    assertEqualInvariant(
      'CI docs validation publishes a stable required check',
      docsJob.name,
      'docs',
    );
    assertDeepEqualInvariant(
      'CI unit matrix covers every supported Node version with the fast lane only',
      unitJob.strategy.matrix['node-version'],
      ['20', '22', '24'],
    );
    assertEqualInvariant(
      'CI unit matrix job name reports the unit package script and Node version',
      unitJob.name,
      'test:unit (${{ matrix.node-version }})',
    );
    assertEqualInvariant(
      'CI unit matrix runs the unit package script only',
      unitStep.run,
      'npm run test:unit -- --ci',
    );
    assertEqualInvariant(
      'CI canonical full gate publishes the documented Node 20 check name',
      testCiJob.name,
      'test:ci (20)',
    );
    assertDeepEqualInvariant(
      'CI Redis integration uses the pinned service container',
      testCiJob.services.redis,
      {
        image: 'redis:8.8.0-alpine3.23',
        ports: ['6379:6379'],
        options: '--health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5',
      },
    );
    assertDeepEqualInvariant(
      'CI Redis integration requires the service-backed Redis URL',
      testCiJob.env,
      {
        REDIS_INTEGRATION_MODE: 'required',
        REDIS_INTEGRATION_URL: 'redis://127.0.0.1:6379',
      },
    );
    assertStepUsesAction(
      'CI canonical full gate uploads Jest results with actions/upload-artifact',
      uploadResultsStep,
      'actions/upload-artifact',
    );
    assertEqualInvariant(
      'CI canonical full gate runs test:ci through the package script',
      testCiStep.run,
      'npm run test:ci',
    );
    assertEqualInvariant(
      'CI required Newman gate runs smoke mode only',
      newmanJob.env.NEWMAN_MODE,
      'smoke',
    );
    assertExpressionContainsInvariant(
      'CI unit matrix skips expensive setup for docs-only changes',
      unitStep.if,
      "needs.changes.outputs.docs_only != 'true'",
    );
    assertExpressionContainsInvariant(
      'CI canonical full gate skips expensive setup for docs-only changes',
      testCiStep.if,
      "needs.changes.outputs.docs_only != 'true'",
    );
    assertNoRunCommandContainsInvariant(
      workflow,
      'apt-get install -y redis-server',
      'CI Redis integration must not install host Redis with apt',
    );
  });

  it('path-gates the expensive local provider integration workflow', () => {
    const workflow = loadWorkflow('local-provider-integration.yml');

    assertDeepEqualInvariant(
      'Local provider integration runs only manually, on schedule, after risky main pushes, or risky PRs',
      workflow.on,
      {
        workflow_dispatch: null,
        schedule: [{ cron: '37 6 * * 2' }],
        push: {
          branches: ['main'],
          paths: [
            '.github/workflows/local-provider-integration.yml',
            'config/providerCatalog.js',
            'package.json',
            'package-lock.json',
            'postman/**',
            'scripts/postman/**',
            'scripts/postman-fixture-server.js',
            'scripts/run-postman-harness.js',
            'src/api/**',
            'src/providers/**',
            'src/services/*DescriberService.js',
          ],
        },
        pull_request: {
          branches: ['main'],
          paths: [
            '.github/workflows/local-provider-integration.yml',
            'config/providerCatalog.js',
            'package.json',
            'package-lock.json',
            'postman/**',
            'scripts/postman/**',
            'scripts/postman-fixture-server.js',
            'scripts/run-postman-harness.js',
            'src/api/**',
            'src/providers/**',
            'src/services/*DescriberService.js',
          ],
        },
      },
    );
    assertNoRunCommandContainsInvariant(
      loadWorkflow('ci.yml'),
      'postman:full',
      'CI workflow must not duplicate the expensive local provider integration suite',
    );
  });

  it('keeps CodeQL required while allowing docs-only changes to use the lightweight docs gate', () => {
    const workflow = loadWorkflow('codeql.yml');
    const analyzeJob = getJob(workflow, 'analyze');
    const skipStep = findStepByName(analyzeJob, 'analyze', 'Skip CodeQL for docs-only change');

    assertDeepEqualInvariant(
      'CodeQL triggers on main/production pushes and pull requests plus weekly schedule',
      workflow.on,
      {
        push: { branches: ['main', 'production'] },
        pull_request: { branches: ['main', 'production'] },
        schedule: [{ cron: '19 7 * * 1' }],
      },
    );
    assertEqualInvariant(
      'CodeQL publishes the stable required check name',
      analyzeJob.name,
      'codeql',
    );
    assertExpressionContainsInvariant(
      'CodeQL performs a no-op success for docs-only changes',
      skipStep.if,
      "needs.changes.outputs.docs_only == 'true'",
    );
  });

  it('documents local Redis integration discovery through the pinned Docker profile', () => {
    const readmeContents = fs.readFileSync(README_PATH, 'utf8');
    const developmentContents = fs.readFileSync(DEVELOPMENT_PATH, 'utf8');
    const composeContents = fs.readFileSync(REDIS_COMPOSE_PATH, 'utf8');

    expect(readmeContents).toContain('npm run test:integration:redis');
    expect(developmentContents).toContain('docker compose -f docker-compose.redis.yml');
    expect(developmentContents).toContain('REDIS_INTEGRATION_URL=redis://127.0.0.1:6380');
    expect(composeContents).toContain('image: redis:8.8.0-alpine3.23');
    expect(composeContents).toContain('redis-test');
  });

  it('uses UUID-style Redis key prefixes instead of wall-clock prefixes', () => {
    const redisTestContents = fs.readFileSync(REDIS_INTEGRATION_TEST_PATH, 'utf8');

    expect(redisTestContents).toContain('randomUUID()');
    expect(redisTestContents).not.toContain('Date.now()');
  });
});
