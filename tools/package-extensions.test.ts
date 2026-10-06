import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {packageExtensions} from './package-extensions.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('package-extensions', () => {
  let workspace: TemporaryWorkspace;
  let calls: Array<[string[], string]>;
  let listing: string;

  function recordingVsce(vsceArguments: string[], folder: string): string {
    calls.push([vsceArguments, path.relative(workspace.root, folder)]);
    return vsceArguments[0] === 'ls' ? listing : '';
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('package-extensions');
    workspace.writeManifest('remote-a', {
      version: '1.2.3',
      main: './dist/extension.js',
    });
    workspace.write('packages/remote-a/dist/extension.js', '');
    workspace.writeManifest('remote-b');
    calls = [];
    listing = 'package.json\ndist/extension.js\n';
  });

  afterEach(() => {
    workspace.remove();
  });

  it('packages every built extension without dependencies', () => {
    deepStrictEqual(packageExtensions(workspace.root, [], recordingVsce), [
      `remote-a: ${path.join('dist', 'remote-a-1.2.3.vsix')}`,
    ]);
  });

  it('lists the files, then packages to the root dist folder', () => {
    packageExtensions(workspace.root, [], recordingVsce);
    deepStrictEqual(calls, [
      [['ls', '--no-dependencies'], path.join('packages', 'remote-a')],
      [
        [
          'package',
          '--no-dependencies',
          '--out',
          path.join(workspace.root, 'dist', 'remote-a-1.2.3.vsix'),
        ],
        path.join('packages', 'remote-a'),
      ],
    ]);
  });

  it('names the VSIX after the folder when the manifest has no name or version', () => {
    workspace.write('packages/remote-b/package.json', {
      main: './dist/extension.js',
    });
    workspace.write('packages/remote-b/dist/extension.js', '');
    deepStrictEqual(
      packageExtensions(workspace.root, ['remote-b'], recordingVsce),
      [`remote-b: ${path.join('dist', 'remote-b-0.0.0.vsix')}`],
    );
  });

  it('creates the dist folder', () => {
    packageExtensions(workspace.root, [], recordingVsce);
    strictEqual(existsSync(path.join(workspace.root, 'dist')), true);
  });

  it('rejects a file list that holds node_modules', () => {
    listing = 'package.json\nnode_modules/left-pad/index.js\n';
    throws(() => packageExtensions(workspace.root, [], recordingVsce), {
      message:
        'packages/remote-a: the VSIX would hold node_modules/left-pad/index.js',
    });
  });

  it('rejects an extension whose bundle is not built', () => {
    throws(
      () => packageExtensions(workspace.root, ['remote-b'], recordingVsce),
      {
        message: 'packages/remote-b: no built main; run pnpm build',
      },
    );
  });

  it('rejects a folder that does not exist', () => {
    throws(
      () => packageExtensions(workspace.root, ['remote-typo'], recordingVsce),
      {
        message: 'no package folder packages/remote-typo',
      },
    );
  });

  it('runs vsce from the repository when no runner is given', () => {
    throws(
      () => packageExtensions(workspace.root, ['remote-a']),
      /vsce ls failed/,
    );
  });
});
