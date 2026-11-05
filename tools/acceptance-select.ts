/**
 * @fileoverview acceptance-select: the launches of the VSCodium run that a change can reach. The labels come from the
 * files the change touches and from each launch's own fields; nothing names a label by hand.
 */

import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {type Launch, launchesOf} from './acceptance-launches.ts';
import {chosenLaunches} from './acceptance.ts';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

/** What the selection gives: the labels in the run's order, and per label the changed path that selected it. */
export interface Selection {
  labels: string[];
  reasons: string[];
}

/** Paths no launch can reach: documentation and unit tests. A closed list: any other path runs more, never less. */
const NO_LAUNCH = [
  /^docs\//,
  /\.md$/,
  /^packages\/[^/]+\/test\/unit\//,
  /^tools\/.*\.test\.ts$/,
];

/** The packages whose launches carry their extension, by the extension's id. */
const PACKAGE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['remote-containers', 'remote-oss.remote-containers'],
  ['remote-explorer', 'remote-oss.remote-explorer'],
]);

/** The extension ids a launch installs (plain launches name them in `withExtensions`; runner launches install none). */
function extensionsOfLaunch(launch: Launch): readonly string[] {
  return launch.kind === 'plain' ? (launch.withExtensions ?? []) : [];
}

/** The labels of the launches one changed path can reach, or undefined when it reaches every launch. */
function reachedBy(
  changed: string,
  launches: readonly Launch[],
): string[] | undefined {
  if (NO_LAUNCH.some(pattern => pattern.test(changed))) {
    return [];
  }
  const packageName = /^packages\/([^/]+)\//.exec(changed)?.[1];
  const extension =
    packageName === undefined ? undefined : PACKAGE_EXTENSIONS.get(packageName);
  if (extension !== undefined) {
    return launches
      .filter(launch => extensionsOfLaunch(launch).includes(extension))
      .map(launch => launch.label);
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
 * name reaches every launch; documentation and unit tests reach none.
 */
export function selectLaunches(
  changed: readonly string[],
  launches: readonly Launch[],
): Selection {
  const reasons = new Map<string, string>();
  for (const file of changed) {
    for (const label of reachedBy(file, launches) ??
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

/**
 * The parts the VSCodium job of `workflow` (ci.yml's text) runs a whole suite in, in order: its matrix's default, the
 * selection each runner makes.
 */
export function workflowParts(workflow: string): string[] {
  const parts = /\|\| '(\["@[^']*\])'/.exec(workflow)?.[1];
  if (parts === undefined) {
    throw new Error('ci.yml: the VSCodium job names no parts of the suite');
  }
  return JSON.parse(parts) as string[];
}

/**
 * The parts of the VSCodium job a selection needs, in the order of `parts`: a part all of whose launches are selected
 * as it is written, a part with some of them as those labels, and a part with none left out. A selected launch in no
 * part (the genuine group's, which have a job of their own) is left out too.
 */
export function partsOf(
  selection: Selection,
  launches: readonly Launch[],
  parts: readonly string[],
): string[] {
  const selected = new Set(selection.labels);
  const needed: string[] = [];
  for (const part of parts) {
    const inPart = chosenLaunches(launches, part.split(','));
    if (typeof inPart === 'string') {
      throw new Error(`ci.yml's part ${part}: ${inPart}`);
    }
    const labels = inPart
      .map(launch => launch.label)
      .filter(label => selected.has(label));
    if (labels.length > 0) {
      needed.push(labels.length === inPart.length ? part : labels.join(','));
    }
  }
  return needed;
}

/** The most launches a pull request's own acceptance job runs; a larger selection needs a dispatch or the full label. */
export const PULL_REQUEST_LAUNCHES = 6;

/**
 * The time limit of a pull request's acceptance job, whatever it runs: 360 minutes, the most a job may run on GitHub's
 * runners. One launch alone (containers-a) takes close to three hours there, so a selection of two of them outgrew
 * 180; no shared runner is held by a long job any more.
 */
export const PULL_REQUEST_MINUTES = 360;

/** What a pull request's acceptance job does for its selection. */
export interface PullRequestPlan {
  /** The launches it runs, joined by commas; empty when it runs none. */
  launches: string;
  /** Its time limit, `PULL_REQUEST_MINUTES` for any selection. */
  minutes: number;
  /** A notice for the pull request when the selection is over the limit and the label is absent. */
  notice?: string;
}

/**
 * The plan of a pull request's acceptance job: the selected launches that are in a part of the VSCodium job (the
 * genuine group has its own job), all of them when there are at most `PULL_REQUEST_LAUNCHES` or the pull request carries
 * the full label, and none otherwise, with a notice naming them.
 */
export function pullRequestPlan(
  selection: Selection,
  launches: readonly Launch[],
  parts: readonly string[],
  full: boolean,
): PullRequestPlan {
  const inParts = new Set<string>();
  for (const part of parts) {
    const inPart = chosenLaunches(launches, part.split(','));
    if (typeof inPart === 'string') {
      throw new Error(`ci.yml's part ${part}: ${inPart}`);
    }
    for (const launch of inPart) {
      inParts.add(launch.label);
    }
  }
  const chosen = selection.labels.filter(label => inParts.has(label));
  if (chosen.length === 0) {
    return {launches: '', minutes: PULL_REQUEST_MINUTES};
  }
  if (chosen.length <= PULL_REQUEST_LAUNCHES || full) {
    return {launches: chosen.join(','), minutes: PULL_REQUEST_MINUTES};
  }
  return {
    launches: '',
    minutes: PULL_REQUEST_MINUTES,
    notice: `this change selects ${String(chosen.length)} launches, more than the ${String(PULL_REQUEST_LAUNCHES)} a pull request runs by itself: ${chosen.join(', ')}. Run them at this head with a dispatch, or with the acceptance-full label.`,
  };
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
  'usage: node tools/acceptance-select.ts --base <sha> --head <sha> [--parts | --pull-request [--full]]';

if (isMainModule(import.meta.url)) {
  const commandArguments = process.argv.slice(2);
  const base = commandArguments[commandArguments.indexOf('--base') + 1];
  const head = commandArguments[commandArguments.indexOf('--head') + 1];
  const byParts = commandArguments.includes('--parts');
  const forPullRequest = commandArguments.includes('--pull-request');
  const full = commandArguments.includes('--full');
  const expected =
    4 + (byParts ? 1 : 0) + (forPullRequest ? 1 : 0) + (full ? 1 : 0);
  if (
    commandArguments.length !== expected ||
    (byParts && forPullRequest) ||
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
    const selection = selectLaunches(changedFiles(base, head), launches);
    for (const line of selection.reasons) {
      console.error(`selected ${line}`);
    }
    const parts = workflowParts(
      readFileSync(
        path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
        'utf8',
      ),
    );
    if (forPullRequest) {
      console.log(
        JSON.stringify(pullRequestPlan(selection, launches, parts, full)),
      );
    } else {
      console.log(
        byParts
          ? JSON.stringify(partsOf(selection, launches, parts))
          : launchesInput(selection, launches),
      );
    }
  }
}
