import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {EDITOR_ENGINE} from './editor-floor.ts';
import {packageExtensions} from './package-extensions.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('package-extensions', () => {
  /** The code-less pack's manifest fields, which pass the shipped-identity rules. */
  const PACK = {
    version: '0.1.0',
    extensionPack: ['remote-oss.remote-a'],
    publisher: 'remote-oss',
    name: 'vscode-remote-extensionpack',
    license: 'MIT',
    engines: {vscode: EDITOR_ENGINE},
  };
  let workspace: TemporaryWorkspace;
  let calls: Array<[string[], string]>;
  let listing: string;

  function recordingVsce(vsceArguments: string[], folder: string): string {
    calls.push([vsceArguments, path.relative(workspace.root, folder)]);
    return vsceArguments[0] === 'ls' ? listing : '';
  }

  /** The message `run` threw, or no error. */
  function thrownOf(work: () => void): string {
    try {
      work();
      return 'no error';
    } catch (error) {
      return (error as Error).message;
    }
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('package-extensions');
    workspace.writeManifest('remote-a', {
      version: '1.2.3',
      main: './dist/extension.js',
      publisher: 'remote-oss',
      name: 'remote-ssh',
      license: 'MIT',
      engines: {vscode: EDITOR_ENGINE},
    });
    workspace.write('packages/remote-a/dist/extension.js', '');
    workspace.writeManifest('remote-b');
    calls = [];
    listing = 'package.json\nLICENSE\ndist/extension.js\n';
  });

  afterEach(() => {
    workspace.remove();
  });

  it('packages every built extension without dependencies', () => {
    deepStrictEqual(packageExtensions(workspace.root, [], recordingVsce), [
      `remote-a: ${path.join('dist', 'remote-ssh-1.2.3.vsix')}`,
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
          path.join(workspace.root, 'dist', 'remote-ssh-1.2.3.vsix'),
        ],
        path.join('packages', 'remote-a'),
      ],
    ]);
  });

  it('rejects a manifest with no shipped identity, joining every problem, before vsce package', () => {
    workspace.write('packages/remote-b/package.json', {
      main: './dist/extension.js',
    });
    workspace.write('packages/remote-b/dist/extension.js', '');
    deepStrictEqual(
      [
        thrownOf(() =>
          packageExtensions(workspace.root, ['remote-b'], recordingVsce),
        ),
        calls,
      ],
      [
        [
          'packages/remote-b: the license is not MIT',
          'packages/remote-b: the publisher is not remote-oss',
          'packages/remote-b: . is not a shipped extension id',
          `packages/remote-b: engines.vscode is not ${EDITOR_ENGINE}`,
        ].join('\n'),
        [[['ls', '--no-dependencies'], path.join('packages', 'remote-b')]],
      ],
    );
  });

  it('rejects a listed Microsoft notices file before vsce package, and the fake vsce records no package call', () => {
    listing = 'package.json\nLICENSE\nThirdPartyNotices.txt\n';
    deepStrictEqual(
      [
        thrownOf(() => packageExtensions(workspace.root, [], recordingVsce)),
        calls,
      ],
      [
        'packages/remote-a: the VSIX holds ThirdPartyNotices.txt',
        [[['ls', '--no-dependencies'], path.join('packages', 'remote-a')]],
      ],
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

  it('packages a code-less pack, which has an extensionPack and no main, with no built bundle', () => {
    workspace.writeManifest('remote-pack', PACK);
    deepStrictEqual(
      packageExtensions(workspace.root, ['remote-pack'], recordingVsce),
      [
        `remote-pack: ${path.join('dist', 'vscode-remote-extensionpack-0.1.0.vsix')}`,
      ],
    );
  });

  it('still rejects a manifest that has neither a main nor an extensionPack', () => {
    workspace.writeManifest('remote-pack', {version: '0.1.0'});
    throws(
      () => packageExtensions(workspace.root, ['remote-pack'], recordingVsce),
      {message: 'packages/remote-pack: no built main; run pnpm build'},
    );
  });

  it('includes a code-less pack when no folder is named, beside the built extensions', () => {
    workspace.writeManifest('remote-pack', PACK);
    deepStrictEqual(packageExtensions(workspace.root, [], recordingVsce), [
      `remote-a: ${path.join('dist', 'remote-ssh-1.2.3.vsix')}`,
      `remote-pack: ${path.join('dist', 'vscode-remote-extensionpack-0.1.0.vsix')}`,
    ]);
  });

  it('runs vsce from the repository when no runner is given', () => {
    throws(
      () => packageExtensions(workspace.root, ['remote-a']),
      /vsce ls failed/,
    );
  });
});
