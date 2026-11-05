/**
 * @fileoverview acceptance-select: the launches of the VSCodium run that a change can reach. The labels come from the
 * files the change touches and from each launch's own fields; nothing names a label by hand.
 */

import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import * as launchTable from './acceptance-launches.ts';
import {type Launch, launchesOf} from './acceptance-launches.ts';
import {
  heldTogether,
  PARTS_TABLE,
  type Part,
  partsOfTable,
  type PartsTable,
  suiteFilesIn,
} from './acceptance-parts.ts';
import {
  LAUNCH_TABLE,
  labelsChangedSince,
  measuredPackages,
  NO_LAUNCH,
  SUITE_TEST,
  withHelpersAsTests,
} from './acceptance-reach.ts';
import {chosenLaunches} from './acceptance.ts';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** What the selection gives: the labels in the run's order, and per label the changed path that selected it. */
export interface Selection {
  labels: string[];
  reasons: string[];
}

/**
 * The labels of the launches one changed path can reach, or undefined when it reaches every launch. `measured` holds
 * the reach of paths measured beforehand (the launch table's changed entries and the packages' paths,
 * acceptance-reach.ts); a package's path that is not measured reaches every launch.
 */
function reachedBy(
  changed: string,
  launches: readonly Launch[],
  measured: ReadonlyMap<string, readonly string[]>,
): readonly string[] | undefined {
  const known = measured.get(changed);
  if (known !== undefined) {
    return known;
  }
  if (NO_LAUNCH.some(pattern => pattern.test(changed))) {
    return [];
  }
  // only a suite's own tests map to it: other files in a suite folder can be the harness several suites import
  // (tests/acceptance/windows/renderer.ts), so they reach every launch
  const suiteTest = /^tests\/acceptance\/([^/]+)\/(.*\.test\.ts)$/.exec(
    changed,
  );
  const bySuite = launches.filter(launch => launch.suite === suiteTest?.[1]);
  if (suiteTest === null || bySuite.length === 0) {
    return undefined;
  }
  // a suite run in parts by its files (containers-a and containers-b): a test reaches the parts that list it, and
  // every part when none does
  const testFile = path.basename(String(suiteTest[2]));
  const byFile = bySuite.filter(
    launch =>
      launch.kind !== 'plain' ||
      launch.files === undefined ||
      launch.files.includes(testFile),
  );
  return (byFile.length > 0 ? byFile : bySuite).map(launch => launch.label);
}

/**
 * The launches a change can reach, in the run's order: the union over its changed paths. A path the table does not
 * name reaches every launch, unless `measured` gives its reach; documentation and unit tests reach none.
 */
export function selectLaunches(
  changed: readonly string[],
  launches: readonly Launch[],
  measured: ReadonlyMap<string, readonly string[]> = new Map(),
): Selection {
  const reasons = new Map<string, string>();
  for (const file of changed) {
    for (const label of reachedBy(file, launches, measured) ??
      launches.map(launch => launch.label)) {
      if (!reasons.has(label)) {
        reasons.set(label, file);
      }
    }
  }
  const labels = launches
    .map(launch => launch.label)
    .filter(label => reasons.has(label));
  return {
    labels,
    reasons: labels.map(label => `${label}: ${String(reasons.get(label))}`),
  };
}

/** The value of the dispatch's `launches` input for a selection: `all`, `none`, or the labels joined by commas. */
export function launchesInput(
  selection: Selection,
  launches: readonly Launch[],
): string {
  if (selection.labels.length === 0) {
    return 'none';
  }
  return selection.labels.length === launches.length
    ? 'all'
    : selection.labels.join(',');
}

/** What a pull request's acceptance run does for its change: its parts, each a job of its own, run side by side. */
export interface PullRequestPlan {
  /** The parts; none when it runs nothing. */
  parts: Part[];
}

/**
 * The time limit of a part that runs some files of one launch: the longest file measured (49 minutes, containers-volume's
 * explore-volume.test.ts at 847c1d9d) and its launch's setup, on the slower of the two runners.
 */
export const FILE_PART_MINUTES = 120;

/** The most file parts a test-only change runs one file each; past it, each launch's files run as one part. */
export const FILE_PARTS = 20;

/**
 * The part a narrowed pull request runs beside its file parts, so a narrow selection still starts the editor: an
 * activation (`local`), a plain connect (`remote`) and a Reopen Folder Locally (`c101-reopen-locally`), about three
 * minutes of rows.
 */
export const SMOKE_PART: Part = {
  name: 'smoke',
  launches: 'local,remote,containers-shutdown:reopen-locally-lines.test.ts',
  minutes: 60,
};

/**
 * The parts of a test-only change: each changed test file of a plain launch's suite runs alone in every launch that runs
 * it, then the smoke part, which a change that only removes test files runs alone. Undefined when the change is not
 * test-only, when a test file belongs to a launch run in the editor, or when no launch runs it: its launches' parts run
 * then. Documentation and unit tests alone run nothing.
 */
export function narrowedParts(
  changed: readonly string[],
  launches: readonly Launch[],
  exists: (file: string) => boolean,
): Part[] | undefined {
  const byLaunch = new Map<string, string[]>();
  let touchesTests = false;
  for (const file of changed) {
    if (NO_LAUNCH.some(pattern => pattern.test(file))) {
      continue;
    }
    const suiteTest = SUITE_TEST.exec(file);
    const ofSuite = launches.filter(launch => launch.suite === suiteTest?.[1]);
    if (
      suiteTest === null ||
      ofSuite.length === 0 ||
      ofSuite.some(launch => launch.kind !== 'plain')
    ) {
      return undefined;
    }
    touchesTests = true;
    if (!exists(file)) {
      continue;
    }
    const testFile = String(suiteTest[2]);
    const running = ofSuite.filter(
      launch =>
        launch.kind === 'plain' &&
        (launch.files === undefined || launch.files.includes(testFile)),
    );
    if (running.length === 0) {
      return undefined;
    }
    for (const launch of running) {
      byLaunch.set(launch.label, [
        ...(byLaunch.get(launch.label) ?? []),
        testFile,
      ]);
    }
  }
  const entries = [...byLaunch].map(([label, files]) => ({label, files}));
  const count = entries.reduce((total, entry) => total + entry.files.length, 0);
  const parts = entries.flatMap(({label, files}) =>
    (count <= FILE_PARTS ? files.map(file => [file]) : [files]).map(group => {
      const launchesOfPart = `${label}:${group.join('+')}`;
      return {
        name: launchesOfPart,
        launches: launchesOfPart,
        minutes: FILE_PART_MINUTES,
      };
    }),
  );
  return touchesTests ? [...parts, SMOKE_PART] : [];
}

/** The parts of the run's table that make at least one launch of the selection, in the table's order. */
export function selectedParts(
  selection: Selection,
  launches: readonly Launch[],
  tableParts: readonly Part[],
): Part[] {
  const selected = new Set(selection.labels);
  return tableParts.filter(part => {
    const made = chosenLaunches(launches, part.launches.split(','));
    if (typeof made === 'string') {
      throw new Error(`the part ${part.name}: ${made}`);
    }
    return made.some(launch => selected.has(launch.label));
  });
}

/**
 * The plan of a pull request's acceptance run for its changed paths: the narrowed parts of a test-only change, unless
 * the full label asks for more; else every part of the table that makes a launch the change reaches, side by side. A
 * narrowed file of a launch that runs only with others (`held`) runs in the table's part of that launch instead, so it
 * keeps the launch before it.
 */
export function planOfChange(
  changed: readonly string[],
  launches: readonly Launch[],
  tableParts: readonly Part[],
  full: boolean,
  exists: (file: string) => boolean,
  measured: ReadonlyMap<string, readonly string[]> = new Map(),
  held: (launch: Launch) => boolean = () => false,
): PullRequestPlan {
  const narrowed = full ? undefined : narrowedParts(changed, launches, exists);
  if (narrowed === undefined) {
    return {
      parts: selectedParts(
        selectLaunches(changed, launches, measured),
        launches,
        tableParts,
      ),
    };
  }
  const heldLabels = launches
    .filter(launch => held(launch))
    .map(launch => launch.label);
  const kept = narrowed.filter(
    part => !heldLabels.includes(part.launches.split(':')[0] ?? ''),
  );
  const ofHeld = selectedParts(
    {
      labels: heldLabels.filter(label =>
        narrowed.some(part => part.launches.split(':')[0] === label),
      ),
      reasons: [],
    },
    launches,
    tableParts,
  );
  return {parts: [...ofHeld, ...kept]};
}

/**
 * The changed paths of `base`...`head` as the selection reads them, and the reach measured for the launch table and
 * the packages: each suite helper as the tests that stand for it, a changed launch table as the launches whose entries
 * differ, and a package's path as the launches its package reaches (packageReach), read at the head.
 */
export async function measuredChange(
  base: string,
  head: string,
  launches: readonly Launch[],
): Promise<{
  changed: string[];
  measured: Map<string, readonly string[]>;
}> {
  const changed = withHelpersAsTests(
    changedFiles(base, head),
    REPOSITORY_ROOT,
    new Set(launches.map(launch => launch.suite)),
  );
  const measured = measuredPackages(changed, launches, REPOSITORY_ROOT);
  const labels = changed.includes(LAUNCH_TABLE)
    ? await labelsChangedSince(base, launchTable, REPOSITORY_ROOT)
    : undefined;
  if (labels !== undefined) {
    measured.set(LAUNCH_TABLE, labels);
  }
  return {changed, measured};
}

/** The files a change touches: `git diff --name-only <base>...<head>`, from the merge base. */
function changedFiles(base: string, head: string): string[] {
  return execFileSync(
    'git',
    ['diff', '--no-renames', '--name-only', `${base}...${head}`],
    {cwd: REPOSITORY_ROOT, encoding: 'utf8'},
  )
    .split('\n')
    .filter(line => line !== '');
}

const SELECT_USAGE =
  'usage: node tools/acceptance-select.ts --base <sha> --head <sha> [--pull-request [--full]]';

if (isMainModule(import.meta.url)) {
  const commandArguments = process.argv.slice(2);
  const base = commandArguments[commandArguments.indexOf('--base') + 1];
  const head = commandArguments[commandArguments.indexOf('--head') + 1];
  const forPullRequest = commandArguments.includes('--pull-request');
  const full = commandArguments.includes('--full');
  const expected = 4 + (forPullRequest ? 1 : 0) + (full ? 1 : 0);
  if (
    commandArguments.length !== expected ||
    (full && !forPullRequest) ||
    !commandArguments.includes('--base') ||
    !commandArguments.includes('--head') ||
    base === undefined ||
    head === undefined
  ) {
    console.error(SELECT_USAGE);
    process.exitCode = 2;
  } else {
    const launches = launchesOf(REPOSITORY_ROOT);
    const {changed, measured} = await measuredChange(base, head, launches);
    const selection = selectLaunches(changed, launches, measured);
    for (const line of selection.reasons) {
      console.error(`selected ${line}`);
    }
    if (forPullRequest) {
      const table = JSON.parse(readFileSync(PARTS_TABLE, 'utf8')) as PartsTable;
      console.log(
        JSON.stringify(
          planOfChange(
            changed,
            launches,
            partsOfTable(launches, table, suiteFilesIn(REPOSITORY_ROOT)),
            full,
            file => existsSync(path.join(REPOSITORY_ROOT, file)),
            measured,
            heldTogether(table),
          ),
        ),
      );
    } else {
      console.log(launchesInput(selection, launches));
    }
  }
}
