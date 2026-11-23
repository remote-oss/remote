/**
 * @fileoverview The `@vscode/test-cli` configuration of the acceptance tests; tools/acceptance.ts starts test-cli
 * with it and the harness variables. The VS Code run has one configuration; the VSCodium run has two, a local window
 * and a remote one, which test-cli picks by label.
 */
import {fileURLToPath} from 'node:url';
import {defineConfig} from '@vscode/test-cli';
import {
  acceptanceConfiguration,
  vscodiumConfigurations,
} from '../../tools/acceptance.ts';

// a path of this machine's own form: a URL's pathname on Windows is `/D:/…`, which joins into `D:\D:\…`
const root = fileURLToPath(new URL('../..', import.meta.url));

/** The configurations of the run's editor. */
export default defineConfig(
  process.env.HARNESS_EDITOR === 'vscodium'
    ? vscodiumConfigurations(
        root,
        process.env,
        process.env.HARNESS_VSCODIUM_EXECUTABLE ?? '',
      )
    : acceptanceConfiguration(root, process.env),
);
