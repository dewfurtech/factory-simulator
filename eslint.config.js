import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Built output, dependencies, and the machine models copied in from Mastrox Models (edited there, not here).
  { ignores: ['dist', 'node_modules', '.plans', '.claude', 'src/machines/**', 'scripts/**', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.es2022 } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // tsc already flags unused code (noUnusedLocals); here only the underscore convention is allowed through.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Effects that read store state on purpose, with their own dependency choice, are common in the editor.
      'react-hooks/exhaustive-deps': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  { files: ['vite.config.ts', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  // The share function runs on Netlify's Node with the web Request/Response and crypto globals.
  { files: ['netlify/**/*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // The Chrome extension's scripts run in the browser, with the extension API as `chrome`.
  { files: ['extension/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...globals.webextensions } } },
);
