import {deepStrictEqual, match, rejects} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {buildPackages} from './build.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('build', () => {
  let workspace: TemporaryWorkspace;

  beforeEach(() => {
    workspace = new TemporaryWorkspace('build');
    workspace.writeManifest('remote-a');
    workspace.writeManifest('remote-b');
    workspace.write(
      'packages/remote-a/src/extension.ts',
      "import * as vscode from 'vscode';\nexport function activate(): void {\n  void vscode.window;\n}\n",
    );
  });

  afterEach(() => {
    workspace.remove();
  });

  it('bundles every package with an entry point and skips the others', async () => {
    deepStrictEqual(await buildPackages(workspace.root, []), [
      'remote-a: dist/extension.js',
      'remote-b: no src/extension.ts, skipped',
    ]);
  });

  it('keeps vscode external in the bundle', async () => {
    await buildPackages(workspace.root, ['remote-a']);
    const bundle = readFileSync(
      path.join(workspace.root, 'packages/remote-a/dist/extension.js'),
      'utf8',
    );
    match(bundle, /require\("vscode"\)/);
  });

  it('builds only the named folders', async () => {
    deepStrictEqual(await buildPackages(workspace.root, ['remote-b']), [
      'remote-b: no src/extension.ts, skipped',
    ]);
  });

  it('rejects a folder that does not exist', async () => {
    await rejects(buildPackages(workspace.root, ['remote-typo']), {
      message: 'no package folder packages/remote-typo',
    });
  });
});
