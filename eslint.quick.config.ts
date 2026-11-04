/**
 * @fileoverview The lint of a working tree's own files: the project's config with the type-aware rules off, so no
 * TypeScript program is built and the lint runs in the memory a machine with little of it allows. CI's full lint
 * stays the gate.
 */

import {defineConfig} from 'eslint/config';
import tseslint from 'typescript-eslint';
import {config} from './eslint.config.ts';

export default defineConfig(...config, {
  files: ['**/*.{ts,tsx}'],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: {
    parserOptions: {project: false, projectService: false},
  },
});
