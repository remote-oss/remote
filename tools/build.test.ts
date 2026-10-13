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

  it('rejects a package whose string tables fail', async () => {
    workspace.writeManifest('remote-b', {description: '%description%'});
    await rejects(
      buildPackages(workspace.root, ['remote-b']),
      /^Error: remote-b: /,
    );
  });

  it('rejects a folder that does not exist', async () => {
    await rejects(buildPackages(workspace.root, ['remote-typo']), {
      message: 'no package folder packages/remote-typo',
    });
  });

  it('bundles each program of a package on its own', async () => {
    workspace.write(
      'packages/remote-a/src/programs/connection-server.ts',
      'console.log(1);\n',
    );
    workspace.write(
      'packages/remote-a/src/programs/notes.md',
      'not a program\n',
    );
    deepStrictEqual(await buildPackages(workspace.root, ['remote-a']), [
      'remote-a: dist/extension.js',
      'remote-a: dist/connection-server.js',
    ]);
  });

  it('refuses a program that imports vscode', async () => {
    workspace.write(
      'packages/remote-a/src/programs/bad.ts',
      "import * as vscode from 'vscode';\nvoid vscode;\n",
    );
    await rejects(buildPackages(workspace.root, ['remote-a']));
  });

  it('F-5001.AC-15: a package with a web entry also gets the web bundle, which requires vscode', async () => {
    workspace.write(
      'packages/remote-a/src/web-extension.ts',
      "import * as vscode from 'vscode';\nexport function activate(): void {\n  void vscode.window;\n}\n",
    );
    const outcomes = await buildPackages(workspace.root, ['remote-a']);
    const bundle = readFileSync(
      path.join(workspace.root, 'packages/remote-a/dist/web/extension.js'),
      'utf8',
    );
    deepStrictEqual(
      [outcomes, bundle.includes('require("vscode")')],
      [
        ['remote-a: dist/extension.js', 'remote-a: dist/web/extension.js'],
        true,
      ],
    );
  });

  it('F-5001.AC-15: a web entry that imports a node module is refused', async () => {
    workspace.write(
      'packages/remote-a/src/web-extension.ts',
      "import {readFileSync} from 'node:fs';\nvoid readFileSync;\n",
    );
    await rejects(buildPackages(workspace.root, ['remote-a']));
  });

  it('F-5001.AC-15: a package without a web entry gets no web bundle', async () => {
    deepStrictEqual(await buildPackages(workspace.root, ['remote-a']), [
      'remote-a: dist/extension.js',
    ]);
  });
});
