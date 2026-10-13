/**
 * @fileoverview acceptance-launches: the table of launches of the VSCodium run, in the order the run makes them. A
 * launch that needs its own settings, environment or extensions says so here, and nowhere else.
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';

/** The window the remote launches open: the harness host's home folder over `ssh-remote`. */
const REMOTE_FOLDER_URI = 'vscode-remote://ssh-remote+harness/home/harness';

/** What every launch of the VSCodium run has. */
interface LaunchCommon {
  /** The label: lower-case letters, digits and hyphens. */
  label: string;
  /** The window's folder; none for a local window. */
  folderUri?: string;
  /** Settings merged over the run's base settings for this launch only. */
  settings?: Readonly<Record<string, unknown>>;
  /** Variables added to the extension host's environment for this launch only. */
  environment?: Readonly<Record<string, string>>;
}

/** A launch whose tests run in a window of the editor, started by test-cli. */
export interface RunnerLaunch extends LaunchCommon {
  kind?: undefined;
  /** The development extension the tests run in: `runner` (a local window) or `runner-remote` (a remote one). */
  runner: 'runner' | 'runner-remote';
  /** The suite folder under tests/acceptance, bundled into `dist-<suite without "suite-">`. */
  suite: string;
  /** Whether the launch answers from its own script and record files (`<label>-script.json`, `<label>-record.jsonl`). */
  ownScript?: boolean;
  /** Further development extensions, folders under tests/acceptance, loaded after the runner. */
  extraExtensions?: readonly string[];
  /**
   * Development extensions that run in the remote extension host: folders under tests/acceptance, copied into the
   * host's home folder before the launch and loaded from there. A development extension named by a local path never
   * runs on the host.
   */
  hostExtensions?: readonly string[];
}

/**
 * A launch with no test run in the editor: the editor starts plainly, as a user starts it, and a Node mocha run of the
 * tests in `suite`, a folder under tests/acceptance, drives and observes it through the window agent.
 */
export interface PlainLaunch extends LaunchCommon {
  kind: 'plain';
  suite: string;
}

/** One launch of the VSCodium run, in the order the run makes them. */
export type Launch = RunnerLaunch | PlainLaunch;

/** One failing connect of the VSCodium run: its own launch on `alias`, the script its window answers from. */
export interface FailureCase {
  alias: string;
  /** The name of the launch, `failure-<label>`; without it the launch is `failure-<alias>`, so one alias can run twice. */
  label?: string;
  cite: string;
  script: unknown[];
  dialog: string;
  /** Settings merged over the run's base settings for the connect's launch. */
  settings?: Record<string, unknown>;
  /** The bound the dialog's time is checked against: at most `milliseconds` after the first record line whose surface is `from`. */
  bound?: {from: string; milliseconds: number; cite: string};
}

/** The form of a launch's label and of a failing connect's alias: lower-case letters, digits and hyphens, starting with a letter. */
export const LABEL_FORM = /^[a-z][a-z0-9-]*$/;

/**
 * The launches that may set `remote.SSH.configFile` themselves, by label: none yet. Every other launch uses the run's
 * ssh_config, which the harness hosts reach.
 */
export const CONFIG_FILE_LAUNCHES: readonly string[] = [];

/** The failing connects, from tests/acceptance/suite-failure/cases.json, which the failure suite also reads. */
export function failureCases(root: string): FailureCase[] {
  const {cases} = JSON.parse(
    readFileSync(
      path.join(root, 'tests', 'acceptance', 'suite-failure', 'cases.json'),
      'utf8',
    ),
  ) as {cases: FailureCase[]};
  const labels: string[] = [];
  for (const failure of cases) {
    // The alias becomes part of a file name, a test-cli label and a URI authority.
    if (!LABEL_FORM.test(failure.alias)) {
      throw new Error(
        `a failing connect's alias must match ${String(LABEL_FORM)}: "${failure.alias}"`,
      );
    }
    const label = failure.label ?? failure.alias;
    if (failure.label !== undefined && !LABEL_FORM.test(failure.label)) {
      throw new Error(
        `a failing connect's label must match ${String(LABEL_FORM)}: "${failure.label}"`,
      );
    }
    if (labels.includes(label)) {
      throw new Error(`two failing connects share the label "${label}"`);
    }
    labels.push(label);
  }
  return cases;
}

/** The label of the launch of a failing connect. */
export function failureLabel(alias: string): string {
  return `failure-${alias}`;
}

/**
 * The launches of the VSCodium run: `local` runs suite-local in a plain window; `remote` runs suite-remote in a
 * window on `ssh-remote+harness`, where the runner is an extension of the workspace kind; `reconnect` runs
 * suite-reconnect in a second launch on the same folder, which finds the first launch's server (ruling 2); each
 * failing connect runs suite-failure in a window on its alias, answered from its own script; and `terminal` runs
 * suite-terminal with `remote.SSH.useLocalServer` off; `slow` runs suite-slow with an extension that takes 15 s to
 * activate in the remote extension host, which the harness copies to the host first; `windows` starts the editor plainly, with no
 * runner and no folder, and drives its windows through the window agent from a Node run.
 */
export function launchesOf(root: string): Launch[] {
  const launches: Launch[] = [
    {label: 'local', runner: 'runner', suite: 'suite-local'},
    {
      label: 'remote',
      runner: 'runner-remote',
      suite: 'suite-remote',
      folderUri: REMOTE_FOLDER_URI,
    },
    {
      label: 'reconnect',
      runner: 'runner-remote',
      suite: 'suite-reconnect',
      folderUri: REMOTE_FOLDER_URI,
    },
    ...failureCases(root).map((failure): Launch => ({
      label: failureLabel(failure.label ?? failure.alias),
      runner: 'runner-remote',
      suite: 'suite-failure',
      folderUri: `vscode-remote://ssh-remote+${failure.alias}/home/harness`,
      ...(failure.settings === undefined ? {} : {settings: failure.settings}),
      environment: {HARNESS_FAILURE_CASE: failure.label ?? failure.alias},
      ownScript: true,
    })),

    {
      label: 'terminal',
      runner: 'runner-remote',
      suite: 'suite-terminal',
      folderUri: REMOTE_FOLDER_URI,
      settings: {'remote.SSH.useLocalServer': false},
    },
    {
      label: 'slow',
      runner: 'runner-remote',
      suite: 'suite-slow',
      folderUri: REMOTE_FOLDER_URI,
      hostExtensions: ['slow-remote'],
    },
    {label: 'windows', kind: 'plain', suite: 'windows'},
  ];
  return launches;
}

/** The folder a suite is bundled into: `dist` for the shared suite, `dist-<name>` for `suite-<name>`. */
export function bundleFolderOf(suite: string): string {
  return suite === 'suite' ? 'dist' : `dist-${suite.slice('suite-'.length)}`;
}

/** The development extensions that are bundled, each once: folders under tests/acceptance with a `src/extension.ts`. */
export function extensionsOf(launches: readonly Launch[]): string[] {
  return [
    ...new Set(
      runnerLaunches(launches).flatMap(launch => [
        ...(launch.extraExtensions ?? []),
        ...(launch.hostExtensions ?? []),
      ]),
    ),
  ];
}

/** Where a host extension is on the harness host: the user's home folder, which the remote window can load it from. */
export function hostExtensionFolder(extension: string): string {
  return `/home/harness/${extension}`;
}

/** The launches that run tests in a window of the editor, by test-cli. */
export function runnerLaunches(launches: readonly Launch[]): RunnerLaunch[] {
  return launches.filter(launch => launch.kind === undefined);
}

/** The suites that are bundled: the shared helpers, then each suite of a launch with a runner once. */
export function suitesOf(launches: readonly Launch[]): string[] {
  return [
    'suite',
    ...new Set(runnerLaunches(launches).map(launch => launch.suite)),
  ];
}
