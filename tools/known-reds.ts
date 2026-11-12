/**
 * @fileoverview known-reds: the pull request gate's list of rows that are red on main, each owned by an open issue, and the verdict of a
 * launch against it.
 *
 * On a pull request's run, a plain launch whose only failures are test rows named on tools/known-reds.json for that
 * launch passes, and every such row is printed with the message it failed with and its issue. A failed hook, a launch
 * whose run did not end, a launch with no outcome and a row not on the list fail it as before. On every other event
 * (the post-merge, nightly and dispatched runs) the list changes nothing, so those runs report every red.
 */

import {appendFileSync, existsSync, readFileSync} from 'node:fs';
import path from 'node:path';

/** The variable that names the file a plain launch's mocha writes its outcome to. */
export const OUTCOME_VARIABLE = 'REMOTE_OSS_ACCEPTANCE_OUTCOME';

/** One row of a launch's run: its file (suite folder and name) and its title, as `it` gives it. */
export interface OutcomeRow {
  file: string;
  title: string;
}

/** A row or hook that failed, with what failed it. */
interface OutcomeFailure extends OutcomeRow {
  kind: 'test' | 'hook';
  message: string;
}

/** What a launch's mocha run ended with: whether it reached its end, and its failed and passed rows. */
export interface LaunchOutcome {
  ended: boolean;
  failures: OutcomeFailure[];
  passes: OutcomeRow[];
}

/** One entry of the list: a row of a launch that is red on main, with the open issue that owns it. */
export interface KnownRed extends OutcomeRow {
  launch: string;
  card: number;
  owner: string;
  /** A run on main (post-merge or nightly) where the row was red. */
  evidence: number;
  /** The day the entry was added, YYYY-MM-DD. */
  added: string;
}

/** A launch's verdict: whether it passes, the known reds it excused, the reds that fail it, and listed rows now green. */
export interface Verdict {
  passes: boolean;
  /** Why the launch fails as a whole, when it is not its rows (no outcome, a run that did not end, a hook). */
  reason?: string;
  excused: Array<{entry: KnownRed; message: string}>;
  unlisted: OutcomeFailure[];
  nowGreen: KnownRed[];
}

/** The file the outcome of launch `label` is written to, in the run's folder. */
export function outcomeFileOf(runFolder: string, label: string): string {
  return path.join(runFolder, `${label}-outcome.json`);
}

/** The outcome in `file`, or nothing when the run wrote none or wrote something that is not one. */
export function readOutcome(file: string): LaunchOutcome | undefined {
  if (!existsSync(file)) {
    return undefined;
  }
  try {
    const value = JSON.parse(
      readFileSync(file, 'utf8'),
    ) as Partial<LaunchOutcome>;
    return typeof value.ended === 'boolean' &&
      Array.isArray(value.failures) &&
      Array.isArray(value.passes)
      ? {ended: value.ended, failures: value.failures, passes: value.passes}
      : undefined;
  } catch {
    return undefined;
  }
}

/** The file of the list, in `root`. */
export function knownRedsFileOf(root: string): string {
  return path.join(root, 'tools', 'known-reds.json');
}

/** The list `root` holds; a tree without one, as a test's, lists nothing. */
export function readKnownReds(root: string): KnownRed[] {
  const file = knownRedsFileOf(root);
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, 'utf8')) as KnownRed[])
    : [];
}

/** Whether `outcomeRow` is the row `entry` names, in launch `label`. */
function names(
  entry: KnownRed,
  label: string,
  outcomeRow: OutcomeRow,
): boolean {
  return (
    entry.launch === label &&
    entry.file === outcomeRow.file &&
    entry.title === outcomeRow.title
  );
}

/** The verdict of launch `label`, whose run ended with `outcome`, against `knownReds`. */
export function verdictOf(
  label: string,
  outcome: LaunchOutcome | undefined,
  knownReds: readonly KnownRed[],
): Verdict {
  const nowGreen =
    outcome === undefined
      ? []
      : knownReds.filter(entry =>
          outcome.passes.some(passed => names(entry, label, passed)),
        );
  function failing(reason: string): Verdict {
    return {
      passes: false,
      reason,
      excused: [],
      unlisted: outcome?.failures ?? [],
      nowGreen,
    };
  }
  if (outcome === undefined) {
    return failing('the launch wrote no outcome');
  }
  if (!outcome.ended) {
    return failing('the launch did not reach the end of its run');
  }
  const hook = outcome.failures.find(failure => failure.kind === 'hook');
  if (hook !== undefined) {
    return failing(`a hook failed: ${hook.title}`);
  }
  const excused: Verdict['excused'] = [];
  const unlisted: OutcomeFailure[] = [];
  for (const failure of outcome.failures) {
    const entry = knownReds.find(each => names(each, label, failure));
    if (entry === undefined) {
      unlisted.push(failure);
    } else {
      excused.push({entry, message: failure.message});
    }
  }
  return {passes: unlisted.length === 0, excused, unlisted, nowGreen};
}

/** The lines the verdict of launch `label` prints: each excused row with its issue and message, and each listed row now green. */
export function verdictLines(label: string, verdict: Verdict): string[] {
  return [
    ...verdict.excused.map(
      ({entry, message}) =>
        `acceptance: known red (#${String(entry.card)}, ${entry.owner}) in ${label}: ${entry.file}: ${entry.title}: ${message}`,
    ),
    ...verdict.nowGreen.map(
      entry =>
        `acceptance: now green, remove its entry from tools/known-reds.json (#${String(entry.card)}) in ${label}: ${entry.file}: ${entry.title}`,
    ),
    ...(verdict.reason === undefined
      ? []
      : [
          `acceptance: ${label} fails whatever the list says: ${verdict.reason}`,
        ]),
    ...verdict.unlisted.map(
      failure =>
        `acceptance: red and not a known red in ${label}: ${failure.file}: ${failure.title}`,
    ),
  ];
}

/**
 * The exit code a launch's run counts with: on a pull request's run, a failed plain launch whose verdict passes counts
 * as passed; otherwise the code stands. The verdict's lines are reported whenever it is judged.
 */
export function judgedExitCode(
  exitCode: number,
  label: string,
  outcomeFile: string,
  knownReds: readonly KnownRed[],
  environment: Readonly<Record<string, string | undefined>>,
  report: (line: string) => void,
): number {
  if (environment.GITHUB_EVENT_NAME !== 'pull_request') {
    return exitCode;
  }
  const verdict = verdictOf(label, readOutcome(outcomeFile), knownReds);
  if (exitCode === 0) {
    for (const line of verdictLines(label, {
      passes: true,
      excused: [],
      unlisted: [],
      nowGreen: verdict.nowGreen,
    })) {
      report(line);
    }
    return 0;
  }
  for (const line of verdictLines(label, verdict)) {
    report(line);
  }
  return verdict.passes && verdict.excused.length > 0 ? 0 : exitCode;
}

/**
 * The judge of a run's launches: each plain launch's exit code judged against the repository's list, with the verdict's
 * lines printed and, on a GitHub job, added to the job's summary. Other launches keep their code.
 */
export function knownRedsJudge(
  root: string,
  runFolder: string,
  environment: Readonly<Record<string, string | undefined>>,
): (
  exitCode: number,
  launch: {kind?: string | undefined; label: string},
) => number {
  const knownReds = readKnownReds(root);
  const summary = environment.GITHUB_STEP_SUMMARY;
  function report(line: string): void {
    console.log(line);
    if (summary !== undefined && summary !== '') {
      appendFileSync(summary, `${line}\n`);
    }
  }
  return (exitCode, launch) =>
    launch.kind === 'plain'
      ? judgedExitCode(
          exitCode,
          launch.label,
          outcomeFileOf(runFolder, launch.label),
          knownReds,
          environment,
          report,
        )
      : exitCode;
}

/** The fields an entry must have, with the kind of each. */
const FIELDS: ReadonlyArray<[keyof KnownRed, 'string' | 'number']> = [
  ['launch', 'string'],
  ['file', 'string'],
  ['title', 'string'],
  ['card', 'number'],
  ['owner', 'string'],
  ['evidence', 'number'],
  ['added', 'string'],
];

/**
 * What is wrong with the list: an entry without a field or with one of the wrong kind, a launch that is not a plain
 * launch, a file its launch's suite folder does not have, a title that is no row of that file, a date that is not one,
 * and an entry listed twice. `suites` maps each plain launch's label to its suite folder.
 */
export function listProblems(
  root: string,
  knownReds: readonly unknown[],
  suites: ReadonlyMap<string, string>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  knownReds.forEach((value, index) => {
    const entry = value as Partial<KnownRed>;
    const place = `entry ${String(index + 1)}`;
    const missing = FIELDS.filter(
      ([field, kind]) => typeof entry[field] !== kind,
    ).map(([field]) => field);
    if (missing.length > 0) {
      problems.push(`${place}: missing or mistyped: ${missing.join(', ')}`);
      return;
    }
    const known = entry as KnownRed;
    if (!Number.isInteger(known.card) || known.card <= 0) {
      problems.push(`${place}: the card is not an issue number`);
    }
    if (!Number.isInteger(known.evidence) || known.evidence <= 0) {
      problems.push(`${place}: the evidence is not a run id`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(known.added)) {
      problems.push(`${place}: added is not a YYYY-MM-DD date`);
    }
    const suite = suites.get(known.launch);
    if (suite === undefined) {
      problems.push(`${place}: ${known.launch} is not a plain launch`);
    } else {
      const source = path.join(
        root,
        'tests',
        'acceptance',
        suite,
        path.basename(known.file),
      );
      if (
        path.basename(path.dirname(known.file)) !== suite ||
        !existsSync(source)
      ) {
        problems.push(
          `${place}: ${known.file} is not a file of ${known.launch}'s suite ${suite}`,
        );
      } else if (!rowTitlesOf(readFileSync(source, 'utf8')).has(known.title)) {
        problems.push(
          `${place}: no row of ${known.file} is titled ${known.title}`,
        );
      }
    }
    const key = `${known.launch}\u0000${known.file}\u0000${known.title}`;
    if (seen.has(key)) {
      problems.push(`${place}: listed twice`);
    }
    seen.add(key);
  });
  return problems;
}

/** The titles of the rows `it` declares in `source`, each written as one string literal. */
export function rowTitlesOf(source: string): Set<string> {
  const titles = new Set<string>();
  for (const match of source.matchAll(
    /\bit\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)\s*,/g,
  )) {
    const literal = match[1] ?? match[2] ?? match[3] ?? '';
    titles.add(literal.replace(/\\(.)/g, '$1'));
  }
  return titles;
}
