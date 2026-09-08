import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'release/**', 'releases/**', '.test-artifacts/**', 'coverage/**'],
  },
  {
    files: ['**/*.{mjs,cjs,js}'],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: [
      'public/**',
      'desktop/renderer/**',
      'desktop/overlay.mjs',
      'desktop/update.js',
      'shared/render/**',
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tests/**', 'scripts/native-interaction-check.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
];
