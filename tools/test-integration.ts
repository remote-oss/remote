// test-integration: run the extension-host tests of .vscode-test.mjs, or report that there are none.
// `vscode-test` downloads an editor build, so it is started only when some package has integration tests.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const { configs } = (await import(path.join(root, '.vscode-test.mjs'))) as { configs: { label: string }[] };

if (configs.length === 0) {
  console.log('test-integration: no package has test/integration, nothing to run');
  process.exit(0);
}
const result = spawnSync('vscode-test', process.argv.slice(2), { cwd: root, stdio: 'inherit', shell: true });
process.exit(result.status ?? 1);
