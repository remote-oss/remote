import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkWorkspace } from './check-workspace.ts';

// Each case builds a workspace in a temporary folder: extensions remote-a and remote-b, library lib-x.
describe('check-workspace', () => {
  let root: string;

  const write = (file: string, content: unknown): void => {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
  };
  const manifest = (folder: string, extra: object = {}): void =>
    write(`packages/${folder}/package.json`, { name: folder, version: '0.0.0', private: true, ...extra });

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'check-workspace-'));
    manifest('remote-a');
    manifest('remote-b');
    manifest('lib-x');
    write('tsconfig.base.json', '{\n  // comments are allowed\n  "compilerOptions": { "strict": true }\n}');
    write('packages/remote-a/tsconfig.json', { extends: '../../tsconfig.base.json' });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('accepts declared workspace dependencies on libraries', () => {
    manifest('remote-a', { dependencies: { 'lib-x': 'workspace:*' }, devDependencies: { mocha: '^11.8.0' } });
    manifest('lib-x', { imports: { '#internal': './src/internal.ts' } });
    deepStrictEqual(checkWorkspace(root), []);
  });

  it('reports an extension that lists another extension, in any field', () => {
    manifest('remote-a', { devDependencies: { 'remote-b': 'workspace:*' } });
    deepStrictEqual(checkWorkspace(root), [
      'packages/remote-a/package.json: extension remote-a lists extension remote-b in devDependencies (layout.md rule 3)',
    ]);
  });

  it('reports a library that lists an extension', () => {
    manifest('lib-x', { peerDependencies: { 'remote-a': 'workspace:^' } });
    deepStrictEqual(checkWorkspace(root), [
      'packages/lib-x/package.json: library lib-x lists extension remote-a in peerDependencies (layout.md rule 4)',
    ]);
  });

  it('reports an aliased workspace dependency and checks its target', () => {
    manifest('remote-a', { dependencies: { 'wsl-alias': 'workspace:remote-b@*', 'x-alias': 'workspace:lib-x@*' } });
    deepStrictEqual(checkWorkspace(root), [
      'packages/remote-a/package.json: dependencies.wsl-alias aliases remote-b',
      'packages/remote-a/package.json: extension remote-a lists extension remote-b in dependencies (layout.md rule 3)',
      'packages/remote-a/package.json: dependencies.x-alias aliases lib-x',
    ]);
  });

  it('reports npm:, link: and file: routes to workspace packages and a missing workspace: protocol', () => {
    manifest('remote-a', {
      dependencies: { n: 'npm:lib-x@^1', l: 'link:../lib-x', f: 'file:../remote-b', 'lib-x': '^0.0.0' },
    });
    deepStrictEqual(checkWorkspace(root), [
      'packages/remote-a/package.json: dependencies.n aliases workspace package lib-x through npm:',
      'packages/remote-a/package.json: dependencies.l points into packages/ with link:; use workspace:',
      'packages/remote-a/package.json: dependencies.f points into packages/ with file:; use workspace:',
      'packages/remote-a/package.json: extension remote-a lists extension remote-b in dependencies (layout.md rule 3)',
      'packages/remote-a/package.json: dependencies.lib-x names a workspace package without the workspace: protocol',
    ]);
  });

  it('reports a workspace: dependency that names no package', () => {
    manifest('remote-a', { dependencies: { 'lib-gone': 'workspace:*' } });
    deepStrictEqual(checkWorkspace(root), [
      'packages/remote-a/package.json: dependencies.lib-gone names no workspace package',
    ]);
  });

  it('reports paths and baseUrl in package and root tsconfigs', () => {
    write('packages/remote-a/tsconfig.test.json', { compilerOptions: { paths: { w: ['../remote-b/src'] } } });
    write('tsconfig.base.json', { compilerOptions: { baseUrl: '.' } });
    deepStrictEqual(checkWorkspace(root), [
      'tsconfig.base.json: sets baseUrl; packages reach each other only by package name',
      `${path.join('packages', 'remote-a', 'tsconfig.test.json')}: sets paths; packages reach each other only by package name`,
    ]);
  });

  it('reports imports targets outside the package, and a package that is not private', () => {
    write('packages/remote-a/package.json', {
      name: 'remote-a',
      imports: { '#b': '../remote-b/src/index.ts', '#c': { node: 'remote-b' } },
    });
    deepStrictEqual(checkWorkspace(root), [
      'packages/remote-a/package.json: "private" is not true',
      "packages/remote-a/package.json: imports target '../remote-b/src/index.ts' is outside the package",
      "packages/remote-a/package.json: imports target 'remote-b' is outside the package",
    ]);
  });
});
