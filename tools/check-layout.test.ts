import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import path from 'node:path';
import {checkLayout} from './check-layout.ts';
import {EXTENSION_FOLDERS, expectedPackageName} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

describe('check-layout', () => {
  let workspace: TemporaryWorkspace;

  function writePackage(folder: string): void {
    workspace.writeManifest(folder, {name: expectedPackageName(folder)});
    workspace.write(`packages/${folder}/README.md`, `# ${folder}\n`);
    workspace.write(`packages/${folder}/tsconfig.json`, {files: []});
    workspace.write(`packages/${folder}/tsconfig.test.json`, {files: []});
  }

  function writeSolution(folders: readonly string[]): void {
    workspace.write('tsconfig.json', {
      files: [],
      references: folders.flatMap(folder => [
        {path: `packages/${folder}`},
        {path: `packages/${folder}/tsconfig.test.json`},
      ]),
    });
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('check-layout');
    workspace.write('package.json', {
      name: 'root',
      private: true,
      devDependencies: {'@vscode/vsce': '2.26.0'},
    });
    workspace.write(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n  - tests/acceptance\n',
    );
    for (const file of [
      'AGENTS.md',
      'LICENSE',
      'docs/architecture/layout.md',
      'tests/conformance/README.md',
      'docs/adr/README.md',
      'docs/adr/0002-language-and-toolchain.md',
    ]) {
      workspace.write(file, 'text\n');
    }
    for (const folder of EXTENSION_FOLDERS) {
      writePackage(folder);
    }
    writeSolution(EXTENSION_FOLDERS);
  });

  afterEach(() => {
    workspace.remove();
  });

  it('accepts a complete layout', () => {
    deepStrictEqual(checkLayout(workspace.root), []);
  });

  it('reports a folder that is neither an extension nor a library', () => {
    writePackage('helpers');
    writeSolution([...EXTENSION_FOLDERS, 'helpers']);
    deepStrictEqual(checkLayout(workspace.root), [
      'packages/helpers is neither an extension nor a lib-<name> folder',
    ]);
  });

  it('reports the missing files of a package folder', () => {
    workspace.write('packages/lib-empty/.keep', '');
    writeSolution(EXTENSION_FOLDERS);
    deepStrictEqual(checkLayout(workspace.root), [
      'packages/lib-empty/README.md is missing',
      'packages/lib-empty/package.json is missing (every package folder is a workspace)',
      'packages/lib-empty/tsconfig.json is missing',
      'packages/lib-empty/tsconfig.test.json is missing',
      'tsconfig.json has no reference to packages/lib-empty',
      'tsconfig.json has no reference to packages/lib-empty/tsconfig.test.json',
    ]);
  });

  it('reports a package name that differs from the folder, the pack included', () => {
    workspace.writeManifest('remote-ssh', {name: 'ssh'});
    workspace.writeManifest('remote-extensionpack');
    deepStrictEqual(checkLayout(workspace.root), [
      "packages/remote-extensionpack/package.json has name 'remote-extensionpack', expected 'vscode-remote-extensionpack'",
      "packages/remote-ssh/package.json has name 'ssh', expected 'remote-ssh'",
    ]);
  });

  it('reports an extension manifest whose engines.vscode is not the floor (ADR-0007)', () => {
    workspace.writeManifest('remote-ssh', {
      publisher: 'remote-oss',
      engines: {vscode: '^1.74.0'},
    });
    workspace.writeManifest('remote-wsl', {publisher: 'remote-oss'});
    workspace.writeManifest('remote-server', {
      publisher: 'remote-oss',
      engines: {vscode: '^1.139.0'},
    });
    deepStrictEqual(checkLayout(workspace.root), [
      "packages/remote-ssh/package.json has engines.vscode '^1.74.0', expected '^1.139.0' (ADR-0007)",
      "packages/remote-wsl/package.json has engines.vscode '', expected '^1.139.0' (ADR-0007)",
    ]);
  });

  it('reports a repository without vsce or a lockfile', () => {
    workspace.write('package.json', {name: 'root', private: true});
    deepStrictEqual(checkLayout(workspace.root), [
      "@vscode/vsce must stay exactly 2.26.0 (ADR-0002, decision 5); package.json has '', the lockfile none",
    ]);
  });

  it('reports a packaging tool other than vsce 2.26.0 (ADR-0002, decision 5)', () => {
    workspace.write('package.json', {
      name: 'root',
      private: true,
      devDependencies: {'@vscode/vsce': '^4.0.0'},
    });
    workspace.write(
      'pnpm-lock.yaml',
      "packages:\n\n  '@vscode/vsce@4.0.0':\n  '@vscode/vsce@4.0.0(supports-color@8.1.1)':\n",
    );
    deepStrictEqual(checkLayout(workspace.root), [
      "@vscode/vsce must stay exactly 2.26.0 (ADR-0002, decision 5); package.json has '^4.0.0', the lockfile 4.0.0, 4.0.0",
    ]);
  });

  it('reports a product name in package code outside the product table (ADR-0006)', () => {
    workspace.write(
      'packages/remote-ssh/src/server.ts',
      "const name = 'codium';\n",
    );
    deepStrictEqual(checkLayout(workspace.root), [
      `${path.join('packages', 'remote-ssh', 'src', 'server.ts')} names a product or a download host; only ${path.join('packages', 'lib-product', 'src', 'product-table.ts')} may (ADR-0006)`,
    ]);
  });

  it('reports the VSCodium name in package code (ADR-0006)', () => {
    workspace.write(
      'packages/remote-ssh/src/server.ts',
      "const text = 'vscodium';\n",
    );
    deepStrictEqual(checkLayout(workspace.root).length, 1);
  });

  it("reports the editor's site in package code (ADR-0006)", () => {
    workspace.write(
      'packages/remote-ssh/src/server.ts',
      "const text = 'https://code.visualstudio.com/docs';\n",
    );
    deepStrictEqual(checkLayout(workspace.root).length, 1);
  });

  it('reports the server data folder in package code (ADR-0006)', () => {
    workspace.write(
      'packages/remote-ssh/src/server.ts',
      "const text = '~/.vscode-server';\n",
    );
    deepStrictEqual(checkLayout(workspace.root).length, 1);
  });

  it('reports the second licence host in package code (ADR-0006)', () => {
    workspace.write(
      'packages/remote-ssh/src/server.ts',
      "const text = 'https://vscode.download.prss.microsoft.com/x';\n",
    );
    deepStrictEqual(checkLayout(workspace.root).length, 1);
  });

  it('allows product names and download hosts in the product table', () => {
    writePackage('lib-product');
    writeSolution([...EXTENSION_FOLDERS, 'lib-product']);
    workspace.write(
      'packages/lib-product/src/product-table.ts',
      "const host = 'update.code.visualstudio.com';\n",
    );
    deepStrictEqual(checkLayout(workspace.root), []);
  });

  it('reports a missing extension folder and missing repository files', () => {
    rmSync(path.join(workspace.root, 'packages/remote-wsl'), {recursive: true});
    writeSolution(EXTENSION_FOLDERS.filter(folder => folder !== 'remote-wsl'));
    rmSync(path.join(workspace.root, 'LICENSE'));
    deepStrictEqual(checkLayout(workspace.root), [
      'packages/remote-wsl is missing',
      'LICENSE is missing',
    ]);
  });

  it('reports decision records that are misnamed or share a number', () => {
    workspace.write('docs/adr/0002-other.md', 'text\n');
    workspace.write('docs/adr/notes.md', 'text\n');
    deepStrictEqual(checkLayout(workspace.root), [
      'docs/adr/notes.md is not NNNN-title.md',
      'ADR numbers used twice: 0002',
    ]);
  });

  it('reports every reference as missing when the solution tsconfig cannot be read', () => {
    workspace.write('tsconfig.json', '{');
    const problems = checkLayout(workspace.root);
    deepStrictEqual(
      [
        problems.length,
        problems[0]?.startsWith('tsconfig.json: cannot be read'),
      ],
      [1 + 2 * EXTENSION_FOLDERS.length, true],
    );
  });

  it('adds the string-table problems of each package with their prefix', () => {
    workspace.writeManifest('remote-ssh', {description: '%description%'});
    deepStrictEqual(
      checkLayout(workspace.root).map(problem => problem.split('/')[0]),
      ['string-tables: packages'],
    );
  });

  it('reports an unreadable package name as empty', () => {
    workspace.write('packages/remote-ssh/package.json', '{');
    deepStrictEqual(checkLayout(workspace.root).slice(0, 1), [
      "packages/remote-ssh/package.json has name '', expected 'remote-ssh'",
    ]);
  });

  it('adds the problems of check-workspace with their prefix', () => {
    workspace.writeManifest('remote-ssh', {private: false});
    deepStrictEqual(checkLayout(workspace.root), [
      'check-workspace: packages/remote-ssh/package.json: "private" is not true',
    ]);
  });
});
