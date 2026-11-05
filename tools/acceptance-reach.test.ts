/**
 * @fileoverview acceptance-reach: what a change to the launch table or to a suite's own helper reaches.
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
import type {Launch} from './acceptance-launches.ts';
import {
  changedLabels,
  labelsChangedSince,
  measurableEdit,
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

describe("acceptance-reach: a suite's own helper (card tooling-169)", () => {
  let root = '';
  /** Writes `text` at `file` under the fixture root. */
  function write(file: string, text: string): void {
    mkdirSync(path.join(root, path.dirname(file)), {recursive: true});
    writeFileSync(path.join(root, file), text);
  }

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
