/**
 * @fileoverview flake-ledger: the acceptance rows that fail in some runs and pass in others, from the runs' job logs.
 *
 *     node tools/flake-ledger.ts record <run id> <log file>   the rows of one run, into docs/qa/runs/<run id>.json
 *     node tools/flake-ledger.ts render                       docs/qa/flakes.md, from every recorded run
 *
 * A log is a run's job log as `gh run view --log` prints it: job, step, and a time-stamped line, tab-separated. Only
 * the acceptance jobs that make launches are read. Rows are keyed by their title, and each run's launch markers
 * (`acceptance: launch <label>`) name the launch a row ran in; a row of a log written before the markers has none.
 */

import {createHash} from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** Where the recorded runs and the ledger live. */
const RUNS_FOLDER = 'docs/qa/runs';
const LEDGER_FILE = 'docs/qa/flakes.md';

/** How many of a row's latest runs the ledger counts. */
export const WINDOW = 10;

/** In how many of those runs a row fails for the ledger to mark it as an issue. */
export const ISSUE_FAILURES = 2;

/** How many runs the folder keeps: the newest, so it doesn't grow without end. */
export const KEPT_RUNS = 30;

/** One row of one run: its title, the launch it ran in, whether it passed, and the first line of its failure. */
export interface RowResult {
  title: string;
  launch: string;
  passed: boolean;
  failure?: string;
}

/** One run as its log gives it: its date, the runner that made the launches, and its rows. */
export interface ParsedRun {
  date: string;
  runner: string;
  rows: RowResult[];
}

/** One recorded run: its id, date and runner, its failed rows in full, and a key for each row that passed. */
export interface RunRecord {
  runId: string;
  date: string;
  runner: string;
  failed: RowResult[];
  passed: string[];
}

/** The short key a recorded run keeps for a row that passed: the start of its title's SHA-256. */
export function rowKey(title: string): string {
  return createHash('sha256').update(title).digest('hex').slice(0, 12);
}

/** The record of run `runId` from what its log gave. */
export function runRecordOf(runId: string, parsed: ParsedRun): RunRecord {
  return {
    runId,
    date: parsed.date,
    runner: parsed.runner,
    failed: parsed.rows.filter(result => !result.passed),
    passed: parsed.rows
      .filter(result => result.passed)
      .map(result => rowKey(result.title)),
  };
}

/** The time stamp GitHub puts before each line of a job's log. */
const STAMP = /^(\d{4}-\d{2}-\d{2})T[\d:.]+Z ?/;

/** The jobs whose rows the ledger reads. */
const ACCEPTANCE_JOB = /^acceptance \((vscodium|genuine)\b/;

/** The lines of the acceptance jobs of a log, without their job, step, time stamp and colours, and the first date. */
function jobLines(logText: string): {lines: string[]; date: string} {
  const lines: string[] = [];
  let date = '';
  for (const rawLine of logText.split('\n')) {
    const [jobName = '', , ...rest] = rawLine.split('\t');
    if (!ACCEPTANCE_JOB.test(jobName)) {
      continue;
    }
    // eslint-disable-next-line no-control-regex -- the escape sequences of a terminal's colours
    const text = rest.join('\t').replace(/\u001b\[[0-9;]*m/g, '');
    const stamp = STAMP.exec(text);
    if (date === '' && stamp !== null) {
      date = stamp[1] ?? '';
    }
    lines.push(text.replace(STAMP, ''));
  }
  return {lines, date};
}

/**
 * The first line of a failure's text, the lines after its title. A deep-equal failure's first line is the same for every
 * difference, so the first line of the actual value that differs follows it.
 */
function failureLine(after: readonly string[]): string | undefined {
  const text = after.slice(0, 40);
  const first = text.find(each => each.trim() !== '')?.trim();
  if (!first?.endsWith(':')) {
    return first;
  }
  const actual = text.find(each => /^\+\s{2,}\S/.test(each))?.trim();
  return actual === undefined ? first : `${first} ${actual}`;
}

/** The rows of one run's job log, and its date and runner. A row that ran twice keeps its last result. */
export function parseRunLog(logText: string): ParsedRun {
  const {lines, date} = jobLines(logText);
  const rows = new Map<string, RowResult>();
  let launch = '';
  let runner = '';
  let details = false;
  for (const [index, line] of lines.entries()) {
    const marker = /^acceptance: launch (\S+)$/.exec(line);
    const runnerName = /^Runner name: '(.+)'$/.exec(line);
    const passed = /^\s+✔ (.+?)(?: \(\d+ms\))?$/.exec(line);
    const numbered = /^\s+\d+\) (.+)$/.exec(line);
    if (runnerName !== null && runner === '') {
      runner = runnerName[1] ?? '';
    } else if (marker !== null) {
      launch = marker[1] ?? '';
      details = false;
    } else if (/^\s+\d+ failing$/.test(line)) {
      details = true;
    } else if (passed !== null) {
      details = false;
      const title = passed[1] ?? '';
      rows.delete(title);
      rows.set(title, {title, launch, passed: true});
    } else if (numbered !== null && !details) {
      const title = numbered[1] ?? '';
      rows.delete(title);
      rows.set(title, {title, launch, passed: false});
    } else if (details && line.trim().endsWith(':')) {
      const failed = rows.get(line.trim().slice(0, -1));
      const failure = failureLine(lines.slice(index + 1));
      if (failed !== undefined && !failed.passed && failure !== undefined) {
        failed.failure = failure;
      }
    }
  }
  return {date, runner, rows: [...rows.values()]};
}

/** One row of the ledger: its title, launches, runs counted, failures, distinct failure lines and failing runners. */
export interface LedgerRow {
  title: string;
  launches: string[];
  runs: number;
  failures: number;
  failureLines: string[];
  runners: string[];
}

/** The runs newest first: their ids are numbers that grow over time. */
function newestFirst(records: readonly RunRecord[]): RunRecord[] {
  return [...records].sort(
    (left, right) => Number(right.runId) - Number(left.runId),
  );
}

/**
 * Each row that failed in a recorded run, over its latest `WINDOW` runs (those in which it failed or passed), newest
 * first. A row that never failed isn't in the ledger.
 */
export function ledgerRows(records: readonly RunRecord[]): LedgerRow[] {
  const runs = newestFirst(records);
  const titles = new Set(
    runs.flatMap(record => record.failed.map(result => result.title)),
  );
  return [...titles]
    .map(title => {
      const key = rowKey(title);
      const seen = runs
        .map(record => ({
          record,
          failure: record.failed.find(result => result.title === title),
          passed: record.passed.includes(key),
        }))
        .filter(each => each.failure !== undefined || each.passed)
        .slice(0, WINDOW);
      const failed = seen.flatMap(each =>
        each.failure === undefined
          ? []
          : [{record: each.record, result: each.failure}],
      );
      return {
        title,
        launches: [
          ...new Set(failed.map(each => each.result.launch).filter(Boolean)),
        ],
        runs: seen.length,
        failures: failed.length,
        failureLines: [
          ...new Set(failed.map(each => each.result.failure ?? '(no detail)')),
        ],
        runners: [...new Set(failed.map(each => each.record.runner))],
      };
    })
    .sort(
      (left, right) =>
        right.failures - left.failures || left.title.localeCompare(right.title),
    );
}

/** A table cell: one line, its pipes escaped. */
function cell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** The table of `rows` under `heading`, or a line saying there are none. */
function table(heading: string, rows: readonly LedgerRow[]): string[] {
  if (rows.length === 0) {
    return [`## ${heading}`, '', 'None.', ''];
  }
  return [
    `## ${heading}`,
    '',
    '| Row | Launch | Failed | First failure lines | Runners |',
    '|---|---|---|---|---|',
    ...rows.map(
      entry =>
        `| ${cell(entry.title)} | ${cell(entry.launches.join(', ') || '?')} | ${String(entry.failures)} of ${String(entry.runs)}${
          entry.failures >= ISSUE_FAILURES ? ' (issue)' : ''
        } | ${cell(entry.failureLines.join(' / '))} | ${cell(entry.runners.join(', '))} |`,
    ),
    '',
  ];
}

/** The ledger's text: the runs counted, the rows that both failed and passed, and those that failed every time. */
export function renderLedger(records: readonly RunRecord[]): string {
  const rows = ledgerRows(records);
  const runs = newestFirst(records);
  return [
    '# Acceptance rows that fail in some runs',
    '',
    `Generated by \`node tools/flake-ledger.ts render\` from \`${RUNS_FOLDER}\`; don't edit it by hand. A row counts its latest ${String(WINDOW)} runs, and one that failed in ${String(ISSUE_FAILURES)} or more of them is marked "(issue)".`,
    '',
    '## Runs',
    '',
    '| Run | Date | Runner | Rows | Failed |',
    '|---|---|---|---|---|',
    ...runs.map(
      record =>
        `| ${record.runId} | ${record.date} | ${cell(record.runner)} | ${String(record.passed.length + record.failed.length)} | ${String(record.failed.length)} |`,
    ),
    '',
    ...table(
      'Rows that failed and passed',
      rows.filter(entry => entry.failures > 0 && entry.failures < entry.runs),
    ),
    ...table(
      'Rows that failed every time they ran',
      rows.filter(entry => entry.failures > 0 && entry.failures === entry.runs),
    ),
  ].join('\n');
}

/** Every run recorded under `root`. */
export function recordedRuns(root: string): RunRecord[] {
  const folder = path.join(root, RUNS_FOLDER);
  return readdirSync(folder)
    .filter(entry => entry.endsWith('.json'))
    .map(
      entry =>
        JSON.parse(readFileSync(path.join(folder, entry), 'utf8')) as RunRecord,
    );
}

/** Records run `runId` from its log under `root`, keeps the newest `KEPT_RUNS`, and gives the file written. */
export function recordRun(
  root: string,
  runId: string,
  logText: string,
): string {
  const folder = path.join(root, RUNS_FOLDER);
  mkdirSync(folder, {recursive: true});
  const file = path.join(folder, `${runId}.json`);
  writeFileSync(
    file,
    `${JSON.stringify(runRecordOf(runId, parseRunLog(logText)), null, 2)}\n`,
  );
  for (const stale of newestFirst(recordedRuns(root)).slice(KEPT_RUNS)) {
    rmSync(path.join(folder, `${stale.runId}.json`));
  }
  return file;
}

if (isMainModule(import.meta.url)) {
  const [action, runId, logFile] = process.argv.slice(2);
  if (action === 'record' && runId !== undefined && logFile !== undefined) {
    console.log(
      `flake-ledger: ${recordRun(REPOSITORY_ROOT, runId, readFileSync(logFile, 'utf8'))}`,
    );
  } else if (action === 'render') {
    writeFileSync(
      path.join(REPOSITORY_ROOT, LEDGER_FILE),
      `${renderLedger(recordedRuns(REPOSITORY_ROOT))}\n`,
    );
    console.log(`flake-ledger: ${LEDGER_FILE}`);
  } else {
    console.error(
      'usage: node tools/flake-ledger.ts record <run id> <log file> | render',
    );
    process.exitCode = 2;
  }
}
