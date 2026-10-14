import {deepStrictEqual} from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  casePlatforms,
  checkVscodePin,
  main,
  markdown,
  merge,
  mergeFolder,
  readCases,
  replayable,
  shard,
  type SuiteCase,
} from './conformance-shards.ts';
import {messageOf} from './repository.ts';

/** A recorded case valid on `platforms` (the first is where it was recorded). */
function suiteCase(
  name: string,
  platforms: readonly string[],
  status = 'recorded',
  vscodeVersion = '1.139.1',
): SuiteCase {
  return {name, status, platforms, vscodeVersion};
}

/** What `action` throws, as its message; empty when it returns. */
function thrown(action: () => unknown): string {
  try {
    action();
    return '';
  } catch (caught) {
    return messageOf(caught);
  }
}

/** The result of `body` on a scratch folder, removed afterwards. */
function inFolder<Result>(body: (folder: string) => Result): Result {
  const folder = mkdtempSync(join(tmpdir(), 'conformance-shards-'));
  try {
    return body(folder);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

/** Writes `text` to `file` under `folder`, making its parent folders. */
function writeUnder(folder: string, file: string, text: string): void {
  mkdirSync(join(folder, file, '..'), {recursive: true});
  writeFileSync(join(folder, file), text);
}

/** Ignores a command line's output. */
function discard(): void {
  // the output is not checked
}

const CONFIRMED =
  'status: recorded\nrecorded:\n  platform: linux/arm64\n  vscode_version: 1.139.1\n  confirmed:\n    - platform: linux/x86_64\n';

describe('the conformance replay workflow', () => {
  it('tooling-49: a case recorded on linux/arm64 with no x86_64 confirm is not listed; one confirmed for x86_64 is', () => {
    const cases = [
      suiteCase('F-0201-AC1-1', ['linux/arm64']),
      suiteCase('F-0201-AC1-2', ['linux/arm64', 'linux/x86_64']),
      suiteCase('F-0201-AC1-3', ['linux/x86_64']),
    ];
    deepStrictEqual(replayable(cases), ['F-0201-AC1-2', 'F-0201-AC1-3']);
  });

  it('tooling-49: only recorded and flaky cases are listed', () => {
    const cases = [
      suiteCase('F-0201-AC2-1', ['linux/x86_64'], 'draft'),
      suiteCase('F-0201-AC2-2', ['linux/x86_64'], 'flaky'),
      suiteCase('F-0201-AC2-3', ['linux/x86_64']),
    ];
    deepStrictEqual(replayable(cases), ['F-0201-AC2-2', 'F-0201-AC2-3']);
  });

  it("tooling-49: a case's platforms are recorded.platform and each confirmed platform, once", () => {
    const record = {
      platform: 'linux/arm64',
      confirmed: [
        {platform: 'linux/x86_64'},
        {platform: 'linux/x86_64'},
        {date: 'x'},
        null,
      ],
    };
    deepStrictEqual(
      [
        casePlatforms(record),
        casePlatforms(undefined),
        casePlatforms({confirmed: 'x'}),
      ],
      [['linux/arm64', 'linux/x86_64'], [], []],
    );
  });

  it('tooling-49: 10 cases over 4 shards gives 3, 3, 2, 2 in name order', () => {
    const names = Array.from(
      {length: 10},
      (unused, index) => `F-0201-AC${String(index).padStart(2, '0')}-1`,
    );
    const shards = shard(names, 4);
    deepStrictEqual(
      [shards.map(list => list.length), shards[0]],
      [
        [3, 3, 2, 2],
        [names[0], names[4], names[8]],
      ],
    );
  });

  it('tooling-49: no cases gives one empty shard, and fewer cases than shards gives one shard per case', () => {
    deepStrictEqual(
      [shard([], 4), shard(['F-0201-AC1-1', 'F-0201-AC1-2'], 4)],
      [[[]], [['F-0201-AC1-1'], ['F-0201-AC1-2']]],
    );
  });

  it('tooling-49: a shard count that is not a whole number of at least 1 throws', () => {
    deepStrictEqual(
      [thrown(() => shard(['x'], 0)), thrown(() => shard(['x'], 1.5))],
      [
        'shards must be a whole number of at least 1: 0',
        'shards must be a whole number of at least 1: 1.5',
      ],
    );
  });

  it("tooling-49: the VS Code rpm pin is the suite's recorded.vscode_version", () => {
    const pinned = suiteCase('F-0201-AC1-1', ['linux/x86_64']);
    const newer = suiteCase(
      'F-0201-AC1-2',
      ['linux/arm64'],
      'recorded',
      '1.140.0',
    );
    deepStrictEqual(
      [
        thrown(() => {
          checkVscodePin([pinned, newer], ['F-0201-AC1-1'], '1.139.1');
        }),
        thrown(() => {
          checkVscodePin(
            [pinned, newer],
            ['F-0201-AC1-1', 'F-0201-AC1-2'],
            '1.139.1',
          );
        }),
        thrown(() => {
          checkVscodePin(
            [{...pinned, vscodeVersion: undefined}],
            ['F-0201-AC1-1'],
            '1.139.1',
          );
        }),
      ],
      [
        '',
        "the workflow pins VS Code 1.139.1, the suite's cases were recorded on 1.139.1, 1.140.0",
        "the workflow pins VS Code 1.139.1, the suite's cases were recorded on none",
      ],
    );
  });

  it("tooling-49: the workflow's pinned version and rpm name agree, and the rpm's sha256 is pinned", () => {
    const workflow = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '.github',
        'workflows',
        'conformance.yml',
      ),
      'utf8',
    );
    const version = /VSCODE_VERSION: '(?<version>[\d.]+)'/u.exec(workflow)
      ?.groups?.version;
    const rpmVersion =
      /VSCODE_RPM: 'code-(?<version>[\d.]+)-\d+\.el8\.x86_64\.rpm'/u.exec(
        workflow,
      )?.groups?.version;
    const digest = /VSCODE_RPM_SHA256: '[0-9a-f]{64}'/u.test(workflow);
    deepStrictEqual([rpmVersion, digest], [version, true]);
  });

  it('tooling-49: shard summaries merge: counts add per feature, and the failing cases carry their first difference', () => {
    const merged = merge(
      [
        {
          cases: {
            'F-0201-AC1-1': {result: 'pass'},
            'F-0409-AC5-2': {result: 'fail', reason: 'mismatch'},
          },
        },
        {
          cases: {
            'F-0201-AC1-2': {result: 'pass'},
            'F-0201-AC1-3': {result: 'not-applicable'},
          },
        },
      ],
      name => (name === 'F-0409-AC5-2' ? '/labels: a | b' : ''),
    );
    deepStrictEqual(
      [merged, markdown(merged).split('\n')],
      [
        {
          counts: {
            'F-0201': {pass: 2, 'not-applicable': 1},
            'F-0409': {fail: 1},
          },
          failing: [
            {name: 'F-0409-AC5-2', result: 'fail', first: '/labels: a | b'},
          ],
          passed: false,
        },
        [
          '| feature | pass | fail | not-applicable | not-comparable |',
          '|---|---|---|---|---|',
          '| F-0201 | 2 | 0 | 1 | 0 |',
          '| F-0409 | 0 | 1 | 0 | 0 |',
          '',
          '| case | result | first difference |',
          '|---|---|---|',
          '| F-0409-AC5-2 | fail | /labels: a \\| b |',
          '',
          '**Result: fail**',
        ],
      ],
    );
  });

  it('tooling-49: a not-comparable case fails the merged run, with its reason when it has no difference', () => {
    const stale = merge(
      [
        {
          cases: {
            'F-0201-AC1-1': {result: 'pass'},
            'F-0201-AC1-2': {
              result: 'not-comparable',
              reason: 'sync the runner',
            },
          },
        },
      ],
      () => '',
    );
    const bare = merge([{cases: {'F-0201-AC1-3': {result: 'fail'}}}], () => '');
    deepStrictEqual(
      [stale.passed, stale.failing, bare.failing],
      [
        false,
        [
          {
            name: 'F-0201-AC1-2',
            result: 'not-comparable',
            first: 'sync the runner',
          },
        ],
        [{name: 'F-0201-AC1-3', result: 'fail', first: ''}],
      ],
    );
  });

  it('tooling-49: a run where every case passed passes, and one where none applied fails', () => {
    const passed = merge(
      [{cases: {'F-0201-AC1-1': {result: 'pass'}}}],
      () => '',
    );
    deepStrictEqual(
      [
        passed.passed,
        markdown(passed).split('\n').at(-1),
        merge([{cases: {'F-0201-AC1-1': {result: 'not-applicable'}}}], () => '')
          .passed,
        merge([], () => '').passed,
      ],
      [true, '**Result: pass**', false, false],
    );
  });

  it("tooling-49: a suite's cases are read from suite/<feature>/*.yaml, in name order", () => {
    const cases = inFolder(suite => {
      writeUnder(
        suite,
        'suite/F-0201/F-0201-AC1-2.yaml',
        `id: F-0201-AC1-2\n${CONFIRMED}`,
      );
      writeUnder(suite, 'suite/F-0201/F-0201-AC1-1.yaml', 'status: draft\n');
      writeUnder(suite, 'suite/F-0201/F-0201-AC1-3.yaml', '');
      writeUnder(suite, 'suite/F-0201/README.md', 'not a case\n');
      return readCases(suite, 'F-0201');
    });
    deepStrictEqual(cases, [
      {
        name: 'F-0201-AC1-1',
        status: 'draft',
        platforms: [],
        vscodeVersion: undefined,
      },
      {
        name: 'F-0201-AC1-2',
        status: 'recorded',
        platforms: ['linux/arm64', 'linux/x86_64'],
        vscodeVersion: '1.139.1',
      },
      {
        name: 'F-0201-AC1-3',
        status: undefined,
        platforms: [],
        vscodeVersion: undefined,
      },
    ]);
  });

  it("tooling-49: the shards' result folders merge, each failing case with its own first mismatch", () => {
    const failing = inFolder(root => {
      writeUnder(
        root,
        'results-a/one-suite/summary.json',
        JSON.stringify({cases: {'F-0409-AC5-2': {result: 'fail'}}}),
      );
      writeUnder(
        root,
        'results-a/one-suite/F-0409-AC5-2.json',
        JSON.stringify({mismatches: ['/x: 1 != 2', '/y']}),
      );
      writeUnder(
        root,
        'results-b/two-suite/summary.json',
        JSON.stringify({cases: {'F-0409-AC6-1': {result: 'fail'}}}),
      );
      writeUnder(root, 'results-b/two-suite/F-0409-AC6-1.json', '{not json');
      writeUnder(root, 'results-b/two-suite/note.txt', '');
      return mergeFolder(root).failing;
    });
    deepStrictEqual(failing, [
      {name: 'F-0409-AC5-2', result: 'fail', first: '/x: 1 != 2'},
      {name: 'F-0409-AC6-1', result: 'fail', first: ''},
    ]);
  });

  it('tooling-49: list prints the shards and the count; merge prints the table and exits 1 on a failure', () => {
    const outcome = inFolder(root => {
      writeUnder(root, 'suite/F-0201/F-0201-AC1-1.yaml', CONFIRMED);
      writeUnder(root, 'suite/F-0201/F-0201-AC1-2.yaml', CONFIRMED);
      let listed = '';
      const listStatus = main(
        ['list', root, '2', '1.139.1', 'F-0201'],
        text => {
          listed += text;
        },
      );
      const otherPin = thrown(() =>
        main(['list', root, '2', '1.140.0', 'F-0201'], discard),
      );
      writeUnder(
        root,
        'results/one/summary.json',
        JSON.stringify({cases: {'F-0201-AC1-1': {result: 'pass'}}}),
      );
      let table = '';
      const passStatus = main(['merge', join(root, 'results')], text => {
        table += text;
      });
      writeUnder(
        root,
        'results/two/summary.json',
        JSON.stringify({cases: {'F-0201-AC1-2': {result: 'fail'}}}),
      );
      const failStatus = main(['merge', join(root, 'results')], discard);
      return [
        listStatus,
        JSON.parse(listed) as unknown,
        otherPin,
        passStatus,
        table.endsWith('**Result: pass**\n'),
        failStatus,
      ];
    });
    deepStrictEqual(outcome, [
      0,
      {shards: [['F-0201-AC1-1'], ['F-0201-AC1-2']], count: 2},
      "the workflow pins VS Code 1.140.0, the suite's cases were recorded on 1.139.1",
      0,
      true,
      1,
    ]);
  });

  it('tooling-49: a command line without its arguments throws its usage', () => {
    deepStrictEqual(
      [
        thrown(() => main(['list', 'suite'], discard)),
        thrown(() => main(['merge'], discard)),
        thrown(() => main([], discard)),
      ],
      [
        'usage: list <suite> <shards> <pinned VS Code version> <feature>...',
        'usage: conformance-shards.ts list|merge ...',
        'usage: conformance-shards.ts list|merge ...',
      ],
    );
  });
});
