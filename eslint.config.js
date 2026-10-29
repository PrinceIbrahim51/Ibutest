import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/release/**',
      '**/coverage/**',
      'e2e/output/**',
      'mobile/android/**',
      'mobile/ios/**',
      'server/drizzle/**',
      'client/public/sw.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Object property lookups on validated enums/ids are safe and very common here; the
      // rule's heuristic produces only false positives in this codebase.
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // XSS guard: never render raw HTML.
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Raw HTML rendering is forbidden (XSS).' },
        { selector: "AssignmentExpression[left.property.name='innerHTML']", message: 'innerHTML is forbidden (XSS).' },
        { selector: "AssignmentExpression[left.property.name='outerHTML']", message: 'outerHTML is forbidden (XSS).' },
        { selector: "CallExpression[callee.property.name='insertAdjacentHTML']", message: 'insertAdjacentHTML is forbidden (XSS).' },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: 'document.write is forbidden (XSS).' },
      ],
    },
  },
  {
    files: ['desktop/src/launcher/**/*.js', 'client/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker }, sourceType: 'script' },
  },
  {
    // End-to-end tests run code both in Node and inside the page (page.evaluate).
    files: ['e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Tests, build scripts and the desktop main process only touch paths derived from
    // constants, the repository layout or Electron's per-user data directory.
    files: ['**/test/**/*.ts', 'scripts/**/*.mjs', 'e2e/**/*.mjs', 'desktop/src/main.ts', '**/build.mjs'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
);
