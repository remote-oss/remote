/**
 * @fileoverview acceptance-select: the launches of the VSCodium run that a change can reach. The labels come from the
 * files the change touches and from each launch's own fields; nothing names a label by hand.
 */

import {execFileSync} from 'node:child_process';
import {type Launch, launchesOf} from './acceptance-launches.ts';
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
  const folder = /^tests\/acceptance\/([^/]+)\/.*\.test\.ts$/.exec(
    changed,
  )?.[1];
  const bySuite = launches.filter(launch => launch.suite === folder);
  return folder !== undefined && bySuite.length > 0
    ? bySuite.map(launch => launch.label)
    : undefined;
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
  'usage: node tools/acceptance-select.ts --base <sha> --head <sha>';

if (isMainModule(import.meta.url)) {
  const commandArguments = process.argv.slice(2);
  const base = commandArguments[commandArguments.indexOf('--base') + 1];
  const head = commandArguments[commandArguments.indexOf('--head') + 1];
  if (
    commandArguments.length !== 4 ||
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
    console.log(launchesInput(selection, launches));
  }
}
