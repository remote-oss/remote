import { deepStrictEqual } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
  const link = (from: string, to: string): void => {
    const full = path.join(root, from);
    mkdirSync(path.dirname(full), { recursive: true });
    symlinkSync(path.relative(path.dirname(full), path.join(root, to)), full);
  };
  const a = 'packages/remote-a/package.json';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'check-workspace-'));
    write('package.json', { name: 'root', private: true, devDependencies: { mocha: '^11.8.0' } });
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    manifest('remote-a');
    manifest('remote-b');
    manifest('lib-x');
    write(
      'tsconfig.base.json',
      '{\n  // comments are allowed\n  "compilerOptions": { "strict": true }, "files": []\n}',
    );
    write('packages/remote-a/tsconfig.json', { extends: '../../tsconfig.base.json', include: ['src'] });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('accepts declared workspace dependencies on libraries, with their links and references', () => {
    manifest('remote-a', { dependencies: { 'lib-x': 'workspace:*' }, devDependencies: { mocha: 'catalog:' } });
    manifest('lib-x', { imports: { '#internal': './src/internal.ts' } });
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\ncatalog:\n  mocha: ^11.8.0\nnodeLinker: isolated\n');
    write('packages/lib-x/tsconfig.json', { extends: '../../tsconfig.base.json', include: ['src'] });
    write('packages/lib-x/src/index.ts', 'export const x = 1;');
    write('packages/remote-a/src/index.ts', 'export const a = 1;');
    write('packages/remote-a/tsconfig.json', {
      extends: '../../tsconfig.base.json',
      include: ['src'],
      references: [{ path: '../lib-x' }],
    });
    link('packages/remote-a/node_modules/lib-x', 'packages/lib-x');
    link('node_modules/mocha', 'node_modules/.pnpm/mocha');
    deepStrictEqual(checkWorkspace(root), []);
  });

  describe('package manifests', () => {
    it('reports an extension that lists another extension, in any field', () => {
      manifest('remote-a', { devDependencies: { 'remote-b': 'workspace:*' } });
      deepStrictEqual(checkWorkspace(root), [
        `${a}: devDependencies.remote-b: extension remote-a reaches extension remote-b (layout.md rule 3)`,
      ]);
    });

    it('reports a library that lists an extension', () => {
      manifest('lib-x', { peerDependencies: { 'remote-a': 'workspace:^' } });
      deepStrictEqual(checkWorkspace(root), [
        'packages/lib-x/package.json: peerDependencies.remote-a: library lib-x reaches extension remote-a (layout.md rule 4)',
      ]);
    });

    it('reports an aliased workspace dependency and checks its target', () => {
      manifest('remote-a', { dependencies: { 'wsl-alias': 'workspace:remote-b@*', 'x-alias': 'workspace:lib-x@*' } });
      deepStrictEqual(checkWorkspace(root), [
        `${a}: dependencies.wsl-alias aliases remote-b`,
        `${a}: dependencies.wsl-alias: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        `${a}: dependencies.x-alias aliases lib-x`,
      ]);
    });

    it('reports npm:, link: and file: routes and a missing workspace: protocol', () => {
      manifest('remote-a', {
        dependencies: { n: 'npm:lib-x@^1', l: 'link:../lib-x', f: 'file:../remote-b', 'lib-x': '^0.0.0' },
      });
      deepStrictEqual(checkWorkspace(root), [
        `${a}: dependencies.n aliases workspace package lib-x through npm:`,
        `${a}: dependencies.l uses link:; dependencies are workspace: or registry packages`,
        `${a}: dependencies.f uses file:; dependencies are workspace: or registry packages`,
        `${a}: dependencies.f: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        `${a}: dependencies.lib-x names a workspace package without the workspace: protocol`,
      ]);
    });

    it('follows catalog: entries', () => {
      write('pnpm-workspace.yaml', 'packages:\n  - packages/*\ncatalogs:\n  tools:\n    wsl: link:packages/remote-b\n');
      manifest('remote-a', { dependencies: { wsl: 'catalog:tools' } });
      deepStrictEqual(checkWorkspace(root), [
        `${a}: dependencies.wsl (catalog tools) uses link:; dependencies are workspace: or registry packages`,
        `${a}: dependencies.wsl: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        "pnpm-workspace.yaml: catalogs.tools.wsl: 'link:packages/remote-b' uses link:",
      ]);
    });

    it('reports a link: to a folder outside packages/, and its installed link', () => {
      write('shared/bridge/index.ts', "export * from '../../packages/remote-b/src/index.ts';");
      manifest('remote-a', { dependencies: { bridge: 'link:../../shared/bridge' } });
      link('packages/remote-a/node_modules/bridge', 'shared/bridge');
      deepStrictEqual(checkWorkspace(root), [
        `${a}: dependencies.bridge uses link:; dependencies are workspace: or registry packages`,
        `packages/remote-a/node_modules/bridge: links ${path.join('shared', 'bridge')}, which is not a workspace package`,
      ]);
    });

    it('reports a manifest that cannot be parsed', () => {
      write(a, '{ "name": "remote-a", ');
      write('package.json', '{');
      deepStrictEqual(
        checkWorkspace(root).map((e) => e.replace(/: cannot be read: .*/, ': cannot be read')),
        [`${a}: cannot be read`, 'package.json: cannot be read'],
      );
    });

    it('reports a workspace: dependency that names no package', () => {
      manifest('remote-a', { dependencies: { 'lib-gone': 'workspace:*' } });
      deepStrictEqual(checkWorkspace(root), [`${a}: dependencies.lib-gone names no workspace package`]);
    });

    it('reports imports targets outside the package, a package that is not private, and package-level overrides', () => {
      write(a, {
        name: 'remote-a',
        imports: { '#b': '../remote-b/src/index.ts', '#c': { node: 'remote-b' } },
        pnpm: { overrides: {} },
      });
      deepStrictEqual(checkWorkspace(root), [
        `${a}: "private" is not true`,
        `${a}: imports target '../remote-b/src/index.ts' is outside the package`,
        `${a}: imports target 'remote-b' is outside the package`,
        `${a}: "pnpm" belongs in the root, not a package`,
      ]);
    });
  });

  describe('root configuration', () => {
    it('reports a root dependency that links a workspace package into the root', () => {
      write('package.json', { name: 'root', private: true, devDependencies: { 'root-b': 'workspace:remote-b@*' } });
      deepStrictEqual(checkWorkspace(root), [
        'package.json: devDependencies.root-b aliases remote-b',
        'package.json: devDependencies.root-b links workspace package remote-b into the root',
      ]);
    });

    it('reports overrides, package extensions and resolutions that route to workspace packages', () => {
      write('package.json', {
        name: 'root',
        private: true,
        pnpm: { overrides: { 'some-dep': 'link:packages/remote-b' } },
      });
      write(
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - packages/*',
          'overrides:',
          "  'foo>bar': workspace:remote-b@*",
          'packageExtensions:',
          "  'remote-a@*':",
          '    dependencies:',
          '      lib-x: workspace:*',
          '',
        ].join('\n'),
      );
      deepStrictEqual(checkWorkspace(root), [
        "package.json: pnpm.overrides.some-dep: 'link:packages/remote-b' uses link:",
        "pnpm-workspace.yaml: overrides.foo>bar: 'workspace:remote-b@*' routes to workspace package remote-b",
        "pnpm-workspace.yaml: packageExtensions: key 'remote-a@*' names workspace package remote-a",
        "pnpm-workspace.yaml: packageExtensions.remote-a@*.dependencies: key 'lib-x' names workspace package lib-x",
      ]);
    });

    it('reports a workspace beyond packages/* and linkWorkspacePackages', () => {
      write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n  - extras/*\nlinkWorkspacePackages: true\n');
      deepStrictEqual(checkWorkspace(root), [
        'pnpm-workspace.yaml: packages is ["packages/*","extras/*"], expected ["packages/*"]',
        'pnpm-workspace.yaml: sets linkWorkspacePackages',
      ]);
    });

    it('reports a missing pnpm-workspace.yaml', () => {
      rmSync(path.join(root, 'pnpm-workspace.yaml'));
      deepStrictEqual(
        checkWorkspace(root).map((e) => e.replace(/: cannot be read: .*/, ': cannot be read')),
        ['pnpm-workspace.yaml: cannot be read', 'pnpm-workspace.yaml: packages is undefined, expected ["packages/*"]'],
      );
    });

    it('reports pnpm hook files and pnpmfile settings', () => {
      write('.pnpmfile.cjs', 'module.exports = {};');
      write('packages/remote-a/pnpmfile.mjs', 'export default {};');
      write('pnpm-workspace.yaml', 'packages:\n  - packages/*\npnpmfile: hooks.cjs\n');
      write('.npmrc', 'global-pnpmfile=/tmp/hooks.cjs\n');
      deepStrictEqual(checkWorkspace(root), [
        '.pnpmfile.cjs: pnpm hook file',
        `${path.join('packages', 'remote-a', 'pnpmfile.mjs')}: pnpm hook file`,
        'pnpm-workspace.yaml: sets pnpmfile',
        '.npmrc: sets global-pnpmfile',
      ]);
    });

    it('reports hoisting into the root', () => {
      write(
        'pnpm-workspace.yaml',
        'packages:\n  - packages/*\nnodeLinker: hoisted\nshamefullyHoist: true\npublicHoistPattern: ["*"]\n',
      );
      write('.npmrc', 'shamefully-hoist=true\npublic-hoist-pattern[]=*\n');
      deepStrictEqual(checkWorkspace(root), [
        "pnpm-workspace.yaml: nodeLinker 'hoisted'; only 'isolated' keeps packages apart",
        'pnpm-workspace.yaml: shamefullyHoist hoists into the root',
        'pnpm-workspace.yaml: publicHoistPattern hoists into the root',
        '.npmrc: sets shamefully-hoist',
        '.npmrc: sets public-hoist-pattern',
      ]);
    });
  });

  describe('tsconfigs', () => {
    const tsconfig = (file: string): string => path.join('packages', 'remote-a', file);

    it('reports paths, baseUrl and rootDirs, also through an extends chain', () => {
      write('tsconfig.paths.json', { compilerOptions: { paths: { w: ['packages/remote-b/src'] } } });
      write('packages/remote-a/tsconfig.json', { extends: '../../tsconfig.paths.json', files: [] });
      write('packages/remote-a/test/tsconfig.json', {
        compilerOptions: { baseUrl: '.', rootDirs: ['.', '../../remote-b'] },
        files: [],
      });
      deepStrictEqual(checkWorkspace(root), [
        'tsconfig.paths.json: sets paths; packages reach each other only by package name',
        `${tsconfig(path.join('test', 'tsconfig.json'))}: sets baseUrl; packages reach each other only by package name`,
        `${tsconfig(path.join('test', 'tsconfig.json'))}: sets rootDirs; packages reach each other only by package name`,
        `${tsconfig('tsconfig.json')}: sets paths; packages reach each other only by package name`,
      ]);
    });

    it("reports another package's files, type roots and undeclared or extension references", () => {
      write('packages/remote-b/src/index.ts', 'export const b = 1;');
      write('packages/remote-b/tsconfig.json', { compilerOptions: { composite: true }, include: ['src'] });
      write('packages/lib-x/tsconfig.json', { compilerOptions: { composite: true }, files: [] });
      write('packages/remote-a/tsconfig.json', {
        compilerOptions: { typeRoots: ['../remote-b/types'] },
        include: ['../remote-b/src'],
        references: [{ path: '../remote-b' }, { path: '../lib-x' }],
      });
      const b = path.join('packages', 'remote-b');
      deepStrictEqual(checkWorkspace(root), [
        `${tsconfig('tsconfig.json')}: compiles ${path.join(b, 'src', 'index.ts')} from outside the package (shared types go in a library)`,
        `${tsconfig('tsconfig.json')}: typeRoots entry ${path.join(b, 'types')}`,
        `${tsconfig('tsconfig.json')}: references ${b}: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        `${tsconfig('tsconfig.json')}: references lib-x, which remote-a does not declare`,
      ]);
    });
  });

  describe('links', () => {
    it('reports symbolic links inside packages/ and into packages/', () => {
      link('packages/remote-a/src/b', 'packages/remote-b/src');
      link('shared', 'packages/remote-b');
      deepStrictEqual(checkWorkspace(root), [
        `${path.join('packages', 'remote-a', 'src', 'b')}: symbolic link inside packages/`,
        'shared: symbolic link into packages/',
      ]);
    });

    it('reports installed links that reach a workspace package another way', () => {
      link('node_modules/root-b', 'packages/remote-b');
      link('packages/remote-a/node_modules/wsl', 'packages/remote-b');
      link('packages/remote-a/node_modules/@s/x', 'packages/lib-x');
      deepStrictEqual(checkWorkspace(root), [
        'node_modules/root-b: links workspace package remote-b into the root',
        'packages/remote-a/node_modules/@s/x: links lib-x under another name',
        'packages/remote-a/node_modules/wsl: links remote-b under another name',
        'packages/remote-a/node_modules/wsl: extension remote-a reaches extension remote-b (layout.md rule 3)',
      ]);
    });
  });
});
