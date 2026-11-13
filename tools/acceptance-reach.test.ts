/**
 * @fileoverview acceptance-reach: what a change to the launch table, the parts table, a suite's own helper, a package or
 * a workflow file reaches.
 */

import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parse as parseYaml} from 'yaml';
import * as launchTable from './acceptance-launches.ts';
import {
  bundleFolderOf,
  type Launch,
  launchesOf,
} from './acceptance-launches.ts';
import {type PartsTable, suiteFilesIn} from './acceptance-parts.ts';
import {
  changedLabels,
  labelsChangedSince,
  measurableEdit,
  labelsOfChangedParts,
  labelsOfTableSince,
  CI_WORKFLOW,
  IMAGE_FOLDERS,
  LAUNCH_MARKER,
  MAIN_ONLY_LAUNCH_JOBS,
  measuredPaths,
  OWN_JOB_FOLDERS,
  packageReach,
  PARTS_TABLE_FILE,
  PR_LAUNCH_JOBS,
  PR_LAUNCH_WORKFLOW,
  sourceGraph,
  sourcesNaming,
  tableImports,
  type TableModule,
  testsOfHelper,
  withDeletedAsImporters,
  withHelpersAsTests,
  workflowEditReach,
  workflowReach,
} from './acceptance-reach.ts';
import {selectLaunches} from './acceptance-select.ts';
import {acceptanceConfiguration} from './acceptance.ts';
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

  it('tooling-169: an edit of an export no other source imports (hostSetupOf, only its unit tests do) is measured with the imports read; one of an export another source imports (launchGroupOf) is not', () => {
    const real = readFileSync(
      path.join(REPOSITORY_ROOT, 'tools', 'acceptance-launches.ts'),
      'utf8',
    );
    const helperEdited = real.replace(
      `[{command: "pkill -f 'n[c] -lk -p'; true"}]`,
      `[{command: "pkill -f 'n[c] -lk -p' || true"}]`,
    );
    const importedEdited = real.replace(
      "      return 'genuine';",
      "      return 'containers';",
    );
    const imported = tableImports(REPOSITORY_ROOT);
    deepStrictEqual(
      [
        helperEdited !== real && importedEdited !== real,
        measurableEdit(real, helperEdited),
        measurableEdit(real, helperEdited, imported),
        measurableEdit(real, importedEdited, imported),
      ],
      [true, false, true, false],
    );
  });

  it('tooling-169: a change to an export no other source imports leaves the launches to show it; read as imported, it reaches every launch', () => {
    deepStrictEqual(
      [
        changedLabels(
          tableOf([LOCAL], () => 1),
          tableOf([LOCAL], () => 2),
          '/repo',
          name => name !== 'EXTRA',
        ),
        changedLabels(
          tableOf([LOCAL], () => 1),
          tableOf([LOCAL], () => 2),
          '/repo',
        ),
      ],
      [[], undefined],
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

  it("tooling-169: a changed test of a folder its own job runs (server) reaches no launch, until a launch's test imports it", () => {
    const changed = ['tests/acceptance/server/s.test.ts'];
    const alone = measuredPaths(changed, 'HEAD', PACKAGE_LAUNCHES, root);
    write(
      'tests/acceptance/alpha/c.test.ts',
      "import '../server/s.test.ts';\n",
    );
    deepStrictEqual(
      [[...alone], [...measuredPaths(changed, 'HEAD', PACKAGE_LAUNCHES, root)]],
      [
        [['tests/acceptance/server/s.test.ts', []]],
        [['tests/acceptance/server/s.test.ts', ['alpha-one']]],
      ],
    );
  });

  it('tooling-188: an image folder reaches what its builder reaches; another source naming the folder, or no builder naming it, leaves it unmeasured', () => {
    const changed = ['tests/acceptance/ssh-engine/Dockerfile'];
    write('tests/acceptance/ssh-engine/Dockerfile', 'FROM scratch\n');
    const unnamed = [...measuredPaths(changed, 'HEAD', PACKAGE_LAUNCHES, root)];
    write(
      'tests/acceptance/windows/engine-fixture.ts',
      "export const folder = 'ssh-engine';\n",
    );
    write(
      'tests/acceptance/alpha/e.test.ts',
      "import {folder} from '../windows/engine-fixture.ts';\n",
    );
    const built = [...measuredPaths(changed, 'HEAD', PACKAGE_LAUNCHES, root)];
    write('tools/also.ts', "const folder = 'ssh-engine';\n");
    deepStrictEqual(
      [
        unnamed,
        built,
        [...measuredPaths(changed, 'HEAD', PACKAGE_LAUNCHES, root)],
      ],
      [[], [['tests/acceptance/ssh-engine/Dockerfile', ['alpha-one']]], []],
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

  it('tooling-169: the changed paths of a package are measured unless they are its unit tests, a package that reaches every launch is not measured, and the parts table is', () => {
    const measured = measuredPaths(
      [
        'packages/lib-wsl/src/wsl.ts',
        'packages/lib-wsl/src/path.ts',
        'packages/lib-wsl/test/unit/wsl.test.ts',
        'packages/lib-host/src/host.ts',
        'docs/notes.md',
        PARTS_TABLE_FILE,
      ],
      'HEAD',
      launchesOf(REPOSITORY_ROOT),
      REPOSITORY_ROOT,
    );
    deepStrictEqual(
      [[...measured.keys()], measured.get(PARTS_TABLE_FILE)],
      [
        [
          'packages/lib-wsl/src/wsl.ts',
          'packages/lib-wsl/src/path.ts',
          PARTS_TABLE_FILE,
        ],
        [],
      ],
    );
  });
});

describe('acceptance-reach: what a change to the parts table reaches (card tooling-169)', () => {
  const launches = launchesOf(REPOSITORY_ROOT);
  const table = JSON.parse(
    readFileSync(path.join(REPOSITORY_ROOT, PARTS_TABLE_FILE), 'utf8'),
  ) as PartsTable;
  /** The labels of the parts that `after` makes otherwise than the repository's table. */
  function changedBy(after: PartsTable): string[] {
    return labelsOfChangedParts(
      table,
      after,
      launches,
      suiteFilesIn(REPOSITORY_ROOT),
    );
  }

  it('tooling-169: the same table, or one without a pin that changes no part, reaches no launch', () => {
    deepStrictEqual(
      [changedBy(table), changedBy({...table, together: []})],
      [[], []],
    );
  });

  it("tooling-169: a launch's minutes that change its part reach the launches of the parts made otherwise, and no other group", () => {
    const reached = changedBy({
      ...table,
      minutes: {...table.minutes, slow: 30},
    });
    deepStrictEqual(
      [reached.includes('slow'), reached.includes('containers-a')],
      [true, false],
    );
  });

  it("tooling-169: the table at HEAD reaches no launch, and a base whose table can't be read reaches every launch", () => {
    deepStrictEqual(
      [
        labelsOfTableSince('HEAD', launches, REPOSITORY_ROOT),
        labelsOfTableSince('no-such-commit', launches, REPOSITORY_ROOT),
      ],
      [[], undefined],
    );
  });
});

describe('acceptance-reach: the names other sources import from the launch table (card tooling-169)', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'table-imports-'));
    write(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\n  - tests/acceptance\n',
    );
    write(
      'tests/acceptance/package.json',
      JSON.stringify({name: 'acceptance'}),
    );
    mkdirSync(path.join(root, 'packages'));
    write('tools/acceptance-launches.ts', 'export const alpha = 1;\n');
    write(
      'tools/named.ts',
      "import {alpha, beta as gamma} from './acceptance-launches.ts';\n",
    );
    write(
      'tools/again.ts',
      "export {delta} from './acceptance-launches.ts';\nimport type {Epsilon} from './acceptance-launches.ts';\n",
    );
    write(
      'tools/named.test.ts',
      "import * as table from './acceptance-launches.ts';\n",
    );
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('tooling-169: named imports and re-exports, types too, are the names; a unit test is no importer', () => {
    const imported = tableImports(root);
    deepStrictEqual(
      ['alpha', 'beta', 'gamma', 'delta', 'Epsilon', 'zeta'].map(imported),
      [true, true, false, true, true, false],
    );
  });

  it('tooling-169: a namespace or default import, export *, a dynamic import, a require or an import of require uses every name', () => {
    deepStrictEqual(
      [
        "import * as table from './acceptance-launches.ts';",
        "import table from './acceptance-launches.ts';",
        "export * from './acceptance-launches.ts';",
        "const table = await import('./acceptance-launches.ts');",
        "const table = require('./acceptance-launches.ts');",
        "import table = require('./acceptance-launches.ts');",
      ].map(line => {
        write('tools/every.ts', `${line}\n`);
        return tableImports(root)('zeta');
      }),
      [true, true, true, true, true, true],
    );
  });

  it("tooling-169: a workspace the graph can't read leaves every name imported", () => {
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    deepStrictEqual(tableImports(root)('zeta'), true);
  });
});

describe('acceptance-reach: the tests of a folder its own job runs (card tooling-169)', () => {
  it('tooling-169, tooling-143: in the repository a server, shared-suite or containers-cli test reaches no launch; a server helper and a folder of no job are not measured', () => {
    deepStrictEqual(
      [
        ...measuredPaths(
          [
            'tests/acceptance/server/login-shells.test.ts',
            'tests/acceptance/suite/host.test.ts',
            'tests/acceptance/containers-cli/cli-bridge.test.ts',
            'tests/acceptance/server/helper-stop.ts',
            'tests/acceptance/elsewhere/x.test.ts',
          ],
          'HEAD',
          launchesOf(REPOSITORY_ROOT),
          REPOSITORY_ROOT,
        ),
      ],
      [
        ['tests/acceptance/server/login-shells.test.ts', []],
        ['tests/acceptance/suite/host.test.ts', []],
        ['tests/acceptance/containers-cli/cli-bridge.test.ts', []],
      ],
    );
  });

  it("tooling-169: each folder's script is in package.json and a CI job runs it, the server and containers-cli scripts on their folders and the slice's run on the shared suite's bundle", () => {
    const scripts = (
      JSON.parse(
        readFileSync(path.join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
      ) as {scripts: Record<string, string>}
    ).scripts;
    const workflow = readFileSync(
      path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    deepStrictEqual(
      [
        [...OWN_JOB_FOLDERS].map(([folder, script]) => [
          folder,
          new RegExp(`pnpm ${script}(?![\\w:-])`).test(workflow),
        ]),
        ['server', 'containers-cli'].map(folder =>
          scripts[String(OWN_JOB_FOLDERS.get(folder))]?.includes(
            `'tests/acceptance/${folder}/*.test.ts'`,
          ),
        ),
        acceptanceConfiguration(REPOSITORY_ROOT, {}).files ===
          `${bundleFolderOf('suite')}/**/*.test.cjs`,
      ],
      [
        [
          ['server', true],
          ['suite', true],
          ['containers-cli', true],
        ],
        [true, true],
        true,
      ],
    );
  });
});

describe("acceptance-reach: what a workflow file's change reaches (card tooling-177)", () => {
  const WORKFLOW = [
    'name: ci',
    'on: [pull_request]',
    'jobs:',
    '  changes:',
    '    runs-on: ubuntu-24.04',
    '    steps: [{run: echo changes}]',
    '  checks:',
    '    needs: changes',
    '    runs-on: ubuntu-24.04',
    '    steps: [{run: pnpm lint}]',
    '  acceptance-pr:',
    '    uses: ./.github/workflows/acceptance-launches.yml',
    '  vscodium-plan:',
    '    if: inputs.vscodium',
    '    steps: [{run: node tools/acceptance-parts.ts --matrix}]',
    '  ci-gate:',
    '    needs: [changes, checks, acceptance-pr]',
    '    steps: [{run: echo gate}]',
    '',
  ].join('\n');
  /** The workflow with `before`, which must be in it, replaced by `after`. */
  function edited(before: string, after: string): string {
    if (!WORKFLOW.includes(before)) {
      throw new Error(`the workflow has no ${before}`);
    }
    return WORKFLOW.replace(before, after);
  }
  /** What ci.yml's change from WORKFLOW to `after` reaches. */
  function reachOfCi(after: string): string[] | undefined {
    return workflowEditReach(CI_WORKFLOW, WORKFLOW, after);
  }

  it('tooling-177: a comment, a job that makes no launch, a job only such jobs need, a new such job in the gate, or a job that makes launches only on main reaches no launch', () => {
    deepStrictEqual(
      [
        reachOfCi(edited('  checks:\n', '  # the lint\n  checks:\n')),
        reachOfCi(edited('pnpm lint', 'pnpm lint --quiet')),
        reachOfCi(edited('echo changes', 'echo more')),
        reachOfCi(
          edited(
            '  ci-gate:\n    needs: [changes, checks, acceptance-pr]',
            '  extra:\n    steps: [{run: pnpm test:acceptance:containers-cli}]\n  ci-gate:\n    needs: [changes, checks, acceptance-pr, extra]',
          ),
        ),
        reachOfCi(edited('--matrix', '--matrix --quiet')),
      ],
      [[], [], [], [], []],
    );
  });

  it("tooling-177: a change to the job that makes a pull request's launches, to a job it needs, or to a new job that makes launches reaches every launch", () => {
    const needing = edited(
      '    uses: ./.github/workflows/acceptance-launches.yml',
      '    needs: changes\n    uses: ./.github/workflows/acceptance-launches.yml',
    );
    deepStrictEqual(
      [
        reachOfCi(
          edited(
            '    uses: ./.github/workflows/acceptance-launches.yml',
            '    uses: ./.github/workflows/acceptance-launches.yml\n    secrets: inherit',
          ),
        ),
        workflowEditReach(
          CI_WORKFLOW,
          needing,
          needing.replace('echo changes', 'echo more'),
        ),
        reachOfCi(
          edited(
            '  ci-gate:',
            '  more:\n    steps: [{run: pnpm test:acceptance:vscodium --launches local}]\n  ci-gate:',
          ),
        ),
      ],
      [undefined, undefined, undefined],
    );
  });

  it("tooling-177: a change of anything but the jobs, a side that isn't a workflow, any job of the launches workflow, or another file's job that makes launches reaches every launch; a comment there reaches none", () => {
    const launchesWorkflow = 'jobs:\n  run:\n    steps: [{run: echo run}]\n';
    const other =
      'jobs:\n  build:\n    steps: [{run: pnpm test:acceptance:vscodium}]\n  notes:\n    steps: [{run: echo notes}]\n';
    deepStrictEqual(
      [
        reachOfCi(edited('on: [pull_request]', 'on: [pull_request, push]')),
        reachOfCi(`${WORKFLOW}  : : [\n`),
        reachOfCi('- a list\n'),
        reachOfCi('name: no jobs\n'),
        workflowEditReach(
          PR_LAUNCH_WORKFLOW,
          launchesWorkflow,
          launchesWorkflow.replace('echo run', 'echo again'),
        ),
        workflowEditReach(
          PR_LAUNCH_WORKFLOW,
          launchesWorkflow,
          `# a note\n${launchesWorkflow}`,
        ),
        workflowEditReach(
          '.github/workflows/platform.yml',
          other,
          other.replace(
            'pnpm test:acceptance:vscodium',
            'pnpm test:acceptance:vscodium --quiet',
          ),
        ),
        workflowEditReach(
          '.github/workflows/platform.yml',
          other,
          other.replace('echo notes', 'echo more'),
        ),
      ],
      [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        [],
      ],
    );
  });

  it("tooling-177: in the repository's ci.yml the lists hold: acceptance-pr calls the launches workflow, the main-only jobs' conditions name no pull request, and every job that makes launches is in a list", () => {
    const jobs = (
      parseYaml(
        readFileSync(path.join(REPOSITORY_ROOT, CI_WORKFLOW), 'utf8'),
      ) as {jobs: Record<string, {uses?: string; if?: string}>}
    ).jobs;
    deepStrictEqual(
      [
        [...PR_LAUNCH_JOBS].map(name => jobs[name]?.uses),
        [...MAIN_ONLY_LAUNCH_JOBS].map(name => {
          const condition = String(jobs[name]?.if);
          return (
            condition.includes('inputs.') && !condition.includes('pull_request')
          );
        }),
        Object.entries(jobs)
          .filter(([, definition]) =>
            LAUNCH_MARKER.test(JSON.stringify(definition)),
          )
          .map(([name]) => name)
          .filter(
            name =>
              !PR_LAUNCH_JOBS.has(name) && !MAIN_ONLY_LAUNCH_JOBS.has(name),
          ),
      ],
      [[`./${PR_LAUNCH_WORKFLOW}`], [true, true, true, true], []],
    );
  });

  it("tooling-177: the repository's ci.yml at HEAD reaches no launch and is measured so; a base that doesn't exist reaches every launch", () => {
    deepStrictEqual(
      [
        workflowReach(CI_WORKFLOW, 'HEAD', REPOSITORY_ROOT),
        workflowReach(CI_WORKFLOW, 'no-such-commit', REPOSITORY_ROOT),
        [
          ...measuredPaths(
            [CI_WORKFLOW],
            'HEAD',
            launchesOf(REPOSITORY_ROOT),
            REPOSITORY_ROOT,
          ),
        ],
      ],
      [[], undefined, [[CI_WORKFLOW, []]]],
    );
  });
});

describe('acceptance-reach: the image folders (card tooling-188)', () => {
  it("tooling-188: in the repository only the engine fixture names the SSH engine's folder, and a change there reaches the launches of the tests that import the fixture, not every launch", () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    const builder = String(IMAGE_FOLDERS.get('ssh-engine'));
    const graph = sourceGraph(REPOSITORY_ROOT);
    const importers = [
      ...(graph?.importers.get(builder.replace(/\.ts$/, '')) ?? []),
    ];
    const reach =
      measuredPaths(
        ['tests/acceptance/ssh-engine/Dockerfile'],
        'HEAD',
        launches,
        REPOSITORY_ROOT,
      ).get('tests/acceptance/ssh-engine/Dockerfile') ?? [];
    deepStrictEqual(
      [
        sourcesNaming(REPOSITORY_ROOT, 'ssh-engine'),
        [...reach].sort(),
        reach.includes('local'),
      ],
      [
        [builder],
        launches
          .filter(launch =>
            importers.some(importer =>
              importer.startsWith(`tests/acceptance/${launch.suite}/`),
            ),
          )
          .map(launch => launch.label)
          .sort(),
        false,
      ],
    );
  });
});

describe('acceptance-reach: a source deleted or moved since the base (card tooling-191)', () => {
  const ALPHA: Launch[] = [
    {label: 'alpha-one', kind: 'plain', suite: 'alpha'},
    {label: 'beta-one', kind: 'plain', suite: 'beta'},
  ];
  let base = '';
  /** Runs git in the fixture repository and gives its output. */
  function gitOf(...gitArguments: string[]): string {
    return execFileSync(
      'git',
      [
        '-c',
        'user.name=rows',
        '-c',
        'user.email=rows@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...gitArguments,
      ],
      {cwd: root, encoding: 'utf8'},
    );
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'deleted-sources-'));
    gitOf('init', '-q');
    write('tests/acceptance/windows/clones.ts', 'export const one = 1;\n');
    write(
      'tests/acceptance/alpha/a.test.ts',
      "import {one} from '../windows/clones.ts';\n",
    );
    write('tests/acceptance/alpha/b.test.ts', 'const none = 0;\n');
    write('tests/acceptance/windows/lonely.ts', 'export const two = 2;\n');
    write('tests/acceptance/windows/shared.ts', 'export const three = 3;\n');
    write(
      'tests/acceptance/windows/harness.ts',
      "export {three} from './shared.ts';\n",
    );
    write('tests/acceptance/windows/dir/index.ts', 'export const four = 4;\n');
    write(
      'tests/acceptance/beta/c.test.ts',
      "import {four} from '../windows/dir';\n",
    );
    write('tests/acceptance/alpha/gone.test.ts', 'const gone = 0;\n');
    gitOf('add', '-A');
    gitOf('commit', '-q', '-m', 'base');
    base = gitOf('rev-parse', 'HEAD').trim();
    write('tests/acceptance/alpha/clones.ts', 'export const one = 1;\n');
    write(
      'tests/acceptance/alpha/a.test.ts',
      "import {one} from './clones.ts';\n",
    );
    write('tests/acceptance/windows/harness.ts', 'export const three = 3;\n');
    write('tests/acceptance/beta/c.test.ts', 'export const four = 4;\n');
    for (const gone of [
      'tests/acceptance/windows/clones.ts',
      'tests/acceptance/windows/lonely.ts',
      'tests/acceptance/windows/shared.ts',
      'tests/acceptance/windows/dir/index.ts',
      'tests/acceptance/alpha/gone.test.ts',
    ]) {
      rmSync(path.join(root, gone));
    }
    gitOf('add', '-A');
    gitOf('commit', '-q', '-m', 'head');
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it("tooling-191: a helper moved out of the windows harness into its suite stands for its importers at the base, and the change reaches that suite's launches only", () => {
    const changed = withHelpersAsTests(
      withDeletedAsImporters(
        [
          'tests/acceptance/windows/clones.ts',
          'tests/acceptance/alpha/clones.ts',
          'tests/acceptance/alpha/a.test.ts',
        ],
        base,
        root,
      ),
      root,
      new Set(['alpha', 'beta']),
    );
    deepStrictEqual(
      [changed, selectLaunches(changed, ALPHA).labels],
      [['tests/acceptance/alpha/a.test.ts'], ['alpha-one']],
    );
  });

  it("tooling-191: a deleted helper nothing imported, a deleted test, a path that still exists, and any path when the base cannot be read stay as they are; one a windows file imported gives that file, and an index gives its folder's importers", () => {
    deepStrictEqual(
      [
        withDeletedAsImporters(
          [
            'tests/acceptance/windows/lonely.ts',
            'tests/acceptance/alpha/gone.test.ts',
            'tests/acceptance/alpha/b.test.ts',
            'tests/acceptance/windows/shared.ts',
            'tests/acceptance/windows/dir/index.ts',
          ],
          base,
          root,
        ),
        withDeletedAsImporters(
          ['tests/acceptance/windows/clones.ts'],
          'no-such-commit',
          root,
        ),
      ],
      [
        [
          'tests/acceptance/windows/lonely.ts',
          'tests/acceptance/alpha/gone.test.ts',
          'tests/acceptance/alpha/b.test.ts',
          'tests/acceptance/windows/harness.ts',
          'tests/acceptance/beta/c.test.ts',
        ],
        ['tests/acceptance/windows/clones.ts'],
      ],
    );
  });
});
