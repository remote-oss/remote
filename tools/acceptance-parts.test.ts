/**
 * @fileoverview acceptance-parts: the parts of a VSCodium run from the measured minutes.
 */

import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {type Launch, launchesOf} from './acceptance-launches.ts';
import {
  limitOf,
  PARTS_TABLE,
  type PartsTable,
  partsOfTable,
  refreshedTable,
  suiteFilesIn,
  UNMEASURED_FILE_MINUTES,
  UNMEASURED_LAUNCH_MINUTES,
} from './acceptance-parts.ts';
import {chosenLaunches} from './acceptance.ts';
import {REPOSITORY_ROOT} from './repository.ts';

/** A table of each kind: runner launches, a plain launch with files, a containers launch, and a genuine one. */
const LAUNCHES: Launch[] = [
  {label: 'local', runner: 'runner', suite: 'suite-local'},
  {label: 'second', runner: 'runner-remote', suite: 'suite-second'},
  {label: 'long', kind: 'plain', suite: 'long'},
  {
    label: 'boxes',
    kind: 'plain',
    suite: 'boxes',
    withExtensions: ['remote-oss.remote-containers'],
    files: ['b1.test.ts', 'b2.test.ts'],
  },
  {label: 'genuine', kind: 'plain', suite: 'genuine', client: 'vscode'},
];

/** The files of the fixture suites on no disk. */
function suiteFiles(suite: string): string[] {
  return suite === 'long'
    ? ['l1.test.ts', 'l2.test.ts', 'l3.test.ts', 'l4.test.ts', 'new.test.ts']
    : [];
}

describe('acceptance-parts (card tooling-159)', () => {
  it('tooling-159: the time limit is twice the minutes and ten more, at least thirty', () => {
    deepStrictEqual([0, 9, 10, 14.2, 49.2].map(limitOf), [30, 30, 30, 39, 109]);
  });

  it('tooling-159: a launch over the target runs as its files in their order, cut at the target, an unmeasured file counted at its default; the entries are cut into parts in the table order, group by group, and genuine is left out', () => {
    const table: PartsTable = {
      targetMinutes: 15,
      minutes: {
        local: 9,
        long: {
          'l1.test.ts': 12,
          'l2.test.ts': 10,
          'l3.test.ts': 5,
          'l4.test.ts': 4,
        },
        boxes: 20,
        genuine: 3,
      },
    };
    deepStrictEqual(partsOfTable(LAUNCHES, table, suiteFiles), [
      {
        name: 'ssh 1/4',
        launches: 'local,second',
        minutes: limitOf(9 + UNMEASURED_LAUNCH_MINUTES),
      },
      {name: 'ssh 2/4', launches: 'long:l1.test.ts', minutes: limitOf(12)},
      {
        name: 'ssh 3/4',
        launches: 'long:l2.test.ts+l3.test.ts',
        minutes: limitOf(15),
      },
      {
        name: 'ssh 4/4',
        launches: 'long:l4.test.ts+new.test.ts',
        minutes: limitOf(4 + UNMEASURED_FILE_MINUTES),
      },
      {name: 'containers 1/1', launches: 'boxes', minutes: limitOf(20)},
    ]);
  });

  it('tooling-159: a launch measured by file whose files fit the target, or a runner launch measured by file, runs whole', () => {
    const table: PartsTable = {
      targetMinutes: 15,
      minutes: {
        local: {'one.test.ts': 2, 'two.test.ts': 3},
        long: {'l1.test.ts': 2},
        boxes: {'b1.test.ts': 1, 'b2.test.ts': 1},
      },
    };
    deepStrictEqual(partsOfTable(LAUNCHES, table, suiteFiles), [
      {
        name: 'ssh 1/2',
        launches: 'local,second',
        minutes: limitOf(5 + UNMEASURED_LAUNCH_MINUTES),
      },
      {
        name: 'ssh 2/2',
        launches: 'long',
        minutes: limitOf(2 + 4 * UNMEASURED_FILE_MINUTES),
      },
      {name: 'containers 1/1', launches: 'boxes', minutes: 30},
    ]);
  });

  it('tooling-159: launches the table keeps together share a part past the target, and the next one starts a part of its own', () => {
    const launches: Launch[] = [
      {label: 'pin-one', runner: 'runner', suite: 'suite-one'},
      {label: 'pin-two', runner: 'runner', suite: 'suite-two'},
      {label: 'loose', runner: 'runner', suite: 'suite-three'},
    ];
    deepStrictEqual(
      partsOfTable(
        launches,
        {
          targetMinutes: 15,
          together: [['pin-one', 'pin-two']],
          minutes: {'pin-one': 10, 'pin-two': 10, loose: 2},
        },
        suiteFiles,
      ),
      [
        {name: 'ssh 1/2', launches: 'pin-one,pin-two', minutes: limitOf(20)},
        {name: 'ssh 2/2', launches: 'loose', minutes: limitOf(2)},
      ],
    );
  });

  it('tooling-159: the host cases run in one part in the table order, past the target, and a launch of the CLI-source editor is left out', () => {
    const launches: Launch[] = [
      {label: 'case-one', runner: 'runner-remote', suite: 'suite-ports'},
      {label: 'case-two', runner: 'runner-remote', suite: 'suite-ports'},
      {label: 'cli-copy', kind: 'plain', suite: 'cli-copy', cliSource: true},
    ];
    deepStrictEqual(
      partsOfTable(
        launches,
        {
          targetMinutes: 15,
          minutes: {'case-one': 4, 'case-two': 14, 'cli-copy': 1},
        },
        suiteFiles,
      ),
      [{name: 'hosts 1/1', launches: 'case-one,case-two', minutes: 46}],
    );
  });

  it('tooling-159: a refresh reads file lines per launch, merged over the logs, and a launch without them from its stamps to the next launch or the end', () => {
    const table: PartsTable = {
      targetMinutes: 15,
      minutes: {kept: 4, long: {'old.test.ts': 1, 'l1.test.ts': 9}},
    };
    const first = [
      'job\tstep\t2026-11-05T01:00:00.000Z acceptance: launch local',
      'job\tstep\t2026-11-05T01:03:00.000Z acceptance: launch long',
      'job\tstep\t2026-11-05T01:20:00.000Z acceptance: file long/l1.test.ts 600.0',
      'job\tstep\t2026-11-05T01:20:00.100Z [ELIFECYCLE] Command failed with exit code 1.',
    ].join('\n');
    const second = [
      '2026-11-05T02:00:00.000Z acceptance: launch long',
      'a line with no stamp',
      '2026-11-05T02:10:00.000Z acceptance: file long/l2.test.ts 90.0',
      '2026-11-05T02:10:01.000Z acceptance: launch remote',
      '2026-11-05T02:11:31.000Z ##[group]Run pnpm acceptance:clean',
    ].join('\n');
    deepStrictEqual(refreshedTable(table, [first, second]), {
      targetMinutes: 15,
      minutes: {
        kept: 4,
        local: 3,
        long: {'old.test.ts': 1, 'l1.test.ts': 10, 'l2.test.ts': 1.5},
        remote: 1.5,
      },
    });
  });

  it("tooling-159: the repository's parts make every launch but the genuine ones, each test file of a split launch exactly once, the same parts each time", () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    const table = JSON.parse(readFileSync(PARTS_TABLE, 'utf8')) as PartsTable;
    const parts = partsOfTable(launches, table, suiteFilesIn(REPOSITORY_ROOT));
    const filesOf = suiteFilesIn(REPOSITORY_ROOT);
    /** Each launch a selection makes as its label, a plain one as each test file it runs. */
    function units(selected: string[]): string[] {
      const chosen = chosenLaunches(launches, selected);
      return typeof chosen === 'string'
        ? [chosen]
        : chosen.flatMap(launch =>
            launch.kind === 'plain'
              ? (launch.files ?? filesOf(launch.suite)).map(
                  file => `${launch.label}:${file}`,
                )
              : [launch.label],
          );
    }
    const made = parts.flatMap(part => units(part.launches.split(',')));
    const wanted = units([
      '@ssh',
      '@hosts',
      '@explorer',
      '@containers',
      '!cli-path',
    ]);
    deepStrictEqual(
      [
        [...made].sort(),
        made.length === new Set(made).size,
        partsOfTable(launches, table, suiteFilesIn(REPOSITORY_ROOT)),
      ],
      [[...wanted].sort(), true, parts],
    );
  });
});
