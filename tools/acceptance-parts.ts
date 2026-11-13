/**
 * @fileoverview acceptance-parts: the parts every VSCodium run is made of, each about fifteen minutes of rows, from the
 * measured minutes in acceptance-parts.json. A launch longer than that is split by its test files, never inside one; the
 * rest are packed whole. Everything keeps the table's order, launches and files alike, so a launch or a file still runs
 * after the one before it unless a part ends between them; the launches the table keeps together never part. The
 * same table always gives the same parts.
 *
 *     node tools/acceptance-parts.ts --matrix              every part, as the VSCodium job's matrix takes them
 *     node tools/acceptance-parts.ts --refresh <log>...    the table again from runs' job logs
 *
 * A run's log holds the minutes: `acceptance: file <suite>/<file> <seconds>` for each file of a plain launch, and the
 * stamps of the `acceptance: launch <label>` lines for each launch.
 */

import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {format, resolveConfig} from 'prettier';
import {type Launch, launchesOf, launchGroupOf} from './acceptance-launches.ts';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** Where the measured minutes live. */
export const PARTS_TABLE = path.join(
  REPOSITORY_ROOT,
  'tools',
  'acceptance-parts.json',
);

/** The measured minutes: per launch, a number for the whole launch, or the minutes of each of its test files. */
export interface PartsTable {
  /** The minutes of rows a part aims at. */
  targetMinutes: number;
  /** Per launch label, its minutes, or per test file of it, the file's minutes. */
  minutes: Record<string, number | Record<string, number>>;
  /** Launches that run in one part, in the table's order: each needs what the one before it leaves on the host. */
  together?: string[][];
}

/** One job of a VSCodium run. */
export interface Part {
  /** What the job is called: its group and its place among the group's parts. */
  name: string;
  /** The launches it makes, as the run's `--launches` takes them. */
  launches: string;
  /** Its time limit: twice its measured minutes and ten more, at least thirty. */
  minutes: number;
}

/** The minutes a launch the table has not measured is counted as. */
export const UNMEASURED_LAUNCH_MINUTES = 5;

/** The minutes each test file the table has not measured is counted as, in the part those files get. */
export const UNMEASURED_FILE_MINUTES = 3;

/** The time limit of a part of `minutes` measured minutes. */
export function limitOf(minutes: number): number {
  return Math.max(30, Math.ceil(minutes * 2 + 10));
}

/** One entry of a part, in the table's order: a whole launch, or some files of one, with their minutes. */
interface Entry {
  entry: string;
  label: string;
  group: string;
  minutes: number;
}

/**
 * `items` in their order, cut into runs of at most `limit` minutes, an item over it alone in its run; `keepWith` says
 * when an item must stay in the run of the one before it.
 */
function runsOf<Item>(
  items: readonly Item[],
  minutesOf: (item: Item) => number,
  limit: number,
  keepWith: (item: Item, before: Item) => boolean = () => false,
): Array<{total: number; members: Item[]}> {
  const runs: Array<{total: number; members: Item[]}> = [];
  for (const item of items) {
    const current = runs.at(-1);
    const before = current?.members.at(-1);
    if (
      current !== undefined &&
      before !== undefined &&
      (current.total + minutesOf(item) <= limit || keepWith(item, before))
    ) {
      current.total += minutesOf(item);
      current.members.push(item);
    } else {
      runs.push({total: minutesOf(item), members: [item]});
    }
  }
  return runs;
}

/**
 * The entries of one launch: the whole launch, or its test files in their order cut into runs of the target, a file
 * the table has not measured counted as `UNMEASURED_FILE_MINUTES`.
 */
function entriesOf(
  launch: Launch,
  table: PartsTable,
  suiteFiles: (suite: string) => string[],
): Entry[] {
  const group = launchGroupOf(launch);
  const measured = table.minutes[launch.label];
  if (typeof measured !== 'object' || launch.kind !== 'plain') {
    return [
      {
        entry: launch.label,
        label: launch.label,
        group,
        minutes:
          typeof measured === 'object'
            ? Object.values(measured).reduce((total, value) => total + value, 0)
            : (measured ?? UNMEASURED_LAUNCH_MINUTES),
      },
    ];
  }
  const fileMinutes: Readonly<Record<string, number>> = measured;
  function minutesOfFile(file: string): number {
    return fileMinutes[file] ?? UNMEASURED_FILE_MINUTES;
  }
  const runs = runsOf(
    launch.files ?? suiteFiles(launch.suite),
    minutesOfFile,
    table.targetMinutes,
  );
  return runs.length === 1
    ? [
        {
          entry: launch.label,
          label: launch.label,
          group,
          minutes: runs[0]?.total ?? 0,
        },
      ]
    : runs.map(stretch => ({
        entry: `${launch.label}:${stretch.members.join('+')}`,
        label: launch.label,
        group,
        minutes: stretch.total,
      }));
}

/** Whether a launch runs only with others in one part, as the table makes it: a launch the table keeps `together` with another. */
export function heldTogether(table: PartsTable): (launch: Launch) => boolean {
  return launch =>
    (table.together ?? []).some(labels => labels.includes(launch.label));
}

/**
 * Whether the parts leave a launch out: the genuine group's, which have a job of their own, and a launch that starts the
 * CLI-source editor, which needs the CLI archives' token that CI does not hold.
 */
function leftOut(launch: Launch): boolean {
  return (
    launchGroupOf(launch) === 'genuine' ||
    (launch.kind === 'plain' && launch.cliSource === true)
  );
}

/**
 * Every part of a VSCodium run, group by group in the table's order: each group's entries in their order, cut into parts
 * of at most the target, an entry over it alone in its part, and the launches the table keeps together in the same
 * part. Named-only launches are in, as their group's selection makes them,
 * unless the parts leave them out.
 */
export function partsOfTable(
  launches: readonly Launch[],
  table: PartsTable,
  suiteFiles: (suite: string) => string[],
): Part[] {
  const entries = launches
    .filter(launch => !leftOut(launch))
    .flatMap(launch => entriesOf(launch, table, suiteFiles));
  const groups = [...new Set(entries.map(entry => entry.group))];
  const together = table.together ?? [];
  return groups.flatMap(group => {
    const ofGroup = entries.filter(entry => entry.group === group);
    const runs = runsOf(
      ofGroup,
      entry => entry.minutes,
      table.targetMinutes,
      (entry, before) =>
        together.some(
          labels =>
            labels.includes(entry.label) && labels.includes(before.label),
        ),
    );
    return runs.map((stretch, index) => ({
      name: `${group} ${String(index + 1)}/${String(runs.length)}`,
      launches: stretch.members.map(entry => entry.entry).join(','),
      minutes: limitOf(stretch.total),
    }));
  });
}

/** The test files directly in a suite's folder, by name. */
export function suiteFilesIn(root: string): (suite: string) => string[] {
  return suite =>
    readdirSync(path.join(root, 'tests', 'acceptance', suite))
      .filter(file => file.endsWith('.test.ts'))
      .sort();
}

/** A stamped line of a job log: `<ISO time>Z <text>`, as GitHub's log and `gh run view --log` print it. */
const STAMPED = /(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)Z (.*)$/;

/**
 * The table again from job logs: each plain launch whose run printed file lines gets its files' minutes, each other
 * launch its minutes from its `acceptance: launch` line to the next one or the end of the rows. Labels the logs do not
 * name keep what they had.
 */
export function refreshedTable(
  table: PartsTable,
  logs: readonly string[],
): PartsTable {
  const minutes: PartsTable['minutes'] = {...table.minutes};
  for (const logText of logs) {
    let current: {label: string; started: number} | undefined;
    const files: Record<string, Record<string, number>> = {};
    function finish(stamp: number): void {
      if (current === undefined) {
        return;
      }
      const ofFiles = files[current.label];
      const before = minutes[current.label];
      minutes[current.label] =
        ofFiles === undefined
          ? Math.round(((stamp - current.started) / 60000) * 10) / 10
          : {...(typeof before === 'object' ? before : {}), ...ofFiles};
    }
    for (const line of logText.split('\n')) {
      const stamped = STAMPED.exec(line);
      if (stamped === null) {
        continue;
      }
      const stamp = Date.parse(`${String(stamped[1])}Z`);
      const text = String(stamped[2]).trim();
      const launchLine = /^acceptance: launch (\S+)$/.exec(text);
      const fileLine = /^acceptance: file [^/]+\/(\S+) ([\d.]+)$/.exec(text);
      if (launchLine !== null) {
        finish(stamp);
        current = {label: String(launchLine[1]), started: stamp};
      } else if (fileLine !== null && current !== undefined) {
        files[current.label] = {
          ...files[current.label],
          [String(fileLine[1])]:
            Math.round((Number(fileLine[2]) / 60) * 10) / 10,
        };
      } else if (
        /^\[ELIFECYCLE\]|^##\[group\]Run pnpm acceptance:clean/.test(text)
      ) {
        finish(stamp);
        current = undefined;
      }
    }
  }
  return {...table, minutes};
}

const USAGE =
  'usage: node tools/acceptance-parts.ts --matrix | --refresh <job log>...';

if (isMainModule(import.meta.url)) {
  const commandArguments = process.argv.slice(2);
  const table = JSON.parse(readFileSync(PARTS_TABLE, 'utf8')) as PartsTable;
  if (commandArguments.length === 1 && commandArguments[0] === '--matrix') {
    console.log(
      JSON.stringify(
        partsOfTable(
          launchesOf(REPOSITORY_ROOT),
          table,
          suiteFilesIn(REPOSITORY_ROOT),
        ),
      ),
    );
  } else if (
    commandArguments.length > 1 &&
    commandArguments[0] === '--refresh'
  ) {
    const refreshed = refreshedTable(
      table,
      commandArguments.slice(1).map(file => readFileSync(file, 'utf8')),
    );
    writeFileSync(
      PARTS_TABLE,
      await format(JSON.stringify(refreshed), {
        ...(await resolveConfig(PARTS_TABLE)),
        filepath: PARTS_TABLE,
      }),
    );
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}
