import js from '@eslint/js';
import globals from 'globals';
import importPlugin from 'eslint-plugin-import';
import stylistic from '@stylistic/eslint-plugin';

/**
 * Flat ESLint config (ESLint 9).
 *
 * Replaces the legacy `.eslintrc.js` + `eslint-config-airbnb-base` setup.
 * airbnb-base is eslintrc-only and unmaintained for flat config, and its
 * frontend-oriented successor pulls React/Next/TS plugins this backend does
 * not use. Instead this composes a lean, airbnb-style stack from maintained,
 * flat-native pieces:
 *   - @eslint/js recommended       -> correctness baseline airbnb builds on
 *   - eslint-plugin-import          -> module/import hygiene
 *   - @stylistic                    -> airbnb-equivalent formatting
 *   - a focused airbnb rule block   -> the practices this codebase relies on
 */

// airbnb-style formatting, expressed through @stylistic.
const stylisticConfig = stylistic.configs.customize({
  indent: 2,
  quotes: 'single',
  semi: true,
  commaDangle: 'always-multiline',
  arrowParens: true,
  braceStyle: '1tbs',
  blockSpacing: true,
  quoteProps: 'as-needed',
});

export default [
  {
    ignores: [
      'coverage/',
      'reports/',
    ],
  },

  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  stylisticConfig,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // airbnb permits double quotes to avoid escaping embedded single quotes.
      '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],

      // Correctness / best practices (airbnb-flavored)
      'no-await-in-loop': 'error',
      'no-console': 'warn',
      'no-continue': 'error',
      'no-param-reassign': ['error', {
        props: true,
        ignorePropertyModificationsFor: [
          'acc', 'accumulator', 'e', 'ctx', 'context',
          'req', 'request', 'res', 'response', '$scope', 'staticContext',
        ],
      }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ForInStatement',
          message: 'for..in iterates over the prototype chain; use Object.keys/values/entries.',
        },
        {
          selector: 'ForOfStatement',
          message: 'Prefer array/iterator helpers over for..of where practical.',
        },
        {
          selector: 'LabeledStatement',
          message: 'Labels obscure control flow and are rarely necessary.',
        },
        {
          selector: 'WithStatement',
          message: '`with` is disallowed in strict mode and harms readability.',
        },
      ],
      'no-unused-vars': ['error', {
        args: 'after-used',
        ignoreRestSiblings: true,
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',

      // Node-oriented core rules (airbnb-base keeps these without eslint-plugin-n)
      'global-require': 'error',
      'no-new-require': 'error',
      'no-path-concat': 'error',

      // Import hygiene
      'import/no-dynamic-require': 'error',
    },
  },

  // ESM files (this config itself) parse as modules, not CommonJS.
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },

  // Test files: jest environment; lazy requires are idiomatic here.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      'global-require': 'off',
    },
  },
];
