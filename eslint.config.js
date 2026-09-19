// Lint for the Node side of the repository.
//
// The landing page has had a linter since it was scaffolded; the backend — the
// part that holds practitioner records — had none, so CI checked the style of a
// marketing site and nothing at all about the service. This closes that.
//
// It is deliberately close to js.configs.recommended and no closer to a style
// guide. The existing code is consistent without one and reformatting it would
// bury the history of files whose comments are the documentation. What is worth
// failing a build over is the class of mistake that reads fine and behaves
// wrong: an unused binding left by a refactor, a promise nobody awaited, a
// `case` that falls through.

'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // The landing page carries its own flat config and its own React rules.
    // Generated data and build output are not source.
    ignores: [
      'node_modules/**',
      'sanko-landing page/**',
      'data/**',
      'training/**',
      'evals/results/**',
      'backups/**',
      'models/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // A binding left behind by a refactor is the cheapest signal that
      // something was half-changed. Arguments are exempt up to the last used
      // one, and a leading underscore opts out deliberately — the codebase
      // already uses `_req`, `_res` for the Express handlers that ignore them.
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Everything below is a bug that runs. This service awaits a database on
      // nearly every path, so a dropped promise is a write that silently did
      // not happen.
      'no-async-promise-executor': 'error',
      'no-await-in-loop': 'off',        // deliberate in the export and claim paths
      'no-constant-binary-expression': 'error',
      'no-fallthrough': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-unreachable-loop': 'error',

      // Both of these fire almost entirely on patterns that are correct here:
      // `new Promise(r => setTimeout(r, ms))`, whose executor returns a timer id
      // nobody reads, and assigning to a field of a shared object after an
      // await, which require-atomic-updates cannot tell apart from a real
      // interleaving. Nineteen findings, none of them a bug, is a linter people
      // learn to run with --no-verify.
      'no-promise-executor-return': 'off',
      'require-atomic-updates': 'off',

      // `==` against null is idiomatic and intended in a few places; everywhere
      // else the coercion is an accident waiting for a practitioner's empty
      // string.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
    },
  },
  {
    // Tests use node:test's describe/it, which are imported, plus the same Node
    // globals. Nothing else differs.
    files: ['tests/**/*.js', 'evals/**/*.js'],
    rules: {
      'no-unused-expressions': 'off',
    },
  },
];
