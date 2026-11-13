/**
 * @fileoverview known-reds: the pull request gate's verdict of a launch against the list, and the list's own checks.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {launchesOf} from './acceptance-launches.ts';
import {
  judgedExitCode,
  type KnownRed,
  knownRedsFileOf,
  knownRedsJudge,
  type LaunchOutcome,
  listProblems,
  outcomeFileOf,
  readKnownReds,
  readOutcome,
  rowTitlesOf,
  verdictLines,
  verdictOf,
} from './known-reds.ts';
import {REPOSITORY_ROOT} from './repository.ts';

const ENTRY: KnownRed = {
  launch: 'ssh-core',
  file: 'ssh-core/terminal.test.ts',
  title: 'F-1 AC-1 (row-a): a row',
  card: 2001,
  owner: 'someone',
  evidence: 42000,
  added: '2026-11-12',
};

/** An outcome that ended, with `failures` and `passes`. */
function ended(
  failures: LaunchOutcome['failures'],
  passes: LaunchOutcome['passes'] = [],
): LaunchOutcome {
  return {ended: true, failures, passes};
}

/** A failed test row of ENTRY's file titled `title`. */
function failedRow(title: string): LaunchOutcome['failures'][number] {
  return {file: ENTRY.file, title, kind: 'test', message: `${title} failed`};
}

/** A folder for one row's files, removed after `body`. */
function withFolder(body: (folder: string) => void): void {
  const folder = mkdtempSync(path.join(tmpdir(), 'known-reds-'));
  try {
    body(folder);
  } finally {
    rmSync(folder, {recursive: true, force: true});
  }
}

describe('known-reds: the verdict of a launch against the list', () => {
  it('a launch whose only failures are listed rows of its own passes, each excused with its message', () => {
    const verdict = verdictOf('ssh-core', ended([failedRow(ENTRY.title)]), [
      ENTRY,
    ]);
    deepStrictEqual(
      [verdict.passes, verdict.excused, verdict.unlisted, verdict.reason],
      [true, [{entry: ENTRY, message: `${ENTRY.title} failed`}], [], undefined],
    );
  });

  it('a failure not on the list fails the launch, and is named', () => {
    const verdict = verdictOf(
      'ssh-core',
      ended([failedRow(ENTRY.title), failedRow('another row')]),
      [ENTRY],
    );
    deepStrictEqual(
      [verdict.passes, verdict.unlisted.map(failure => failure.title)],
      [false, ['another row']],
    );
  });

  it('an entry of another launch does not excuse the same file and title', () => {
    strictEqual(
      verdictOf('trust', ended([failedRow(ENTRY.title)]), [ENTRY]).passes,
      false,
    );
  });

  it('no outcome, a run that did not end, and a failed hook fail the launch whatever the list says', () => {
    const hook = {
      file: ENTRY.file,
      title: '"before all" hook for "a row"',
      kind: 'hook' as const,
      message: 'it broke',
    };
    deepStrictEqual(
      [
        verdictOf('ssh-core', undefined, [ENTRY]),
        verdictOf('ssh-core', {ended: false, failures: [], passes: []}, [
          ENTRY,
        ]),
        verdictOf('ssh-core', ended([hook]), [ENTRY]),
      ].map(verdict => [verdict.passes, verdict.reason]),
      [
        [false, 'the launch wrote no outcome'],
        [false, 'the launch did not reach the end of its run'],
        [false, 'a hook failed: "before all" hook for "a row"'],
      ],
    );
  });

  it('a listed row that passes is named as now green', () => {
    deepStrictEqual(
      verdictOf(
        'ssh-core',
        ended([], [{file: ENTRY.file, title: ENTRY.title}]),
        [ENTRY],
      ).nowGreen,
      [ENTRY],
    );
  });

  it('the lines name each excused row with its issue, owner and message, each row now green, the reason and each unlisted red', () => {
    deepStrictEqual(
      verdictLines('ssh-core', {
        passes: false,
        reason: 'a hook failed: h',
        excused: [{entry: ENTRY, message: 'timed out'}],
        unlisted: [failedRow('another row')],
        nowGreen: [ENTRY],
      }),
      [
        `acceptance: known red (#2001, someone) in ssh-core: ${ENTRY.file}: ${ENTRY.title}: timed out`,
        `acceptance: now green, remove its entry from tools/known-reds.json (#2001) in ssh-core: ${ENTRY.file}: ${ENTRY.title}`,
        'acceptance: ssh-core fails whatever the list says: a hook failed: h',
        `acceptance: red and not a known red in ssh-core: ${ENTRY.file}: another row`,
      ],
    );
  });
});

describe('known-reds: the exit code a launch counts with', () => {
  /** The code and the lines of a judgement of `exitCode` with `outcome` on `event`. */
  function judged(
    exitCode: number,
    outcome: LaunchOutcome | undefined,
    event: string,
  ): [number, string[]] {
    const lines: string[] = [];
    let code = exitCode;
    withFolder(folder => {
      const file = outcomeFileOf(folder, 'ssh-core');
      if (outcome !== undefined) {
        writeFileSync(file, JSON.stringify(outcome));
      }
      code = judgedExitCode(
        exitCode,
        'ssh-core',
        file,
        [ENTRY],
        {GITHUB_EVENT_NAME: event},
        line => lines.push(line),
      );
    });
    return [code, lines];
  }

  it('off a pull request the code stands and nothing is printed, a known red included', () => {
    deepStrictEqual(
      [
        judged(1, ended([failedRow(ENTRY.title)]), 'push'),
        judged(1, ended([failedRow(ENTRY.title)]), 'schedule'),
        judged(1, ended([failedRow(ENTRY.title)]), 'workflow_dispatch'),
      ],
      [
        [1, []],
        [1, []],
        [1, []],
      ],
    );
  });

  it('on a pull request a failure of known reds only counts as passed', () => {
    const [code, lines] = judged(
      1,
      ended([failedRow(ENTRY.title)]),
      'pull_request',
    );
    deepStrictEqual([code, lines.length], [0, 1]);
  });

  it('on a pull request an unlisted red, a launch with no outcome and a hook keep the code', () => {
    deepStrictEqual(
      [
        judged(1, ended([failedRow('another row')]), 'pull_request')[0],
        judged(1, undefined, 'pull_request')[0],
        judged(
          3,
          ended([{...failedRow('h'), kind: 'hook'}]),
          'pull_request',
        )[0],
      ],
      [1, 1, 3],
    );
  });

  it("a code that is not mocha's count of the failures keeps the launch failed, an excused row or not", () => {
    deepStrictEqual(
      [
        judged(2, ended([failedRow(ENTRY.title)]), 'pull_request')[0],
        judged(137, ended([failedRow(ENTRY.title)]), 'pull_request')[0],
      ],
      [2, 137],
    );
  });

  it('a code that is the count of known failures, two of them, counts as passed', () => {
    const lines: string[] = [];
    let code = -1;
    withFolder(folder => {
      const second = {...ENTRY, title: 'F-1 AC-2 (row-b): another row'};
      const file = outcomeFileOf(folder, 'ssh-core');
      writeFileSync(
        file,
        JSON.stringify(
          ended([failedRow(ENTRY.title), failedRow(second.title)]),
        ),
      );
      code = judgedExitCode(
        2,
        'ssh-core',
        file,
        [ENTRY, second],
        {GITHUB_EVENT_NAME: 'pull_request'},
        line => lines.push(line),
      );
    });
    deepStrictEqual([code, lines.length], [0, 2]);
  });

  it('a failed launch with no failure on record keeps its code: nothing was excused', () => {
    strictEqual(judged(1, ended([]), 'pull_request')[0], 1);
  });

  it('a passing launch on a pull request prints only the listed rows now green', () => {
    deepStrictEqual(
      judged(
        0,
        ended([], [{file: ENTRY.file, title: ENTRY.title}]),
        'pull_request',
      ),
      [
        0,
        [
          `acceptance: now green, remove its entry from tools/known-reds.json (#2001) in ssh-core: ${ENTRY.file}: ${ENTRY.title}`,
        ],
      ],
    );
  });
});

describe('known-reds: the outcome file and the judge of a run', () => {
  it('a missing file, one that is no JSON and one that is no outcome read as none', () => {
    withFolder(folder => {
      writeFileSync(path.join(folder, 'junk.json'), '{');
      writeFileSync(path.join(folder, 'other.json'), '{"ended": "yes"}');
      deepStrictEqual(
        [
          readOutcome(path.join(folder, 'none.json')),
          readOutcome(path.join(folder, 'junk.json')),
          readOutcome(path.join(folder, 'other.json')),
        ],
        [undefined, undefined, undefined],
      );
    });
  });

  it("the judge judges plain launches only, and adds its lines to the job's summary", () => {
    withFolder(folder => {
      const summary = path.join(folder, 'summary.md');
      writeFileSync(
        outcomeFileOf(folder, 'ssh-core'),
        JSON.stringify(ended([failedRow('another row')])),
      );
      const judge = knownRedsJudge(REPOSITORY_ROOT, folder, {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_STEP_SUMMARY: summary,
      });
      deepStrictEqual(
        [
          judge(1, {kind: 'plain', label: 'ssh-core'}),
          judge(1, {label: 'local'}),
          readFileSync(summary, 'utf8').includes(
            'red and not a known red in ssh-core',
          ),
        ],
        [1, 1, true],
      );
    });
  });

  it("the reporter writes the run's outcome: each failed row and hook with its first line, and each passed row", () => {
    withFolder(folder => {
      const suite = path.join(folder, 'suite');
      mkdirSync(suite);
      writeFileSync(
        path.join(suite, 'one.test.ts'),
        "describe('one', () => { it('passes', () => {}); it('fails', () => { throw new Error('first\\nsecond'); }); });\n" +
          "describe('two', () => { before(() => { throw new Error('hook broke'); }); it('never runs', () => {}); });\n",
      );
      const outcomeFile = path.join(folder, 'outcome.json');
      spawnSync(
        process.execPath,
        [
          path.join(
            REPOSITORY_ROOT,
            'node_modules',
            'mocha',
            'bin',
            'mocha.js',
          ),
          '--no-config',
          '--extension',
          'ts',
          '--reporter',
          path.join(REPOSITORY_ROOT, 'tools', 'acceptance-file-times.ts'),
          '--spec',
          path.join(suite, 'one.test.ts'),
        ],
        {
          encoding: 'utf8',
          env: {...process.env, REMOTE_OSS_ACCEPTANCE_OUTCOME: outcomeFile},
        },
      );
      deepStrictEqual(readOutcome(outcomeFile), {
        ended: true,
        failures: [
          {
            file: 'suite/one.test.ts',
            title: 'fails',
            kind: 'test',
            message: 'first',
          },
          {
            file: 'suite/one.test.ts',
            title: '"before all" hook for "never runs"',
            kind: 'hook',
            message: 'hook broke',
          },
        ],
        passes: [{file: 'suite/one.test.ts', title: 'passes'}],
      });
    });
  });
});

describe("known-reds: the list's own checks", () => {
  /** A root whose suite `suite` has the file `one.test.ts` with rows titled `titles`. */
  function rootWith(folder: string, titles: readonly string[]): string {
    const suiteFolder = path.join(folder, 'tests', 'acceptance', 'suite');
    mkdirSync(suiteFolder, {recursive: true});
    writeFileSync(
      path.join(suiteFolder, 'one.test.ts'),
      titles.map(title => `it(${JSON.stringify(title)}, () => {});\n`).join(''),
    );
    return folder;
  }

  const SUITES = new Map([['plain-label', 'suite']]);
  const GOOD: KnownRed = {
    ...ENTRY,
    launch: 'plain-label',
    file: 'suite/one.test.ts',
    title: 'a row',
  };

  it('an entry naming a row of its launch has no problem', () => {
    withFolder(folder => {
      deepStrictEqual(
        listProblems(rootWith(folder, ['a row']), [GOOD], SUITES),
        [],
      );
    });
  });

  it('a title that names two rows of its file is refused, since the entry would name both', () => {
    withFolder(folder => {
      deepStrictEqual(
        listProblems(rootWith(folder, ['a row', 'a row']), [GOOD], SUITES),
        [
          'entry 1: 2 rows of suite/one.test.ts are titled a row, so the entry cannot name one',
        ],
      );
    });
  });

  it('a missing field, a wrong kind, a bad card, run or date, a non-plain launch, a foreign file, an unknown title and a repeat are each named', () => {
    withFolder(folder => {
      const root = rootWith(folder, ['a row']);
      deepStrictEqual(
        listProblems(
          root,
          [
            {...GOOD, owner: undefined},
            {...GOOD, card: '7'},
            {...GOOD, card: -1, evidence: 1.5, added: '12 Nov'},
            {...GOOD, launch: 'local'},
            {...GOOD, file: 'other/one.test.ts'},
            {...GOOD, file: 'suite/two.test.ts'},
            {...GOOD, title: 'no such row'},
            GOOD,
            GOOD,
          ],
          SUITES,
        ),
        [
          'entry 1: missing or mistyped: owner',
          'entry 2: missing or mistyped: card',
          'entry 3: the card is not an issue number',
          'entry 3: the evidence is not a run id',
          'entry 3: added is not a YYYY-MM-DD date',
          'entry 4: local is not a plain launch',
          "entry 5: other/one.test.ts is not a file of plain-label's suite suite",
          "entry 6: suite/two.test.ts is not a file of plain-label's suite suite",
          'entry 7: no row of suite/one.test.ts is titled no such row',
          // entry 3 names the same row as entries 8 and 9
          'entry 8: listed twice',
          'entry 9: listed twice',
        ],
      );
    });
  });

  it("a row's title is read from each quoting it may be written in, with escapes undone", () => {
    deepStrictEqual(
      rowTitlesOf(
        "it('single, it\\'s', () => {});\nit(\"double\", async () => {});\nit(`back`, function () {});\nit(title, () => {});\n",
      ),
      ["single, it's", 'double', 'back'],
    );
  });

  it('a tree without a list lists nothing', () => {
    withFolder(folder => {
      deepStrictEqual(readKnownReds(folder), []);
    });
  });

  it("the repository's list names only rows of its plain launches, each once, with every field", () => {
    const suites = new Map(
      launchesOf(REPOSITORY_ROOT).flatMap(launch =>
        launch.kind === 'plain' ? [[launch.label, launch.suite] as const] : [],
      ),
    );
    deepStrictEqual(
      [
        existsSync(knownRedsFileOf(REPOSITORY_ROOT)),
        listProblems(REPOSITORY_ROOT, readKnownReds(REPOSITORY_ROOT), suites),
      ],
      [true, []],
    );
  });
});
