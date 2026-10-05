import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import layout from './tools/eslint-layout/index.ts';

export default defineConfig(
  { ignores: ['**/node_modules/', '**/dist/', '**/.vscode-test/', '**/.tsc/', 'tests/conformance/runner/'] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: { globals: globals.node },
  },
  {
    // The import rules of docs/architecture/layout.md (rules 3 and 4).
    files: ['packages/**/*.{ts,mts,cts,js,mjs,cjs}'],
    plugins: { layout },
    rules: { 'layout/package-imports': ['error', { root: import.meta.dirname }] },
  },
);
