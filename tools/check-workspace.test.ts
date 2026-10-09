import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import path from 'node:path';
import {checkWorkspace} from './check-workspace.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

const remoteAManifest = 'packages/remote-a/package.json';

const SHARED_FIXTURE = path.join(
  import.meta.dirname,
  'eslint-plugins',
  'fixtures',
);

describe('check-workspace', () => {
  it('agrees with the layout lint rule on the cycle of its fixture', () => {
    deepStrictEqual(checkWorkspace(SHARED_FIXTURE), [
      'packages/lib-x/package.json: dependency cycle lib-x -> @fixture/lib-y -> lib-x (layout.md rule 4)',
    ]);
  });

  let workspace: TemporaryWorkspace;

  function write(file: string, content: unknown): void {
    workspace.write(file, content);
  }

  function manifest(folder: string, fields: object = {}): void {
    workspace.writeManifest(folder, fields);
  }

  function link(source: string, target: string): void {
    workspace.link(source, target);
  }

  function problems(): string[] {
    return checkWorkspace(workspace.root);
  }

  beforeEach(() => {
    workspace = new TemporaryWorkspace('check-workspace');
    write('package.json', {
      name: 'root',
      private: true,
      devDependencies: {mocha: '^11.8.0'},
    });
    write(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n  - tests/acceptance\n',
    );
    manifest('remote-a');
    manifest('remote-b');
    manifest('lib-x');
    write('tests/acceptance/package.json', {
      name: 'acceptance',
      version: '0.0.0',
      private: true,
    });
    write(
      'tsconfig.base.json',
      '{\n  // comments are allowed\n  "compilerOptions": { "strict": true }, "files": []\n}',
    );
    write('packages/remote-a/tsconfig.json', {
      extends: '../../tsconfig.base.json',
      include: ['src'],
    });
  });
  afterEach(() => {
    workspace.remove();
  });

  it('accepts declared workspace dependencies on libraries, with their links and references', () => {
    manifest('remote-a', {
      dependencies: {'lib-x': 'workspace:*'},
      devDependencies: {mocha: 'catalog:'},
    });
    manifest('lib-x', {imports: {'#internal': './src/internal.ts'}});
    write(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n  - tests/acceptance\ncatalog:\n  mocha: ^11.8.0\nnodeLinker: isolated\n',
    );
    write('packages/lib-x/tsconfig.json', {
      extends: '../../tsconfig.base.json',
      include: ['src'],
    });
    write('packages/lib-x/src/index.ts', 'export const x = 1;');
    write('packages/remote-a/src/index.ts', 'export const a = 1;');
    write('packages/remote-a/tsconfig.json', {
      extends: '../../tsconfig.base.json',
      include: ['src'],
      references: [{path: '../lib-x'}],
    });
    link('packages/remote-a/node_modules/lib-x', 'packages/lib-x');
    link('node_modules/mocha', 'node_modules/.pnpm/mocha');
    deepStrictEqual(problems(), []);
  });

  describe('package manifests', () => {
    it('reports an extension that lists another extension, in any field', () => {
      manifest('remote-a', {devDependencies: {'remote-b': 'workspace:*'}});
      deepStrictEqual(problems(), [
        `${remoteAManifest}: devDependencies.remote-b: extension remote-a reaches extension remote-b (layout.md rule 3)`,
      ]);
    });

    it('reports a library that lists an extension', () => {
      manifest('lib-x', {peerDependencies: {'remote-a': 'workspace:^'}});
      deepStrictEqual(problems(), [
        'packages/lib-x/package.json: peerDependencies.remote-a: library lib-x reaches extension remote-a (layout.md rule 4)',
      ]);
    });

    it('reports an aliased workspace dependency and checks its target', () => {
      manifest('remote-a', {
        dependencies: {
          'wsl-alias': 'workspace:remote-b@*',
          'x-alias': 'workspace:lib-x@*',
        },
      });
      deepStrictEqual(problems(), [
        `${remoteAManifest}: dependencies.wsl-alias aliases remote-b`,
        `${remoteAManifest}: dependencies.wsl-alias: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        `${remoteAManifest}: dependencies.x-alias aliases lib-x`,
      ]);
    });

    it('reports npm:, link: and file: routes and a missing workspace: protocol', () => {
      manifest('remote-a', {
        dependencies: {
          aliased: 'npm:lib-x@^1',
          linked: 'link:../lib-x',
          copied: 'file:../remote-b',
          'lib-x': '^0.0.0',
        },
      });
      deepStrictEqual(problems(), [
        `${remoteAManifest}: dependencies.aliased aliases workspace package lib-x through npm:`,
        `${remoteAManifest}: dependencies.linked uses link:; dependencies are workspace: or registry packages`,
        `${remoteAManifest}: dependencies.copied uses file:; dependencies are workspace: or registry packages`,
        `${remoteAManifest}: dependencies.copied: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        `${remoteAManifest}: dependencies.lib-x names a workspace package without the workspace: protocol`,
      ]);
    });

    it('follows catalog: entries', () => {
      write(
        'pnpm-workspace.yaml',
        'packages:\n  - packages/*\n  - tests/acceptance\ncatalogs:\n  tools:\n    bridge: link:packages/remote-b\n',
      );
      manifest('remote-a', {dependencies: {bridge: 'catalog:tools'}});
      deepStrictEqual(problems(), [
        `${remoteAManifest}: dependencies.bridge (catalog tools) uses link:; dependencies are workspace: or registry packages`,
        `${remoteAManifest}: dependencies.bridge: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        "pnpm-workspace.yaml: catalogs.tools.bridge: 'link:packages/remote-b' uses link:",
      ]);
    });

    it('reports a link: to a folder outside packages/, and its installed link', () => {
      write(
        'shared/bridge/index.ts',
        "export * from '../../packages/remote-b/src/index.ts';",
      );
      manifest('remote-a', {
        dependencies: {bridge: 'link:../../shared/bridge'},
      });
      link('packages/remote-a/node_modules/bridge', 'shared/bridge');
      deepStrictEqual(problems(), [
        `${remoteAManifest}: dependencies.bridge uses link:; dependencies are workspace: or registry packages`,
        `packages/remote-a/node_modules/bridge: links ${path.join('shared', 'bridge')}, which is not a workspace package`,
      ]);
    });

    it('reports a manifest that cannot be parsed', () => {
      write(remoteAManifest, '{ "name": "remote-a", ');
      write('package.json', '{');
      deepStrictEqual(
        problems().map(problem =>
          problem.replace(/: cannot be read: .*/, ': cannot be read'),
        ),
        [`${remoteAManifest}: cannot be read`, 'package.json: cannot be read'],
      );
    });

    it('reports a workspace: dependency that names no package', () => {
      manifest('remote-a', {dependencies: {'lib-gone': 'workspace:*'}});
      deepStrictEqual(problems(), [
        `${remoteAManifest}: dependencies.lib-gone names no workspace package`,
      ]);
    });

    it('reports imports targets outside the package, a package that is not private, and package-level overrides', () => {
      write(remoteAManifest, {
        name: 'remote-a',
        imports: {'#b': '../remote-b/src/index.ts', '#c': {node: 'remote-b'}},
        pnpm: {overrides: {}},
      });
      deepStrictEqual(problems(), [
        `${remoteAManifest}: "private" is not true`,
        `${remoteAManifest}: imports target '../remote-b/src/index.ts' is outside the package`,
        `${remoteAManifest}: imports target 'remote-b' is outside the package`,
        `${remoteAManifest}: "pnpm" belongs in the root, not a package`,
      ]);
    });
  });

  describe('root configuration', () => {
    it('reports a root dependency that links a workspace package into the root', () => {
      write('package.json', {
        name: 'root',
        private: true,
        devDependencies: {'root-b': 'workspace:remote-b@*'},
      });
      deepStrictEqual(problems(), [
        'package.json: devDependencies.root-b aliases remote-b',
        'package.json: devDependencies.root-b links workspace package remote-b into the root',
      ]);
    });

    it('reports overrides, package extensions and resolutions that route to workspace packages', () => {
      write('package.json', {
        name: 'root',
        private: true,
        pnpm: {overrides: {'some-dep': 'link:packages/remote-b'}},
      });
      write(
        'pnpm-workspace.yaml',
        [
          'packages:',
          '  - packages/*',
          '  - tests/acceptance',
          'overrides:',
          "  'foo>bar': workspace:remote-b@*",
          'packageExtensions:',
          "  'remote-a@*':",
          '    dependencies:',
          '      lib-x: workspace:*',
          '',
        ].join('\n'),
      );
      deepStrictEqual(problems(), [
        "package.json: pnpm.overrides.some-dep: 'link:packages/remote-b' uses link:",
        "pnpm-workspace.yaml: overrides.foo>bar: 'workspace:remote-b@*' routes to workspace package remote-b",
        "pnpm-workspace.yaml: packageExtensions: key 'remote-a@*' names workspace package remote-a",
        "pnpm-workspace.yaml: packageExtensions.remote-a@*.dependencies: key 'lib-x' names workspace package lib-x",
      ]);
    });

    it('reports a workspace beyond packages/* and linkWorkspacePackages', () => {
      write(
        'pnpm-workspace.yaml',
        'packages:\n  - packages/*\n  - extras/*\nlinkWorkspacePackages: true\n',
      );
      deepStrictEqual(problems(), [
        'pnpm-workspace.yaml: packages is ["packages/*","extras/*"], expected ["packages/*","tests/acceptance"]',
        'pnpm-workspace.yaml: sets linkWorkspacePackages',
      ]);
    });

    it('reports a packages list without tests/acceptance', () => {
      write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
      deepStrictEqual(problems(), [
        'pnpm-workspace.yaml: packages is ["packages/*"], expected ["packages/*","tests/acceptance"]',
      ]);
    });

    it('reports a missing pnpm-workspace.yaml', () => {
      rmSync(path.join(workspace.root, 'pnpm-workspace.yaml'));
      deepStrictEqual(
        problems().map(problem =>
          problem.replace(/: cannot be read: .*/, ': cannot be read'),
        ),
        [
          'pnpm-workspace.yaml: cannot be read',
          'pnpm-workspace.yaml: packages is undefined, expected ["packages/*","tests/acceptance"]',
        ],
      );
    });

    it('reports pnpm hook files and pnpmfile settings', () => {
      write('.pnpmfile.cjs', 'module.exports = {};');
      write('packages/remote-a/pnpmfile.mjs', 'export default {};');
      write(
        'pnpm-workspace.yaml',
        'packages:\n  - packages/*\n  - tests/acceptance\npnpmfile: hooks.cjs\n',
      );
      write('.npmrc', 'global-pnpmfile=/tmp/hooks.cjs\n');
      deepStrictEqual(problems(), [
        '.pnpmfile.cjs: pnpm hook file',
        `${path.join('packages', 'remote-a', 'pnpmfile.mjs')}: pnpm hook file`,
        'pnpm-workspace.yaml: sets pnpmfile',
        '.npmrc: sets global-pnpmfile',
      ]);
    });

    it('reports hoisting into the root', () => {
      write(
        'pnpm-workspace.yaml',
        'packages:\n  - packages/*\n  - tests/acceptance\nnodeLinker: hoisted\nshamefullyHoist: true\npublicHoistPattern: ["*"]\n',
      );
      write('.npmrc', 'shamefully-hoist=true\npublic-hoist-pattern[]=*\n');
      deepStrictEqual(problems(), [
        'pnpm-workspace.yaml: nodeLinker "hoisted"; only \'isolated\' keeps packages apart',
        'pnpm-workspace.yaml: shamefullyHoist hoists into the root',
        'pnpm-workspace.yaml: publicHoistPattern hoists into the root',
        '.npmrc: sets shamefully-hoist',
        '.npmrc: sets public-hoist-pattern',
      ]);
    });
  });

  describe('the acceptance package', () => {
    it('acceptance depending on an extension and a library with workspace:* passes', () => {
      write('tests/acceptance/package.json', {
        name: 'acceptance',
        version: '0.0.0',
        private: true,
        devDependencies: {
          'remote-a': 'workspace:*',
          'lib-x': 'workspace:*',
        },
      });
      deepStrictEqual(problems(), []);
    });

    it('a package depending on acceptance fails: nothing may depend on the acceptance package', () => {
      manifest('remote-b', {devDependencies: {acceptance: 'workspace:*'}});
      deepStrictEqual(problems(), [
        'packages/remote-b/package.json: devDependencies.acceptance: nothing may depend on the acceptance package',
      ]);
    });

    it('acceptance missing private: true fails', () => {
      write('tests/acceptance/package.json', {
        name: 'acceptance',
        version: '0.0.0',
      });
      deepStrictEqual(problems(), [
        'tests/acceptance/package.json: "private" is not true',
      ]);
    });
  });

  describe('tsconfigs', () => {
    function tsconfig(file: string): string {
      return path.join('packages', 'remote-a', file);
    }

    it('reports paths, baseUrl and rootDirs, also through an extends chain', () => {
      write('tsconfig.paths.json', {
        compilerOptions: {paths: {bridge: ['packages/remote-b/src']}},
      });
      write('packages/remote-a/tsconfig.json', {
        extends: '../../tsconfig.paths.json',
        files: [],
      });
      write('packages/remote-a/test/tsconfig.json', {
        compilerOptions: {baseUrl: '.', rootDirs: ['.', '../../remote-b']},
        files: [],
      });
      deepStrictEqual(problems(), [
        'tsconfig.paths.json: sets paths; packages reach each other only by package name',
        `${tsconfig(path.join('test', 'tsconfig.json'))}: sets baseUrl; packages reach each other only by package name`,
        `${tsconfig(path.join('test', 'tsconfig.json'))}: sets rootDirs; packages reach each other only by package name`,
        `${tsconfig('tsconfig.json')}: sets paths; packages reach each other only by package name`,
      ]);
    });

    it('reports a types entry that is a path and accepts package names', () => {
      write('packages/remote-a/tsconfig.json', {
        compilerOptions: {
          types: ['node', '@types/mocha', '../remote-b/src/globals', 'lib/x'],
        },
        files: [],
      });
      deepStrictEqual(problems(), [
        `${tsconfig('tsconfig.json')}: types entry '../remote-b/src/globals' is a path; name a package`,
        `${tsconfig('tsconfig.json')}: types entry 'lib/x' is a path; name a package`,
      ]);
    });

    it("reports another package's files, type roots and undeclared or extension references", () => {
      write('packages/remote-b/src/index.ts', 'export const b = 1;');
      write('packages/remote-b/tsconfig.json', {
        compilerOptions: {composite: true},
        include: ['src'],
      });
      write('packages/lib-x/tsconfig.json', {
        compilerOptions: {composite: true},
        files: [],
      });
      write('packages/remote-a/tsconfig.json', {
        compilerOptions: {typeRoots: ['../remote-b/types']},
        include: ['../remote-b/src'],
        references: [{path: '../remote-b'}, {path: '../lib-x'}],
      });
      const remoteB = path.join('packages', 'remote-b');
      deepStrictEqual(problems(), [
        `${tsconfig('tsconfig.json')}: compiles ${path.join(remoteB, 'src', 'index.ts')} from outside the package (shared types go in a library)`,
        `${tsconfig('tsconfig.json')}: typeRoots entry ${path.join(remoteB, 'types')}`,
        `${tsconfig('tsconfig.json')}: references ${remoteB}: extension remote-a reaches extension remote-b (layout.md rule 3)`,
        `${tsconfig('tsconfig.json')}: references lib-x, which remote-a does not declare`,
      ]);
    });
  });

  describe('the listed-files rule', () => {
    const remoteATsconfig = path.join('packages', 'remote-a', 'tsconfig.json');

    function declarationProjects(): void {
      write('tsconfig.base.json', {
        compilerOptions: {
          strict: true,
          composite: true,
          emitDeclarationOnly: true,
          declaration: true,
          outDir: '${configDir}/.tsc',
          module: 'preserve',
          moduleResolution: 'bundler',
          skipLibCheck: true,
        },
        files: [],
        include: ['${configDir}/src'],
      });
      manifest('remote-a', {dependencies: {'lib-x': 'workspace:*'}});
      manifest('lib-x', {
        exports: {
          '.': {types: './.tsc/src/index.d.ts', default: './src/index.ts'},
        },
      });
      write('packages/lib-x/tsconfig.json', {
        extends: '../../tsconfig.base.json',
      });
      write('packages/lib-x/src/index.ts', 'export const x = 1;');
      write(
        'packages/remote-a/src/index.ts',
        "import {x} from 'lib-x';\nexport const a = x;",
      );
      link('packages/remote-a/node_modules/lib-x', 'packages/lib-x');
      link('node_modules/mocha', 'node_modules/.pnpm/mocha');
    }

    it('accepts a package that references its library dependency', function () {
      // Each test spawns tsc --listFilesOnly, which the CI runner runs more than five times slower
      // than locally.
      this.timeout(10_000);
      declarationProjects();
      write('packages/remote-a/tsconfig.json', {
        extends: '../../tsconfig.base.json',
        references: [{path: '../lib-x'}],
      });
      deepStrictEqual(problems(), []);
    });

    it('names a package that compiles its library dependency sources', function () {
      this.timeout(10_000);
      declarationProjects();
      write('packages/remote-a/tsconfig.json', {
        extends: '../../tsconfig.base.json',
      });
      deepStrictEqual(problems(), [
        `${remoteATsconfig}: compiles lib-x sources; remote-a declares lib-x but is missing a reference to packages/lib-x`,
      ]);
    });
  });

  describe('dependency cycles', () => {
    it('reports a cycle of three libraries once', () => {
      manifest('lib-x', {dependencies: {'lib-y': 'workspace:*'}});
      manifest('lib-y', {dependencies: {'lib-z': 'workspace:*'}});
      manifest('lib-z', {dependencies: {'lib-x': 'workspace:*'}});
      deepStrictEqual(problems(), [
        'packages/lib-x/package.json: dependency cycle lib-x -> lib-y -> lib-z -> lib-x (layout.md rule 4)',
      ]);
    });

    it('accepts a chain of libraries without a cycle', () => {
      manifest('lib-y', {dependencies: {'lib-x': 'workspace:*'}});
      manifest('remote-a', {
        dependencies: {'lib-x': 'workspace:*', 'lib-y': 'workspace:*'},
      });
      deepStrictEqual(problems(), []);
    });
  });

  describe('links', () => {
    it('reports symbolic links inside packages/ and into packages/', () => {
      link('packages/remote-a/src/b', 'packages/remote-b/src');
      link('shared', 'packages/remote-b');
      deepStrictEqual(problems(), [
        `${path.join('packages', 'remote-a', 'src', 'b')}: symbolic link inside packages/`,
        'shared: symbolic link into packages/',
      ]);
    });

    it('reports installed links that reach a workspace package another way', () => {
      link('node_modules/root-b', 'packages/remote-b');
      link('packages/remote-a/node_modules/wsl', 'packages/remote-b');
      link('packages/remote-a/node_modules/@s/x', 'packages/lib-x');
      deepStrictEqual(problems(), [
        'node_modules/root-b: links workspace package remote-b into the root',
        'packages/remote-a/node_modules/@s/x: links lib-x under another name',
        'packages/remote-a/node_modules/wsl: links remote-b under another name',
        'packages/remote-a/node_modules/wsl: extension remote-a reaches extension remote-b (layout.md rule 3)',
      ]);
    });
  });
});
