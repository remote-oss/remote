/**
 * @fileoverview The `@vscode/test-cli` configuration of the acceptance tests; tools/acceptance.ts starts test-cli
 * with it and the harness variables.
 */
import {defineConfig} from '@vscode/test-cli';
import {acceptanceConfiguration} from '../../tools/acceptance.ts';

/** The one configuration test-cli runs. */
export default defineConfig(
  acceptanceConfiguration(
    new URL('../..', import.meta.url).pathname,
    process.env,
  ),
);
