// Lint for real mistakes only (no style rules): undefined names, duplicate keys,
// unreachable code, etc. Runs in `npm test`, so it gates Netlify deploys. It exists
// because a refactor once deleted renderFinanceTab while a caller remained, and the
// site failed at startup.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'mockups/**', '.netlify/**'] },
  js.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
  },
  {
    files: ['netlify/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // A name used before its declaration in the same scope (e.g. a variable shadowed by a
      // later const) is a runtime error; this caught nothing until import-topic-bills
      // failed with "Cannot access 'done' before initialization" on 2026-11-12.
      'no-use-before-define': ['error', { functions: false, classes: false, variables: false, allowNamedExports: true }],
    },
  },
];
