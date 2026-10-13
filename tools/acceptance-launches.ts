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
  /** Whether the editor is started with the proposed API enabled for the extensions under test; true when absent. */
  proposedApi?: boolean;
  /** Commands the run runs on the host container, as root, before each attempt of the launch, in order. */
  hostSetup?: readonly HostSetupEntry[];
}

/** One command of a launch's host setup, run on the host container through `docker exec`, in order. */
export interface HostSetupEntry {
  /** The command the host's `sh` runs with `-c`. */
  command: string;
  /** When true, the command is started with `docker exec -d` and the setup does not wait for it. */
  detach?: boolean;
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
  /**
   * Extensions of `LAUNCH_EXTENSIONS`, by id, that this launch alone installs, with their proposed API: the launch
   * gets an extensions folder of its own, `<run>/extensions-<label>`, so the other launches never see them.
   */
  withExtensions?: readonly string[];
  /** Whether the editor opens a debugging port for the run's renderer helpers. */
  debuggingPort?: boolean;
  /** Extensions, by id, that the editor starts disabled. */
  disabledExtensions?: readonly string[];
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

/** The extensions only some launches install, by id, with their package folders. */
export const LAUNCH_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['remote-oss.remote-explorer', 'remote-explorer'],
]);

/** What the explorer's launches share: the explorer, its proposed API and the debugging port. */
const EXPLORER_LAUNCH = {
  kind: 'plain',
  withExtensions: ['remote-oss.remote-explorer'],
  debuggingPort: true,
  // The renderer helpers find a window by its title: its folder name in brackets, `[]` for a window with none.
  settings: {'window.title': '[${rootName}]'},
} as const;

/** The form of a launch's label and of a failing connect's alias: lower-case letters, digits and hyphens, starting with a letter. */
export const LABEL_FORM = /^[a-z][a-z0-9-]*$/;

/**
 * The launches that may set `remote.SSH.configFile` themselves, by label: none yet. Every other launch uses the run's
 * ssh_config, which the harness hosts reach.
 */
export const CONFIG_FILE_LAUNCHES: readonly string[] = [];

/** The token for the run's folder, which a launch's settings and environment may name. */
const RUN_FOLDER_TOKEN = '<run>';

/** The token for the run's `PATH`. */
const RUN_PATH_TOKEN = '<path>';

/**
 * A value with the run's tokens put in: each string in it, at any depth, with the run's folder in place of `<run>` and
 * the run's `PATH` in place of `<path>`.
 */
export function withRunTokens<Value>(
  value: Value,
  runFolder: string,
  searchPath: string,
): Value {
  if (typeof value === 'string') {
    return value
      .replaceAll(RUN_FOLDER_TOKEN, runFolder)
      .replaceAll(RUN_PATH_TOKEN, searchPath) as Value;
  }
  if (Array.isArray(value)) {
    return value.map(item =>
      withRunTokens(item as unknown, runFolder, searchPath),
    ) as Value;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        withRunTokens(item as unknown, runFolder, searchPath),
      ]),
    ) as Value;
  }
  return value;
}

/** One launch of the client search: the `remote.SSH.path` it sets, what it extra sets, and the calls it must make. */
export interface ClientCase {
  label: string;
  /** The criteria the case proves. */
  cite: string;
  /** The value of `remote.SSH.path`; null leaves the setting unset. */
  setting: string | null;
  settings?: Readonly<Record<string, unknown>>;
  environment?: Readonly<Record<string, string>>;
  /** The programs checked, in order, by their name under `clients/`. */
  checked: readonly string[];
  /** The program the lookup and the connection run. */
  used: string;
}

/** The client-search launches, from tests/acceptance/suite-client/cases.json, which the client suite also reads. */
export function clientCases(root: string): ClientCase[] {
  const {cases} = JSON.parse(
    readFileSync(
      path.join(root, 'tests', 'acceptance', 'suite-client', 'cases.json'),
      'utf8',
    ),
  ) as {cases: ClientCase[]};
  for (const each of cases) {
    if (!LABEL_FORM.test(each.label)) {
      throw new Error(
        `a client case's label must match ${String(LABEL_FORM)}: "${each.label}"`,
      );
    }
  }
  return cases;
}

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

/** One ports case of the VSCodium run: one launch per case, with its host setup and its expectations. */
export interface PortsCase {
  /** The name of the case; the launch is `ports-<label>`. */
  label: string;
  /** The cite of the case's rows: the criterion of the case and its label, in parentheses. */
  cite: string;
  /** The authority the window opens, default `harness`. */
  authority?: string;
  /** Settings merged over the run's base settings for the case's launch. */
  settings: Record<string, unknown>;
  /** The ports a non-product listener holds on the host before the connect. */
  holders?: number[];
  /** Keeps the previous launch's server on the host, so the case reuses it. */
  keepServer?: boolean;
  /** How the case's connect ends. */
  outcome: 'connected' | 'connectedOrDialog';
  /** The port the server listens on, or "random" for a port outside the case's ranges. */
  port?: number | 'random';
  /** The address the server listens on, when the case checks it. */
  address?: string;
  /** The case checks that another machine of the run reaches the server's port. */
  reaches?: boolean;
  /** The port on which nothing new may listen. */
  noListenerOn?: number;
  /** The case checks that no notice appeared. */
  noNotice?: boolean;
}

/** The ports cases, in the order the run makes their launches, from tests/acceptance/suite-ports/cases.json. */
export function portsCases(root: string): PortsCase[] {
  const {cases} = JSON.parse(
    readFileSync(
      path.join(root, 'tests', 'acceptance', 'suite-ports', 'cases.json'),
      'utf8',
    ),
  ) as {cases: PortsCase[]};
  const labels: string[] = [];
  for (const entry of cases) {
    // The label becomes part of file names, a test-cli label and an extension-host variable.
    if (!LABEL_FORM.test(entry.label)) {
      throw new Error(
        `a ports case's label must match ${String(LABEL_FORM)}: "${entry.label}"`,
      );
    }
    if (labels.includes(entry.label)) {
      throw new Error(`two ports cases share the label "${entry.label}"`);
    }
    labels.push(entry.label);
  }
  return cases;
}

/**
 * The host setup of a ports case, in the order the run runs it: free the held ports, free the server unless the case
 * keeps it, then hold the case's ports, each waited on as it starts. The brackets keep `pkill` from matching the
 * `sh -c` that runs it.
 */
export function portsHostSetup(portsCase: PortsCase): HostSetupEntry[] {
  const entries: HostSetupEntry[] = [{command: "pkill -f 'n[c] -lk -p'; true"}];
  if (portsCase.keepServer !== true) {
    entries.push({
      command:
        "pkill -f '/home/harness/[.]vscodium-server-insiders/bin/'; " +
        'for i in $(seq 1 20); do ' +
        "pgrep -f '/home/harness/[.]vscodium-server-insiders/bin/' >/dev/null || exit 0; " +
        'sleep 0.5; done; exit 1',
    });
  }
  const holders = portsCase.holders ?? [];
  for (const holder of holders) {
    entries.push({
      command: `nc -lk -p ${String(holder)} -s 127.0.0.1 -e /bin/true`,
      detach: true,
    });
  }
  for (const holder of holders) {
    entries.push({
      command:
        'for i in $(seq 1 20); do ' +
        `netstat -ltn | grep -q ' 127.0.0.1:${String(holder)} ' && exit 0; ` +
        'sleep 0.25; done; exit 1',
    });
  }
  return entries;
}

/**
 * The launches of the VSCodium run: `local` runs suite-local in a plain window; `remote` runs suite-remote in a
 * window on `ssh-remote+harness`, where the runner is an extension of the workspace kind; `reconnect` runs
 * suite-reconnect in a second launch on the same folder, which finds the first launch's server (ruling 2); each
 * failing connect runs suite-failure in a window on its alias, answered from its own script; and `terminal` runs
 * suite-terminal with `remote.SSH.useLocalServer` off; `slow` runs suite-slow with an extension that takes 15 s to
 * activate in the remote extension host, which the harness copies to the host first; each `client-…` launch runs
 * suite-client with a `remote.SSH.path` of its own and fake clients on the run's `PATH`; `windows` starts the editor plainly, with no
 * runner and no folder, and drives its windows through the window agent from a Node run; `no-proposals` does the
 * same without enabling the proposed API; `explorer`, `explorer-alone` and `explorer-no-proposals` do the same with
 * Remote Explorer installed and a debugging port, the second with Remote - SSH disabled and the third without the
 * proposed API; and each ports case of suite-ports/cases.json runs after every other launch, with its host setup and
 * its own script.
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
      settings: {
        'remote.SSH.useLocalServer': false,
        'remote.SSH.remotePlatform': {harness: 'linux'},
      },
    },
    {
      label: 'slow',
      runner: 'runner-remote',
      suite: 'suite-slow',
      folderUri: REMOTE_FOLDER_URI,
      hostExtensions: ['slow-remote'],
    },
    ...clientCases(root).map((each): Launch => ({
      label: each.label,
      runner: 'runner-remote',
      suite: 'suite-client',
      folderUri: REMOTE_FOLDER_URI,
      ownScript: true,
      settings: {
        ...(each.setting === null ? {} : {'remote.SSH.path': each.setting}),
        ...each.settings,
      },
      environment: {
        PATH: `${RUN_FOLDER_TOKEN}/clients/path:${RUN_PATH_TOKEN}`,
        HARNESS_CLIENT_CASE: each.label,
        ...each.environment,
      },
    })),
    {
      label: 'terminal-pick',
      kind: 'plain',
      suite: 'terminal-pick',
      settings: {'remote.SSH.useLocalServer': false},
    },
    {label: 'windows', kind: 'plain', suite: 'windows'},
    {
      label: 'no-proposals',
      kind: 'plain',
      suite: 'no-proposals',
      proposedApi: false,
    },
    {...EXPLORER_LAUNCH, label: 'explorer', suite: 'explorer'},
    {
      ...EXPLORER_LAUNCH,
      label: 'explorer-alone',
      suite: 'explorer-alone',
      disabledExtensions: ['remote-oss.remote-ssh'],
    },
    {
      ...EXPLORER_LAUNCH,
      label: 'explorer-no-proposals',
      suite: 'explorer-no-proposals',
      proposedApi: false,
    },
    ...portsCases(root).map((portsCase): Launch => ({
      label: `ports-${portsCase.label}`,
      runner: 'runner-remote',
      suite: 'suite-ports',
      folderUri: `vscode-remote://ssh-remote+${
        portsCase.authority ?? 'harness'
      }/home/harness`,
      settings: portsCase.settings,
      environment: {HARNESS_PORTS_CASE: portsCase.label},
      ownScript: true,
      hostSetup: portsHostSetup(portsCase),
    })),
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
