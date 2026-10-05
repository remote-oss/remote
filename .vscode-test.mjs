/**
 * @fileoverview The `@vscode/test-cli` configuration; tools/integration-tests.ts builds it.
 */
import {defineConfig} from '@vscode/test-cli';
import {integrationConfigurations} from './tools/integration-tests.ts';

/** The configurations test-cli runs. */
export default defineConfig(integrationConfigurations(import.meta.dirname));
