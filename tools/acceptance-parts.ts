/**
 * @fileoverview acceptance-parts: the parts every VSCodium run is made of, each about fifteen minutes of rows, from the
 * measured minutes in acceptance-parts.json. A launch longer than that is split by its test files, never inside one; the
 * rest are packed whole. The same table always gives the same parts.
 *
 *     node tools/acceptance-parts.ts --matrix              every part, as the VSCodium job's matrix takes them
 *     node tools/acceptance-parts.ts --refresh <log>...    the table again from runs' job logs
 *
 * A run's log holds the minutes: `acceptance: file <suite>/<file> <seconds>` for each file of a plain launch, and the
 * stamps of the `acceptance: launch <label>` lines for each launch.
 */

import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
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

/** One entry of a part: a whole launch, or some files of one, with their minutes. */
interface Entry {
  entry: string;
  group: string;
  minutes: number;
}

/** The time limit of a part of `minutes` measured minutes. */
export function limitOf(minutes: number): number {
  return Math.max(30, Math.ceil(minutes * 2 + 10));
}

/**
 * `items` packed into `count` buckets, the longest first, each into the bucket with the fewest minutes so far (the first such
 * bucket on a tie); every bucket keeps its items in their order in `items`.
 */
function spread<Item>(
  items: readonly Item[],
  minutesOf: (item: Item) => number,
  count: number,
): Item[][] {
  const buckets: Array<{total: number; members: Item[]}> = [
    ...Array(count).keys(),
  ].map(() => ({total: 0, members: []}));
  const longestFirst = [...items].sort(
    (left, right) => minutesOf(right) - minutesOf(left),
  );
  for (const item of longestFirst) {
    const emptiest = buckets.reduce((best, bucket) =>
      bucket.total < best.total ? bucket : best,
    );
    emptiest.total += minutesOf(item);
    emptiest.members.push(item);
  }
  return buckets
    .map(bucket => items.filter(item => bucket.members.includes(item)))
    .filter(members => members.length > 0);
}

/** The entries of one launch: the whole launch, or its measured files in buckets of the target and its unmeasured ones. */
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
        group,
        minutes:
          typeof measured === 'object'
            ? Object.values(measured).reduce((total, value) => total + value, 0)
            : (measured ?? UNMEASURED_LAUNCH_MINUTES),
      },
    ];
  }
  const files = launch.files ?? suiteFiles(launch.suite);
  const fileMinutes: Readonly<Record<string, number>> = measured;
  const known = files.filter(file => fileMinutes[file] !== undefined);
  const unknown = files.filter(file => fileMinutes[file] === undefined);
  function minutesOfFile(file: string): number {
    return fileMinutes[file] ?? 0;
  }
  const total = known.reduce(
    (running, file) => running + minutesOfFile(file),
    0,
  );
  if (total + unknown.length * UNMEASURED_FILE_MINUTES <= table.targetMinutes) {
    return [
      {
        entry: launch.label,
        group,
        minutes: total + unknown.length * UNMEASURED_FILE_MINUTES,
      },
    ];
  }
  const buckets = spread(
    known,
    minutesOfFile,
    Math.max(1, Math.ceil(total / table.targetMinutes)),
  );
  return [
    ...buckets.map(bucket => ({
      entry: `${launch.label}:${bucket.join('+')}`,
      group,
      minutes: bucket.reduce((total, file) => total + minutesOfFile(file), 0),
    })),
    ...(unknown.length === 0
      ? []
      : [
          {
            entry: `${launch.label}:${unknown.join('+')}`,
            group,
            minutes: unknown.length * UNMEASURED_FILE_MINUTES,
          },
        ]),
  ];
}

/** The groups whose launches run in one part, in the table's order: the host cases, each of which can need the ones before it. */
export const ORDERED_GROUPS: readonly string[] = ['hosts'];

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
 * Every part of a VSCodium run, group by group in the table's order: each group's entries packed first-fit, the longest
 * first, into parts of at most the target, an entry over the target alone in its part; an ordered group's launches all
 * in one part. Named-only launches are in, as their group's selection makes them, unless the parts leave them out.
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
  return groups.flatMap(group => {
    const packed: Array<{total: number; members: Entry[]}> = [];
    const ofGroup = entries.filter(entry => entry.group === group);
    const ordered = ORDERED_GROUPS.includes(group);
    if (ordered) {
      packed.push({
        total: ofGroup.reduce((total, entry) => total + entry.minutes, 0),
        members: ofGroup,
      });
    }
    const longestFirst = ordered
      ? []
      : [...ofGroup].sort((left, right) => right.minutes - left.minutes);
    for (const entry of longestFirst) {
      const room = packed.find(
        part => part.total + entry.minutes <= table.targetMinutes,
      );
      if (room === undefined) {
        packed.push({total: entry.minutes, members: [entry]});
      } else {
        room.total += entry.minutes;
        room.members.push(entry);
      }
    }
    return packed.map((part, index) => ({
      name: `${group} ${String(index + 1)}/${String(packed.length)}`,
      launches: ofGroup
        .filter(entry => part.members.includes(entry))
        .map(entry => entry.entry)
        .join(','),
      minutes: limitOf(part.total),
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
  return {targetMinutes: table.targetMinutes, minutes};
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
    writeFileSync(PARTS_TABLE, `${JSON.stringify(refreshed, null, 2)}\n`);
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}
