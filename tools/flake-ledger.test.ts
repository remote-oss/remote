import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import {
  ISSUE_FAILURES,
  KEPT_RUNS,
  ledgerRows,
  parseRunLog,
  recordedRuns,
  recordRun,
  renderLedger,
  rowKey,
  runRecordOf,
  type RowResult,
  type RunRecord,
  WINDOW,
} from './flake-ledger.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

/** A job log's line: the job, the step, and the text after a time stamp of 2026-10-20. */
function logLine(jobName: string, text: string): string {
  return `${jobName}\tRun the tests\t2026-10-20T07:40:00.0000000Z ${text}`;
}

const VSCODIUM_JOB = 'acceptance (vscodium)';

/** A log of two launches: one row passes, one fails and then passes in the next launch, and one fails with a diff. */
const TWO_LAUNCHES_LOG = [
  logLine(VSCODIUM_JOB, "Runner name: 'remote-labs-ci-3'"),
  logLine('unit', '    ✔ a unit row that is not an acceptance row'),
  logLine(VSCODIUM_JOB, 'acceptance: launch local'),
  logLine(VSCODIUM_JOB, '    ✔ F-1 AC-1 (a1): passes (812ms)'),
  logLine(VSCODIUM_JOB, '    1) F-1 AC-2 (a2): fails at first'),
  logLine(VSCODIUM_JOB, '  1 passing (3s)'),
  logLine(VSCODIUM_JOB, '  1 failing'),
  logLine(VSCODIUM_JOB, '  1) the local rows'),
  logLine(VSCODIUM_JOB, '       F-1 AC-2 (a2): fails at first:'),
  logLine(VSCODIUM_JOB, ''),
  logLine(VSCODIUM_JOB, '      Error: timed out waiting for the picker'),
  logLine(VSCODIUM_JOB, 'acceptance: launch remote'),
  logLine(VSCODIUM_JOB, '    ✔ F-1 AC-2 (a2): fails at first'),
  logLine(VSCODIUM_JOB, '    1) F-2 AC-1 (b1): differs'),
  logLine(VSCODIUM_JOB, '  1 failing'),
  logLine(VSCODIUM_JOB, '  1) the remote rows'),
  logLine(VSCODIUM_JOB, '       F-2 AC-1 (b1): differs:'),
  logLine(
    VSCODIUM_JOB,
    '      AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:',
  ),
  logLine(VSCODIUM_JOB, '+ actual - expected'),
  logLine(VSCODIUM_JOB, '+   order: false'),
  logLine(VSCODIUM_JOB, '-   order: true'),
].join('\n');

/** A recorded run `runId` in which each of `outcomes` passed or failed as given. */
function recorded(
  runId: string,
  outcomes: Readonly<Record<string, boolean>>,
): RunRecord {
  const rows: RowResult[] = Object.entries(outcomes).map(([title, passed]) => ({
    title,
    launch: 'local',
    passed,
    ...(passed ? {} : {failure: `failed in ${runId}`}),
  }));
  return runRecordOf(runId, {date: '2026-10-20', runner: `ci-${runId}`, rows});
}

describe('flake-ledger', () => {
  it('qa-01: a log gives each acceptance row once, its last result, its launch, and its failure’s first line', () => {
    deepStrictEqual(parseRunLog(TWO_LAUNCHES_LOG), {
      date: '2026-10-20',
      runner: 'remote-labs-ci-3',
      rows: [
        {title: 'F-1 AC-1 (a1): passes', launch: 'local', passed: true},
        {
          title: 'F-1 AC-2 (a2): fails at first',
          launch: 'remote',
          passed: true,
        },
        {
          title: 'F-2 AC-1 (b1): differs',
          launch: 'remote',
          passed: false,
          failure:
            'AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal: +   order: false',
        },
      ],
    });
  });

  it('qa-01: a failure keeps its plain first line, and a log with no acceptance job gives no rows', () => {
    const localOnly = TWO_LAUNCHES_LOG.split('\n').slice(0, 11).join('\n');
    deepStrictEqual(
      [
        parseRunLog(localOnly).rows.find(result => !result.passed)?.failure,
        parseRunLog(logLine('unit', '    ✔ a unit row')),
      ],
      [
        'Error: timed out waiting for the picker',
        {date: '', runner: '', rows: []},
      ],
    );
  });

  it(`qa-01: a row counts its latest ${String(WINDOW)} runs, newest first, and a failure in ${String(ISSUE_FAILURES)} of them marks an issue`, () => {
    const runs = [...Array(WINDOW + 2).keys()].map(index =>
      recorded(String(100 + index), {
        // two failures in the oldest runs, outside the window, and one in the newest
        flaky: index > 1 && index !== WINDOW + 1,
        steady: true,
        broken: false,
      }),
    );
    const text = renderLedger(runs);
    deepStrictEqual(
      [
        ledgerRows(runs).map(entry => [
          entry.title,
          entry.failures,
          entry.runs,
        ]),
        text.includes(`| flaky | local | 1 of ${String(WINDOW)} |`),
        text.includes(
          `| broken | local | ${String(WINDOW)} of ${String(WINDOW)} (issue) |`,
        ),
        text.includes('| steady |'),
        text.split('\n')[0],
      ],
      [
        [
          ['broken', WINDOW, WINDOW],
          ['flaky', 1, WINDOW],
        ],
        true,
        true,
        false,
        '# Acceptance rows that fail in some runs',
      ],
    );
  });

  it('qa-01: a section with no rows says so, and a cell’s pipes and line breaks are escaped', () => {
    const passing = renderLedger([recorded('5', {'a | b\nc': true})]);
    deepStrictEqual(
      [
        passing.includes('## Rows that failed and passed\n\nNone.'),
        passing.includes('## Rows that failed every time they ran\n\nNone.'),
        renderLedger([recorded('6', {'a | b\nc': false})]).includes(
          '| a \\| b c | local | 1 of 1 |',
        ),
      ],
      [true, true, true],
    );
  });

  it('qa-01: a recorded run keeps its failed rows whole and a key for each row that passed, and the folder keeps the newest runs', () => {
    const workspace = new TemporaryWorkspace('flake-ledger');
    try {
      const file = recordRun(workspace.root, '39387179525', TWO_LAUNCHES_LOG);
      const first = JSON.parse(readFileSync(file, 'utf8')) as RunRecord;
      for (let index = 1; index <= KEPT_RUNS; index += 1) {
        recordRun(
          workspace.root,
          String(39387179525 + index),
          TWO_LAUNCHES_LOG,
        );
      }
      deepStrictEqual(
        [
          first.failed.map(result => result.title),
          first.passed,
          recordedRuns(workspace.root).length,
          recordedRuns(workspace.root).some(
            each => each.runId === '39387179525',
          ),
        ],
        [
          ['F-2 AC-1 (b1): differs'],
          [
            rowKey('F-1 AC-1 (a1): passes'),
            rowKey('F-1 AC-2 (a2): fails at first'),
          ],
          KEPT_RUNS,
          false,
        ],
      );
    } finally {
      workspace.remove();
    }
  });
});
