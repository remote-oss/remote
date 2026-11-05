/**
 * @fileoverview acceptance-reach: what a change to the launch table, to a suite's own helper or to a package reaches.
 */

import {deepStrictEqual} from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import * as launchTable from './acceptance-launches.ts';
import {type Launch, launchesOf} from './acceptance-launches.ts';
import {
  changedLabels,
  labelsChangedSince,
  measurableEdit,
  measuredPackages,
  packageReach,
  sourceGraph,
  type TableModule,
  testsOfHelper,
  withHelpersAsTests,
} from './acceptance-reach.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** A launch table of `launches`, with one more export whose value is `extra`. */
function tableOf(launches: Launch[], extra: unknown): TableModule {
  return {
    launchesOf: () => launches,
    launchGroupOf: () => 'ssh',
    settingsOfLaunch: launch => launch.settings,
    needsDevContainerImage: () => false,
    EXTRA: extra,
  };
}

const LOCAL: Launch = {label: 'local', runner: 'runner', suite: 'suite-local'};
const PLAIN: Launch = {label: 'plain', kind: 'plain', suite: 'plain'};

describe('acceptance-reach: the launch table (card tooling-169)', () => {
  it('tooling-169: the launches whose entries differ or are new are the reach; an unchanged table reaches none', () => {
    const before = tableOf([LOCAL, PLAIN], 1);
    deepStrictEqual(
      [
        changedLabels(before, tableOf([LOCAL, PLAIN], 1), '/repo'),
        changedLabels(
          before,
          tableOf(
            [
              LOCAL,
              {...PLAIN, files: ['one.test.ts']},
              {...PLAIN, label: 'more'},
            ],
            1,
          ),
          '/repo',
        ),
      ],
      [[], ['plain', 'more']],
    );
  });

  it('tooling-169: a change to anything else the table exports reaches every launch', () => {
    deepStrictEqual(
      [
        changedLabels(tableOf([LOCAL], 1), tableOf([LOCAL], 2), '/repo'),
        changedLabels(
          tableOf([LOCAL], () => 1),
          tableOf([LOCAL], () => 2),
          '/repo',
        ),
        changedLabels(
          tableOf([LOCAL], new Map([['a', 1]])),
          tableOf([LOCAL], new Map([['a', 2]])),
          '/repo',
        ),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('tooling-169: a pattern, a set or a value of its own class that changes reaches every launch, never none', () => {
    class Holder {
      held = 1;
    }
    deepStrictEqual(
      [
        changedLabels(
          tableOf([LOCAL], /^a$/),
          tableOf([LOCAL], /^b$/),
          '/repo',
        ),
        changedLabels(
          tableOf([LOCAL], new Set(['a'])),
          tableOf([LOCAL], new Set(['b'])),
          '/repo',
        ),
        changedLabels(
          tableOf([LOCAL], new Holder()),
          tableOf([LOCAL], new Holder()),
          '/repo',
        ),
      ],
      [undefined, undefined, undefined],
    );
  });

  it("tooling-169: in the repository's table an edit of launchesOf, of a helper or constant only it uses, or of a comment is measured; one of an export, of what an export uses, or of an import is not", () => {
    const real = readFileSync(
      path.join(REPOSITORY_ROOT, 'tools', 'acceptance-launches.ts'),
      'utf8',
    );
    /** The table with `before` replaced by `after`, which must be in it. */
    function edited(before: string, after: string): string {
      if (!real.includes(before)) {
        throw new Error(`the table has no ${before}`);
      }
      return real.replace(before, after);
    }
    deepStrictEqual(
      [
        edited(
          "forwardingLaunch('agent', 'agentfwd'),",
          "forwardingLaunch('agent', 'other'),",
        ),
        edited(
          'folderUri: `vscode-remote://ssh-remote+${alias}/home/harness`,',
          'folderUri: `vscode-remote://ssh-remote+${alias}/home/other`,',
        ),
        edited(
          'const AGENT_NOTMP_ACL =',
          "const ADDED = 'x';\nconst AGENT_NOTMP_ACL =",
        ).replace(
          "forwardingLaunch('agent', 'agentfwd'),",
          "forwardingLaunch('agent', ADDED),",
        ),
        edited(
          '/** The host setup of the agent-notmp launch',
          '/** The setup of the agent-notmp launch',
        ),
        edited(
          'return value.map(item => withStrings(item as unknown, replace)) as Value;',
          'return value.map(item => withStrings(item as unknown, replace)).reverse() as Value;',
        ),
        edited(
          'export const LABEL_FORM = /^[a-z][a-z0-9-]*$/;',
          'export const LABEL_FORM = /^[a-z][a-z0-9_-]*$/;',
        ),
        edited(
          "import path from 'node:path';",
          "import path from 'node:path';\nimport os from 'node:os';",
        ),
      ].map(text => measurableEdit(real, text)),
      [true, true, true, true, false, false, false],
    );
  });

  it("tooling-169: the repository's table read at HEAD is its own table, and a commit that doesn't exist reaches every launch", async () => {
    deepStrictEqual(
      [
        await labelsChangedSince(
          'HEAD',
          launchTable as unknown as TableModule,
          REPOSITORY_ROOT,
        ),
        await labelsChangedSince(
          'no-such-commit',
          launchTable as unknown as TableModule,
          REPOSITORY_ROOT,
        ),
      ],
      [[], undefined],
    );
  });
});

/** The root of the running row's fixture repository. */
let root = '';

/** Writes `text` at `file` under the fixture root. */
function write(file: string, text: string): void {
  mkdirSync(path.join(root, path.dirname(file)), {recursive: true});
  writeFileSync(path.join(root, file), text);
}

describe("acceptance-reach: a suite's own helper (card tooling-169)", () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'reach-'));
    write('tests/acceptance/alpha/support.ts', 'export const one = 1;\n');
    write(
      'tests/acceptance/alpha/deeper.ts',
      "export {one} from './support.ts';\n",
    );
    write(
      'tests/acceptance/alpha/a.test.ts',
      "import {one} from './support.ts';\n",
    );
    write(
      'tests/acceptance/alpha/b.test.ts',
      "import {one} from './deeper';\n",
    );
    write('tests/acceptance/alpha/c.test.ts', 'const none = 0;\n');
    write('tests/acceptance/alpha/shared.ts', 'export const two = 2;\n');
    write('tests/acceptance/alpha/unused.ts', 'export const three = 3;\n');
    write(
      'tests/acceptance/beta/x.test.ts',
      "import {two} from '../alpha/shared.ts';\n",
    );
    write('tests/acceptance/fixtures/data.ts', 'export const four = 4;\n');
    write(
      'tests/acceptance/fixtures/x.test.ts',
      "import {four} from './data.ts';\n",
    );
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it("tooling-169: a helper stands for the suite's tests that import it, directly or through another helper of the folder", () => {
    deepStrictEqual(testsOfHelper(root, 'tests/acceptance/alpha/support.ts'), [
      'tests/acceptance/alpha/a.test.ts',
      'tests/acceptance/alpha/b.test.ts',
    ]);
  });

  it('tooling-169: an import for its side effect, or a require, counts as importing the helper', () => {
    write('tests/acceptance/gamma/side.ts', 'export {};\n');
    write('tests/acceptance/gamma/s.test.ts', "import './side.ts';\n");
    write('tests/acceptance/delta/r.test.ts', "require('../gamma/side.ts');\n");
    deepStrictEqual(
      [
        testsOfHelper(root, 'tests/acceptance/gamma/side.ts', [
          'tests/acceptance/gamma',
        ]),
        testsOfHelper(root, 'tests/acceptance/gamma/side.ts'),
      ],
      [['tests/acceptance/gamma/s.test.ts'], undefined],
    );
  });

  it('tooling-169: a helper that another folder imports reaches every launch, and one that nothing imports stands for no test', () => {
    deepStrictEqual(
      [
        testsOfHelper(root, 'tests/acceptance/alpha/shared.ts'),
        testsOfHelper(root, 'tests/acceptance/alpha/unused.ts'),
      ],
      [undefined, []],
    );
  });

  it("tooling-169: the changed paths get each suite helper's tests; a shared, unused, harness or non-suite helper stays as it is", () => {
    deepStrictEqual(
      withHelpersAsTests(
        [
          'tests/acceptance/alpha/support.ts',
          'tests/acceptance/alpha/a.test.ts',
          'tests/acceptance/alpha/shared.ts',
          'tests/acceptance/alpha/unused.ts',
          'tests/acceptance/fixtures/data.ts',
          'tests/acceptance/windows/renderer.ts',
          'docs/notes.md',
        ],
        root,
        new Set(['alpha', 'beta', 'windows']),
      ),
      [
        'tests/acceptance/alpha/a.test.ts',
        'tests/acceptance/alpha/b.test.ts',
        'tests/acceptance/alpha/shared.ts',
        'tests/acceptance/alpha/unused.ts',
        'tests/acceptance/fixtures/data.ts',
        'tests/acceptance/windows/renderer.ts',
        'docs/notes.md',
      ],
    );
  });
});

describe('acceptance-reach: what a change to a package reaches (card tooling-169)', () => {
  const PACKAGE_LAUNCHES: Launch[] = [
    {label: 'local', runner: 'runner', suite: 'suite-local'},
    {label: 'alpha-one', kind: 'plain', suite: 'alpha'},
    {
      label: 'containers-one',
      kind: 'plain',
      suite: 'containers',
      withExtensions: ['remote-oss.remote-containers'],
    },
    {
      label: 'containers-two',
      kind: 'plain',
      suite: 'containers-more',
      withExtensions: ['remote-oss.remote-containers'],
    },
    {
      label: 'explorer-one',
      kind: 'plain',
      suite: 'explorer',
      withExtensions: ['remote-oss.remote-explorer'],
    },
  ];
  const CONTAINERS = ['containers-one', 'containers-two'];
  /** Writes a package.json for the package in packages/`name` with these run-time dependencies. */
  function manifest(name: string, ...dependencies: string[]): void {
    write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name,
        dependencies: Object.fromEntries(
          dependencies.map(dependency => [dependency, 'workspace:*']),
        ),
      }),
    );
  }
  /** The reach of each named package of the fixture. */
  function reachOf(...names: string[]): Array<string[] | undefined> {
    const graph = sourceGraph(root);
    if (graph === undefined) {
      throw new Error('the fixture has no graph');
    }
    return names.map(name =>
      packageReach(graph, `packages/${name}`, PACKAGE_LAUNCHES),
    );
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'package-reach-'));
    write(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n  - tests/acceptance\n',
    );
    write(
      'tests/acceptance/package.json',
      JSON.stringify({name: 'acceptance'}),
    );
    manifest('lib-base');
    manifest('lib-middle', 'lib-base');
    manifest('remote-containers', 'lib-middle');
    manifest('remote-explorer', 'lib-unit');
    manifest('remote-ssh', 'lib-ssh-side');
    manifest('lib-ssh-side');
    manifest('lib-unit');
    manifest('lib-unused');
    manifest('lib-tested');
    manifest('lib-relative');
    manifest('lib-harness');
    manifest('lib-tool');
    manifest('lib-indexed');
    write(
      'packages/remote-containers/test/unit/a.test.ts',
      "import {one} from 'lib-unused';\n",
    );
    write('tools/a.test.ts', "import {one} from 'lib-unit';\n");
    write('tools/run.ts', "import {one} from 'lib-tool';\n");
    write(
      'tests/acceptance/alpha/support.ts',
      "export {one} from 'lib-tested';\n",
    );
    write(
      'tests/acceptance/alpha/mid.ts',
      "export {one} from './support.ts';\n",
    );
    write(
      'tests/acceptance/alpha/a.test.ts',
      "import {one} from './support.ts';\nimport {one as two} from './mid.ts';\n",
    );
    write(
      'tests/acceptance/alpha/b.test.ts',
      "import {one} from '../../../packages/lib-relative/src/one.ts';\n",
    );
    write(
      'tests/acceptance/server/s.test.ts',
      "import {one} from '../../../packages/remote-containers/src/one.ts';\nimport {two} from 'lib-base';\n",
    );
    write(
      'tests/acceptance/windows/helper.ts',
      "import {one} from 'lib-harness';\n",
    );
    write(
      'tests/acceptance/alpha/shared/index.ts',
      "export {one} from 'lib-indexed';\n",
    );
    write(
      'tests/acceptance/alpha/d.test.ts',
      "import {one} from './shared';\n",
    );
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it("tooling-169: a library reaches the launches of the extensions that depend on it, through other libraries; the extension's own change the same", () => {
    deepStrictEqual(reachOf('lib-base', 'lib-middle', 'remote-containers'), [
      CONTAINERS,
      CONTAINERS,
      CONTAINERS,
    ]);
  });

  it('tooling-169: a library an extension no launch carries by its id depends on (remote-ssh, in every launch) reaches every launch, and so does that extension', () => {
    deepStrictEqual(reachOf('lib-ssh-side', 'remote-ssh'), [
      undefined,
      undefined,
    ]);
  });

  it("tooling-169: a library that a launch's test imports, through a helper of its suite, a folder's index or a path into the package, reaches that launch", () => {
    deepStrictEqual(reachOf('lib-tested', 'lib-relative', 'lib-indexed'), [
      ['alpha-one'],
      ['alpha-one'],
      ['alpha-one'],
    ]);
  });

  it("tooling-169: a test of a folder no launch runs (the server tests, importing the containers package and a library) adds no launch, until a launch's test imports it", () => {
    const alone = reachOf('lib-base', 'remote-containers');
    write(
      'tests/acceptance/alpha/c.test.ts',
      "import '../server/s.test.ts';\n",
    );
    deepStrictEqual(
      [alone, reachOf('lib-base')],
      [[CONTAINERS, CONTAINERS], [['alpha-one', ...CONTAINERS]]],
    );
  });

  it('tooling-169: a library that only unit tests use reaches every launch, since the imports show no launch, as does one that nothing uses; a unit test adds nothing', () => {
    deepStrictEqual(reachOf('lib-unused', 'lib-unit'), [
      undefined,
      ['explorer-one'],
    ]);
  });

  it('tooling-169: a library that a source no test imports (the windows harness) or a tool imports reaches every launch, and so does one whose helper a tool imports', () => {
    const alone = reachOf('lib-harness', 'lib-tool');
    write(
      'tools/uses-helper.ts',
      "import {one} from '../tests/acceptance/alpha/support.ts';\n",
    );
    deepStrictEqual(
      [alone, reachOf('lib-tested')],
      [[undefined, undefined], [undefined]],
    );
  });

  it('tooling-169: an import of the acceptance package by its name, or a workspace of other folders, leaves no measure', () => {
    write(
      'tools/by-name.ts',
      "import {one} from 'acceptance/alpha/support.ts';\n",
    );
    const byName = reachOf('lib-tested');
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    deepStrictEqual([byName, sourceGraph(root)], [[undefined], undefined]);
  });

  it('tooling-169: in the repository, lib-wsl and remote-containers reach the launches that install Dev Containers, and lib-host every launch', () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    const graph = sourceGraph(REPOSITORY_ROOT);
    if (graph === undefined) {
      throw new Error('the repository has no graph');
    }
    const containers = launches
      .filter(
        launch =>
          launch.kind === 'plain' &&
          (launch.withExtensions ?? []).includes(
            'remote-oss.remote-containers',
          ),
      )
      .map(launch => launch.label);
    deepStrictEqual(
      ['lib-wsl', 'remote-containers', 'lib-host'].map(name =>
        packageReach(graph, `packages/${name}`, launches),
      ),
      [containers, containers, undefined],
    );
  });

  it("tooling-169: no source the graph holds (none but unit tests and the selection itself is left out) imports the selection's own modules, so they reach no launch", () => {
    const graph = sourceGraph(REPOSITORY_ROOT);
    deepStrictEqual(
      ['tools/acceptance-select', 'tools/acceptance-reach'].map(module => [
        ...(graph?.importers.get(module) ?? []),
      ]),
      [[], []],
    );
  });

  it('tooling-169: the changed paths of a package are measured unless they are its unit tests, and a package that reaches every launch is not measured', () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    deepStrictEqual(
      [
        ...measuredPackages(
          [
            'packages/lib-wsl/src/wsl.ts',
            'packages/lib-wsl/src/path.ts',
            'packages/lib-wsl/test/unit/wsl.test.ts',
            'packages/lib-host/src/host.ts',
            'docs/notes.md',
          ],
          launches,
          REPOSITORY_ROOT,
        ).keys(),
      ],
      ['packages/lib-wsl/src/wsl.ts', 'packages/lib-wsl/src/path.ts'],
    );
  });
});
