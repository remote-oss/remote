/**
 * @fileoverview acceptance-launches: the table of launches of the VSCodium run, in the order the run makes them. A
 * launch that needs its own settings, environment or extensions says so here, and nowhere else.
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';
import type {HostBase} from './host-variants.ts';

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
  /** Text written after the last member of the user settings file with no comma before it: a syntax error after the members. */
  settingsTail?: string;
  /** Variables added to the extension host's environment for this launch only. */
  environment?: Readonly<Record<string, string>>;
  /** Whether the editor is started with the proposed API enabled for the extensions under test; true when absent. */
  proposedApi?: boolean;
  /**
   * Commands the run runs on the launch's own host container (the harness host's, or its `hostBase`'s), as root, before
   * each attempt of the launch, in order.
   */
  hostSetup?: readonly HostSetupEntry[];
  /** Ports of the client's loopback the run listens on while each attempt of the launch runs, to make a configured range busy. */
  clientListeners?: readonly number[];
  /** Whether the run starts its registry for this launch; its address is HARNESS_REGISTRY. */
  registry?: true;
  /**
   * Whether the run publishes its templates into its registry and serves its template index for this launch; it starts
   * the registry too. The index is REMOTE_OSS_TEMPLATE_INDEX, and the registry as the templates name it
   * HARNESS_TEMPLATE_REGISTRY.
   */
  templates?: true;
  /** Whether the run makes the launch only when `--launches` names it. */
  namedOnly?: true;
  /**
   * The engine the launch's extension drives instead of Docker: it sets `dev.containers.dockerPath`, and the run
   * prepares that engine's storage. The run's own infrastructure (the SSH host, the registry, the download host) stays
   * on Docker.
   */
  engine?: 'podman';
  /**
   * The base of the SSH host the launch's window connects to, when it is not Alpine's: the run starts a host of that
   * base beside its own, and the launch's ssh_config, settings and harness variables name it.
   */
  hostBase?: Exclude<HostBase, 'alpine'>;
  /**
   * Whether the launch's server comes from the editor's publisher rather than from the run's download host, or its rows
   * accept the publisher's licence: while it runs, the harness host resolves the update service's name through DNS, not
   * to the download host. Only a launch of the genuine client has it, and the run makes it only in the genuine job.
   */
  publisherDownloads?: true;
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
  /** The editor the launch starts: VS Code at the floor of ADR-0007 instead of the run's VSCodium. */
  client?: 'vscode';
  /**
   * Extensions of `LAUNCH_EXTENSIONS`, by id, that this launch alone installs, with their proposed API: the launch
   * gets an extensions folder of its own, `<run>/extensions-<label>`, so the other launches never see them.
   */
  withExtensions?: readonly string[];
  /** Whether the editor opens a debugging port for the run's renderer helpers. */
  debuggingPort?: boolean;
  /** Extensions, by id, that the editor starts disabled. */
  disabledExtensions?: readonly string[];
  /** Whether the editor starts with workspace trust on, so a folder opens untrusted until the user trusts it. */
  workspaceTrust?: boolean;
  /**
   * Ids of stand-ins the run puts into this launch's own extensions folder before it starts: a manifest only, with no
   * code and no contribution, carrying the id it stands for.
   */
  standIns?: readonly string[];
  /** The display language the editor starts in, as its `--locale` switch takes it. */
  locale?: string;
  /**
   * The language id of a fixture language pack the launch installs, packaged from the language suite's fixtures: an
   * extension that contributes a display language and translates nothing.
   */
  languagePack?: string;
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
  /** Ports of the client's loopback the run listens on while each attempt of the case's launch runs. */
  clientListeners?: readonly number[];
  /** The bound the dialog's time is checked against: at most `milliseconds` after the first record line whose surface is `from`. */
  bound?: {from: string; milliseconds: number; cite: string};
}

/** The extensions only some launches install, by id, with their package names, the ones their VSIX files carry. */
export const LAUNCH_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['remote-oss.remote-explorer', 'remote-explorer'],
  ['remote-oss.remote-containers', 'remote-containers'],
  ['remote-oss.vscode-remote-extensionpack', 'vscode-remote-extensionpack'],
]);

/** What a launch the renderer helpers read needs: the debugging port, and window titles they can find a window by. */
const RENDERER_LAUNCH = {
  kind: 'plain',
  debuggingPort: true,
  // The renderer helpers find a window by its title: its folder name in brackets, `[]` for a window with none.
  settings: {'window.title': '[${rootName}]'},
} as const;

/** What the explorer's launches share: the explorer and its proposed API, read by the renderer helpers. */
const EXPLORER_LAUNCH = {
  ...RENDERER_LAUNCH,
  withExtensions: ['remote-oss.remote-explorer'],
  // The remote name after the folder, as core's own label gives it, so a claimed window's page is found by its state.
  settings: {'window.title': '[${rootName}]${remoteName}'},
} as const;

/** The editor's gallery variables pointed at a closed port, so that the Extensions view has no gallery data. */
const UNREACHABLE_GALLERY = {
  VSCODE_GALLERY_SERVICE_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_ITEM_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_CONTROL_URL: 'http://127.0.0.1:1',
  VSCODE_GALLERY_RESOURCE_URL_TEMPLATE:
    'http://127.0.0.1:1/{publisher}/{name}/{version}/{path}',
} as const;

/** What the trust launches share: workspace trust on, read by the renderer helpers. */
const TRUST_LAUNCH = {...RENDERER_LAUNCH, workspaceTrust: true} as const;

/**
 * What the containers launches share: Dev Containers and its proposed API, the renderer, core's dialogs drawn in the
 * window where the renderer reads them, and the server downloaded from the run's download host.
 */
const CONTAINERS_LAUNCH = {
  ...RENDERER_LAUNCH,
  withExtensions: ['remote-oss.remote-containers'],
  settings: {
    ...RENDERER_LAUNCH.settings,
    'window.dialogStyle': 'custom',
    // The folder dialog is the in-window one, which the renderer helpers can type into.
    'files.simpleDialog.enable': true,
    'remote.serverDownloadBaseUrl': '${HARNESS_DOWNLOADS_LOCAL}/ok',
  },
} as const;

/**
 * The genuine VS Code launch: VS Code at the floor of ADR-0007 runs the extensions with their real dialogs, which the
 * rows read and answer in the window. The run makes it only when `--launches` names it, and it is the table's last.
 */
const GENUINE_LAUNCH: PlainLaunch = {
  ...RENDERER_LAUNCH,
  label: 'genuine',
  suite: 'genuine',
  client: 'vscode',
  namedOnly: true,
  withExtensions: ['remote-oss.remote-explorer'],
  settings: {
    ...RENDERER_LAUNCH.settings,
    'window.dialogStyle': 'custom',
    'remote.SSH.localServerDownload': 'off',
    // Genuine VS Code makes its own requests from the runner; none of them is wanted.
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoCheckUpdates': false,
    'extensions.autoUpdate': false,
    'workbench.enableExperiments': false,
    'workbench.settings.enableNaturalLanguageSearch': false,
    'chat.disableAIFeatures': true,
  },
  // The empty script makes the extension show its real dialogs.
  environment: {REMOTE_OSS_ACCEPTANCE_SCRIPT: ''},
};

/**
 * The genuine client with our Dev Containers and Docker: the server comes from the run's stand-in licensed host, so the
 * licence question of a server under terms of its own is asked and nothing reaches the editor's publisher. The other
 * Dev Containers extension is never installed.
 */
const GENUINE_CONTAINERS_LAUNCH: PlainLaunch = {
  ...GENUINE_LAUNCH,
  label: 'genuine-containers',
  suite: 'genuine-containers',
  withExtensions: ['remote-oss.remote-containers'],
  settings: {
    ...GENUINE_LAUNCH.settings,
    // The folder dialog is the in-window one, which the renderer helpers can type into.
    'files.simpleDialog.enable': true,
    'remote.serverDownloadBaseUrl': '${HARNESS_DOWNLOADS_LICENSED}',
  },
};

/**
 * The genuine client with our Dev Containers and Docker and the editor's publisher as the server's address, so the licence
 * question is asked and an acceptance downloads the server from there, which the genuine job allows for these launches
 * only. Profile A accepts and installs into the run's `vscode` volume.
 */
const GENUINE_CONTAINERS_ACCEPT_A_LAUNCH: PlainLaunch = {
  ...GENUINE_CONTAINERS_LAUNCH,
  label: 'genuine-accept-a',
  suite: 'genuine-accept-a',
  publisherDownloads: true,
  settings: {
    ...GENUINE_CONTAINERS_LAUNCH.settings,
    'remote.serverDownloadBaseUrl': 'https://update.code.visualstudio.com',
  },
};

/** The same in a fresh profile (a launch has a user-data folder of its own), which meets profile A's volume. */
const GENUINE_CONTAINERS_ACCEPT_B_LAUNCH: PlainLaunch = {
  ...GENUINE_CONTAINERS_ACCEPT_A_LAUNCH,
  label: 'genuine-accept-b',
  suite: 'genuine-accept-b',
};

/**
 * The genuine client with Remote - SSH and the editor's publisher as the server's source: the licence question is asked
 * in a profile of its own, and Accept and Continue takes the server of the client's commit from the publisher, which
 * the genuine job allows for this launch alone. The template names the update service's Alpine server, since the
 * run's SSH host is Alpine.
 */
const GENUINE_LICENSED_LAUNCH: PlainLaunch = {
  ...GENUINE_LAUNCH,
  label: 'genuine-licensed',
  suite: 'genuine-licensed',
  publisherDownloads: true,
  settings: {
    ...GENUINE_LAUNCH.settings,
    'remote.SSH.serverDownloadUrlTemplate':
      'https://update.code.visualstudio.com/commit:${commit}/server-linux-alpine/${quality}',
  },
};

/** The genuine client with the proposed API not enabled: what a user of VS Code sees before the family's setup. */
const SSH_NO_PROPOSALS_LAUNCH: PlainLaunch = {
  ...GENUINE_LAUNCH,
  label: 'ssh-no-proposals',
  suite: 'ssh-no-proposals',
  proposedApi: false,
};

/**
 * The host setup of the secrets launch: both keyboard-interactive accounts get the run's password again, and
 * harness-expired's is marked expired again. `docker exec` sees the container's `HOST_PASSWORD`, which `start-sshd` only
 * unsets in its own shell.
 */
const SECRETS_ACCOUNTS_RESET =
  'printf "%s:%s\\n" harness-2fa "$HOST_PASSWORD" harness-expired "$HOST_PASSWORD" | chpasswd && chage -d 0 harness-expired';

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

/** A value with `replace` applied to each string in it, at any depth; every other value is kept. */
function withStrings<Value>(
  value: Value,
  replace: (text: string) => string,
): Value {
  if (typeof value === 'string') {
    return replace(value) as Value;
  }
  if (Array.isArray(value)) {
    return value.map(item => withStrings(item as unknown, replace)) as Value;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        withStrings(item as unknown, replace),
      ]),
    ) as Value;
  }
  return value;
}

/**
 * A value with the run's tokens put in: each string in it, at any depth, with the run's folder in place of `<run>` and
 * the run's `PATH` in place of `<path>`.
 */
export function withRunTokens<Value>(
  value: Value,
  runFolder: string,
  searchPath: string,
): Value {
  return withStrings(value, text =>
    text
      .replaceAll(RUN_FOLDER_TOKEN, runFolder)
      .replaceAll(RUN_PATH_TOKEN, searchPath),
  );
}

/** The harness variables a launch's settings may name, as `${<name>}`: the download host's bases and its certificate file. */
const HARNESS_BASE_NAMES: readonly string[] = [
  'HARNESS_DOWNLOADS_HTTP',
  'HARNESS_DOWNLOADS_HTTPS',
  'HARNESS_DOWNLOADS_LICENSED',
  'HARNESS_DOWNLOADS_LOCAL',
  'HARNESS_DOWNLOADS_CERTIFICATE',
];

/**
 * A value with the run's download bases put in: each string in it, at any depth, with `${<name>}` replaced by the
 * value of each name of `HARNESS_BASE_NAMES` that `bases` holds. Every other `${…}` stays as written, so the product's
 * own placeholders reach the product.
 */
export function withHarnessBases<Value>(
  value: Value,
  bases: Readonly<Record<string, string | undefined>>,
): Value {
  return withStrings(value, text =>
    HARNESS_BASE_NAMES.reduce((replaced, name) => {
      const base = bases[name];
      return base === undefined
        ? replaced
        : replaced.replaceAll(`\${${name}}`, base);
    }, text),
  );
}

/** One launch of the client search: the `remote.SSH.path` it sets, what it extra sets, the calls it must make, and, for a case that fails, its dialog and its answers. */
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
  /** The program the lookup and the connection run; null when no program was used for either. */
  used: string | null;
  /** The failure dialog's text, for a case that fails. */
  dialog?: string;
  /** The case's answers, as `FailureCase.script` holds them. */
  script?: unknown[];
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

/**
 * One case of a host-case suite: one launch per case, with its host setup, its settings and its script. The suite's
 * own rows read the rest of the case's fields from the same cases file.
 */
export interface HostCase {
  /** The name of the case; the launch is `<suite prefix>-<label>`. */
  label: string;
  /** The cite of the case's rows: the criterion of the case and its label, in parentheses. */
  cite: string;
  /** The authority the window opens, default `harness`. */
  authority?: string;
  /** Settings merged over the run's base settings for the case's launch. */
  settings: Record<string, unknown>;
  /** Text written after the last member of the settings file with no comma before it: a syntax error. */
  settingsTail?: string;
  /** The ports a non-product listener holds on the host before the connect. */
  holders?: number[];
  /** Keeps the previous launch's server, running, and its files on the host, so the case reuses them. */
  keepServer?: boolean;
  /** Keeps the previous launch's files on the host but stops its server. */
  keepFiles?: boolean;
  /** Further commands the host's `sh` runs, in order, after the suite's own setup. */
  setup?: string[];
  /** The script the case's window answers from; the suite's dialog script when absent. */
  script?: unknown[];
}

/** A suite of host cases: its folder, the prefix of its launches' labels, and what its setup removes. */
export interface HostCaseSuite {
  /** The folder under tests/acceptance; its `cases.json` lists the cases. */
  suite: string;
  /** The prefix of the launches' labels. */
  prefix: string;
  /** The variable that names the case to the window's rows. */
  caseVariable: string;
  /** The folders the setup removes before a case that keeps nothing. */
  removed: readonly string[];
}

/**
 * The two ways the template catalogue fails on the download host (tooling-57): an index that does not parse and an
 * address whose connection is dropped. Each is a launch of `containers-index`, whose index address is that path.
 */
const INDEX_CASES = [
  {label: 'broken', path: 'broken-index.json'},
  {label: 'down', path: 'unreachable'},
] as const;

/** The host-case suites, in the order the run makes their launches. */
export const HOST_CASE_SUITES: readonly HostCaseSuite[] = [
  {
    suite: 'suite-ports',
    prefix: 'ports',
    caseVariable: 'HARNESS_PORTS_CASE',
    removed: [],
  },
  {
    suite: 'suite-install',
    prefix: 'install',
    caseVariable: 'HARNESS_INSTALL_CASE',
    removed: [
      '/home/harness/.vscodium-server-insiders',
      '/tmp/srv',
      '/home/harness/inst',
    ],
  },
  {
    suite: 'suite-platform',
    prefix: 'platform',
    caseVariable: 'HARNESS_PLATFORM_CASE',
    removed: [],
  },
];

/** The cases of a host-case suite, in the order the run makes their launches, from its cases.json. */
export function hostCases(root: string, suite: string): HostCase[] {
  const {cases} = JSON.parse(
    readFileSync(
      path.join(root, 'tests', 'acceptance', suite, 'cases.json'),
      'utf8',
    ),
  ) as {cases: HostCase[]};
  const labels: string[] = [];
  for (const entry of cases) {
    // The label becomes part of file names, a test-cli label and an extension-host variable.
    if (!LABEL_FORM.test(entry.label)) {
      throw new Error(
        `a ${suite} case's label must match ${String(LABEL_FORM)}: "${entry.label}"`,
      );
    }
    if (labels.includes(entry.label)) {
      throw new Error(`two ${suite} cases share the label "${entry.label}"`);
    }
    labels.push(entry.label);
  }
  return cases;
}

/** The label of a host case's launch. */
export function hostCaseLabel(
  suite: HostCaseSuite,
  hostCase: HostCase,
): string {
  return `${suite.prefix}-${hostCase.label}`;
}

/**
 * The host setup of a host case, in the order the run runs it: free the held ports; stop the server unless the case
 * keeps it; remove the suite's folders unless the case keeps the server or its files; hold the case's ports, each
 * waited on as it starts; then the case's own commands. The brackets keep `pkill` from matching the `sh -c` that runs
 * it.
 */
export function hostSetupOf(
  hostCase: HostCase,
  suite: HostCaseSuite,
): HostSetupEntry[] {
  const entries: HostSetupEntry[] = [{command: "pkill -f 'n[c] -lk -p'; true"}];
  if (hostCase.keepServer !== true) {
    entries.push({
      command:
        "pkill -f '/home/harness/[.]vscodium-server-insiders/bin/'; " +
        'for i in $(seq 1 20); do ' +
        "pgrep -f '/home/harness/[.]vscodium-server-insiders/bin/' >/dev/null || exit 0; " +
        'sleep 0.5; done; exit 1',
    });
  }
  if (
    hostCase.keepServer !== true &&
    hostCase.keepFiles !== true &&
    suite.removed.length > 0
  ) {
    entries.push({command: `rm -rf ${suite.removed.join(' ')}`});
  }
  const holders = hostCase.holders ?? [];
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
  for (const command of hostCase.setup ?? []) {
    entries.push({command});
  }
  return entries;
}

/**
 * A launch of suite-forwarding: a window on `alias`, an alias of the harness account that forwards the agent or X11,
 * whose connect finds the server an earlier launch's session started, with the case named for the suite.
 */
function forwardingLaunch(
  label: string,
  alias: string,
  settings?: Readonly<Record<string, unknown>>,
): Launch {
  return {
    label,
    runner: 'runner-remote',
    suite: 'suite-forwarding',
    folderUri: `vscode-remote://ssh-remote+${alias}/home/harness`,
    environment: {HARNESS_FORWARDING_CASE: label},
    ...(settings === undefined ? {} : {settings}),
  };
}

/**
 * The launches of the VSCodium run: `local` runs suite-local in a plain window; `remote` runs suite-remote in a
 * window on `ssh-remote+harness`, where the runner is an extension of the workspace kind; `reconnect` runs
 * suite-reconnect in a second launch on the same folder, which finds the first launch's server (ruling 2); `agent`,
 * `agent-off` and `x11` run suite-forwarding on the aliases that forward the agent (the second with
 * `remote.SSH.enableAgentForwarding` false) and X11, on that same server; each failing connect runs suite-failure in a window on its alias, answered from its own script; `terminal` runs
 * suite-terminal with `remote.SSH.useLocalServer` off; `socket` runs suite-socket with
 * `remote.SSH.remoteServerListenOnSocket` on; `slow` runs suite-slow with an extension that takes 15 s to
 * activate in the remote extension host, which the harness copies to the host first; each `client-…` launch runs
 * suite-client with a `remote.SSH.path` of its own and fake clients on the run's `PATH`; `windows` starts the editor plainly, with no
 * runner and no folder, and drives its windows through the window agent from a Node run; `no-proposals` does the
 * same without enabling the proposed API; `explorer`, `explorer-alone`, `explorer-no-proposals` and
 * `explorer-standdown` do the same with Remote Explorer installed and a debugging port, the second with Remote -
 * SSH disabled, the third without the proposed API, and the fourth with a stand-in carrying the other Remote
 * Explorer extension's id; `trust` and `trust-terminal` do the same with workspace trust on and no extension of their own, the
 * first with core's startup trust prompt on, the second with core's defaults and `remote.SSH.useLocalServer` off;
 * `containers`, `containers-standdown`, `containers-no-proposals`, `containers-trust`, `containers-volume`,
 * `containers-explorer`, `containers-ports`, `containers-features`, `containers-shutdown`, `containers-view`, `containers-context` and the two `containers-index-…` launches do the same with Dev Containers installed, the second with a stand-in carrying the other Dev
 * Containers extension's id, the third without the proposed API, the fourth with workspace trust on and core's startup
 * prompt off, the fifth for the rows that clear the `vscode` volume's server folder and the sixth with the Remote
 * Explorer installed beside it, and the seventh for the rows that read core's Ports view, with the other Dev Containers
 * installed and disabled as in `containers`; `containers-killed-23`, `containers-killed-35` and
 * `containers-killed-43` run the same `containers-killed` suite, each naming its killed case in
 * `HARNESS_KILLED_CASE`, so that a launch runs one row and kills the launch's editor last;
 * `extensionpack` installs Dev Containers and Remote - SSH from their VSIX files and then the extension pack from its own,
 * with the editor's gallery variables pointed at a closed port, so that no gallery data is the state it starts from;
 * and each case of the host-case suites (suite-ports, then suite-install) runs after every other launch,
 * with its host setup and its own script.
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
    forwardingLaunch('agent', 'agentfwd'),
    forwardingLaunch('agent-off', 'agentfwd-off', {
      'remote.SSH.enableAgentForwarding': false,
    }),
    forwardingLaunch('x11', 'x11fwd'),
    ...failureCases(root).map((failure): Launch => ({
      label: failureLabel(failure.label ?? failure.alias),
      runner: 'runner-remote',
      suite: 'suite-failure',
      folderUri: `vscode-remote://ssh-remote+${failure.alias}/home/harness`,
      ...(failure.settings === undefined ? {} : {settings: failure.settings}),
      environment: {HARNESS_FAILURE_CASE: failure.label ?? failure.alias},
      ownScript: true,
      ...(failure.clientListeners === undefined
        ? {}
        : {clientListeners: failure.clientListeners}),
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
      label: 'socket',
      runner: 'runner-remote',
      suite: 'suite-socket',
      folderUri: REMOTE_FOLDER_URI,
      settings: {
        'remote.SSH.remoteServerListenOnSocket': true,
        'remote.SSH.remotePlatform': {harness: 'linux'},
      },
    },
    {
      label: 'slow',
      runner: 'runner-remote',
      suite: 'suite-slow',
      folderUri: REMOTE_FOLDER_URI,
      ownScript: true,
      hostExtensions: ['slow-remote'],
      // Without commands the entry still makes the run wait out the previous launch's helper, so the resolve is fresh.
      hostSetup: [],
    },
    {
      label: 'remote-ubuntu',
      runner: 'runner-remote',
      suite: 'suite-remote',
      folderUri: REMOTE_FOLDER_URI,
      hostBase: 'ubuntu-26.04',
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
    {
      label: 'windows',
      kind: 'plain',
      suite: 'windows',
      environment: {REMOTE_OSS_SENTINEL: 'sent1nel-<run>'},
    },
    // Terminal mode with the login terminal shown and the extension's own prompts (no script), read through the renderer.
    {
      ...RENDERER_LAUNCH,
      label: 'terminal-login',
      suite: 'terminal-login',
      settings: {
        ...RENDERER_LAUNCH.settings,
        'remote.SSH.useLocalServer': false,
        'remote.SSH.showLoginTerminal': true,
        'remote.SSH.remotePlatform': {password: 'linux'},
        'window.dialogStyle': 'custom',
        // Core hides the tab list of a single terminal; the rows read what the panel lists.
        'terminal.integrated.tabs.hideCondition': 'never',
      },
      environment: {REMOTE_OSS_ACCEPTANCE_SCRIPT: ''},
    },
    {label: 'login-shells', kind: 'plain', suite: 'login-shells'},
    {
      label: 'preconnect',
      kind: 'plain',
      suite: 'preconnect',
      // A variable of the editor's environment, which the script of a row reports it received.
      environment: {REMOTE_OSS_F2108_VARIABLE: 'f2108-<run>'},
    },
    {
      label: 'config-files',
      kind: 'plain',
      suite: 'config-files',
      environment: {
        HOME: '<run>/home',
        PATH: '<run>/ssh-bin:<path>',
        SSH_AUTH_SOCK: '',
        XDG_CACHE_HOME: '<run>/xdg/cache',
        XDG_CONFIG_HOME: '<run>/xdg/config',
        XDG_DATA_HOME: '<run>/xdg/data',
        XDG_STATE_HOME: '<run>/xdg/state',
      },
    },
    {
      // Keyboard-interactive logins on the Ubuntu 26.04 host's two PAM accounts, then a search for what was typed.
      label: 'secrets',
      kind: 'plain',
      suite: 'secrets',
      hostBase: 'ubuntu-26.04',
      environment: {HOME: '<run>/home-secrets'},
      // Each attempt starts from the same accounts: a forced change gives harness-expired a new password.
      hostSetup: [{command: SECRETS_ACCOUNTS_RESET}],
    },
    {
      ...RENDERER_LAUNCH,
      label: 'default-ports',
      suite: 'default-ports',
      settings: {
        ...RENDERER_LAUNCH.settings,
        'remote.SSH.defaultForwardedPorts': [
          {name: 'web', remotePort: 8632, localPort: 18632},
        ],
      },
    },
    // The core features of the editor in a window on the SSH host, read through the renderer.
    {...RENDERER_LAUNCH, label: 'ssh-core', suite: 'ssh-core'},
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
      label: 'explorer-trust',
      suite: 'explorer-trust',
      workspaceTrust: true,
    },
    {
      ...EXPLORER_LAUNCH,
      label: 'explorer-home',
      suite: 'explorer-home',
      environment: {HOME: '<run>/home'},
    },
    {
      ...EXPLORER_LAUNCH,
      label: 'explorer-rows',
      suite: 'explorer-rows',
    },
    {
      ...EXPLORER_LAUNCH,
      label: 'explorer-no-proposals',
      suite: 'explorer-no-proposals',
      proposedApi: false,
    },
    {
      ...EXPLORER_LAUNCH,
      label: 'explorer-standdown',
      suite: 'explorer-standdown',
      standIns: ['ms-vscode.remote-explorer'],
    },
    {
      ...TRUST_LAUNCH,
      label: 'trust',
      suite: 'trust',
      settings: {
        ...TRUST_LAUNCH.settings,
        // Core's default is never; the rows answer core's startup prompt, so this launch turns it on.
        'security.workspace.trust.startupPrompt': 'once',
      },
    },
    {
      ...TRUST_LAUNCH,
      label: 'trust-terminal',
      suite: 'trust-terminal',
      settings: {
        ...TRUST_LAUNCH.settings,
        'remote.SSH.useLocalServer': false,
        'remote.SSH.remotePlatform': {harness: 'linux'},
      },
    },
    {
      ...RENDERER_LAUNCH,
      label: 'web-ui',
      suite: 'web-ui',
      // A recording xdg-open that the suite writes into the run's folder comes first on the editor's PATH, so that
      // opening the web UI opens nothing on the machine.
      environment: {PATH: `${RUN_FOLDER_TOKEN}/browser-bin:${RUN_PATH_TOKEN}`},
    },
    {
      ...TRUST_LAUNCH,
      label: 'web-ui-trust',
      suite: 'web-ui-trust',
      // The same browser, in a launch with workspace trust on and core's startup prompt off, so that a window opens in
      // Restricted Mode and silent.
      // A terminal-mode connect in this launch waits on core's trust question before its login terminal starts, so its
      // rows connect only through the local server.
      settings: {
        ...TRUST_LAUNCH.settings,
        'security.workspace.trust.startupPrompt': 'never',
      },
      environment: {PATH: `${RUN_FOLDER_TOKEN}/browser-bin:${RUN_PATH_TOKEN}`},
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers',
      suite: 'containers',
      registry: true,
      templates: true,
      // A recording xdg-open first on the editor's PATH, so that a row can tell whether a link was opened.
      environment: {PATH: `${RUN_FOLDER_TOKEN}/browser-bin:${RUN_PATH_TOKEN}`},
      // The other Dev Containers, installed and disabled: the package works beside it and warns of nothing.
      standIns: ['ms-vscode-remote.remote-containers'],
      disabledExtensions: ['ms-vscode-remote.remote-containers'],
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-standdown',
      suite: 'containers-standdown',
      standIns: ['ms-vscode-remote.remote-containers'],
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-no-proposals',
      suite: 'containers-no-proposals',
      proposedApi: false,
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-trust',
      suite: 'containers-trust',
      workspaceTrust: true,
      // The run's registry and templates, as in `containers`: the wizard's rows run in an untrusted folder too.
      registry: true,
      templates: true,
      settings: {
        ...CONTAINERS_LAUNCH.settings,
        // A folder opens untrusted and silent, so the only trust dialog is the one Reopen asks for.
        'security.workspace.trust.startupPrompt': 'never',
      },
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-volume',
      suite: 'containers-volume',
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-explorer',
      suite: 'containers-explorer',
      withExtensions: [
        'remote-oss.remote-containers',
        'remote-oss.remote-explorer',
      ],
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-ports',
      suite: 'containers-ports',
      registry: true,
      // A recording xdg-open the rows write into the run's folder comes first on the editor's PATH, so that opening a
      // port in the browser opens nothing on the machine.
      environment: {PATH: '<run>/xdg-bin:<path>'},
      // The other Dev Containers, installed and disabled, as in `containers`: the Ports view's rows are core's.
      standIns: ['ms-vscode-remote.remote-containers'],
      disabledExtensions: ['ms-vscode-remote.remote-containers'],
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-features',
      suite: 'containers-features',
      registry: true,
      templates: true,
      // A recording xdg-open the rows write into the run's folder comes first on the editor's PATH, so that Learn More
      // opens nothing on the machine and its address can be read.
      // The CLI there fetches a Feature's tarball over HTTPS from the run's download host, whose certificate it trusts
      // by this variable and by nothing else.
      environment: {
        PATH: `${RUN_FOLDER_TOKEN}/browser-bin:${RUN_PATH_TOKEN}`,
        NODE_EXTRA_CA_CERTS: '${HARNESS_DOWNLOADS_CERTIFICATE}',
      },
      // The other Dev Containers, installed and disabled, as in `containers`.
      standIns: ['ms-vscode-remote.remote-containers'],
      disabledExtensions: ['ms-vscode-remote.remote-containers'],
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-shutdown',
      suite: 'containers-shutdown',
      // The other Dev Containers, installed and disabled, as in `containers`.
      standIns: ['ms-vscode-remote.remote-containers'],
      disabledExtensions: ['ms-vscode-remote.remote-containers'],
    },
    ...INDEX_CASES.map((indexCase): Launch => ({
      ...CONTAINERS_LAUNCH,
      label: `containers-index-${indexCase.label}`,
      suite: 'containers-index',
      templates: true,
      environment: {
        REMOTE_OSS_TEMPLATE_INDEX: `\${HARNESS_DOWNLOADS_LOCAL}/templates/${indexCase.path}`,
        HARNESS_INDEX_CASE: indexCase.label,
      },
    })),
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-killed-23',
      suite: 'containers-killed',
      environment: {HARNESS_KILLED_CASE: '23'},
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-killed-35',
      suite: 'containers-killed',
      environment: {HARNESS_KILLED_CASE: '35'},
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-killed-43',
      suite: 'containers-killed',
      environment: {HARNESS_KILLED_CASE: '43'},
    },
    // Named only: it needs Podman 5 on the machine, and the run refuses without it.
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-podman',
      suite: 'containers-podman',
      engine: 'podman',
      namedOnly: true,
    },
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-context',
      suite: 'containers-context',
      // A Docker configuration of its own, so that a row can create, use and delete a context without touching the machine's.
      environment: {DOCKER_CONFIG: `${RUN_FOLDER_TOKEN}/docker-config`},
    },
    // The pack from its VSIX beside its two members, installed in that order, with no gallery to reach.
    {
      ...RENDERER_LAUNCH,
      label: 'extensionpack',
      suite: 'extensionpack',
      withExtensions: [
        'remote-oss.remote-containers',
        'remote-oss.remote-ssh',
        'remote-oss.vscode-remote-extensionpack',
      ],
      environment: UNREACHABLE_GALLERY,
    },
    // The same, in German, with no language pack: the display language the pack's strings are read for.
    {
      ...RENDERER_LAUNCH,
      label: 'extensionpack-german',
      suite: 'extensionpack-german',
      withExtensions: [
        'remote-oss.remote-containers',
        'remote-oss.remote-ssh',
        'remote-oss.vscode-remote-extensionpack',
      ],
      environment: UNREACHABLE_GALLERY,
      locale: 'de',
    },
    // The pack and Remote - SSH without Dev Containers: a member of the pack that is not installed, with no gallery to fetch it from.
    {
      ...RENDERER_LAUNCH,
      label: 'extensionpack-partial',
      suite: 'extensionpack-partial',
      withExtensions: ['remote-oss.vscode-remote-extensionpack'],
      environment: UNREACHABLE_GALLERY,
    },
    // The same with a fixture language pack active: the display language the pack's strings are read for.
    ...['de', 'hu'].map((language): PlainLaunch => ({
      ...RENDERER_LAUNCH,
      label: `extensionpack-lp-${language}`,
      suite: 'extensionpack-language',
      withExtensions: [
        'remote-oss.remote-containers',
        'remote-oss.remote-ssh',
        'remote-oss.vscode-remote-extensionpack',
      ],
      environment: UNREACHABLE_GALLERY,
      locale: language,
      languagePack: language,
    })),
    ...HOST_CASE_SUITES.flatMap(suite =>
      hostCases(root, suite.suite).map((hostCase): Launch => ({
        label: hostCaseLabel(suite, hostCase),
        runner: 'runner-remote',
        suite: suite.suite,
        folderUri: `vscode-remote://ssh-remote+${
          hostCase.authority ?? 'harness'
        }/home/harness`,
        settings: hostCase.settings,
        ...(hostCase.settingsTail === undefined
          ? {}
          : {settingsTail: hostCase.settingsTail}),
        environment: {[suite.caseVariable]: hostCase.label},
        ownScript: true,
        hostSetup: hostSetupOf(hostCase, suite),
      })),
    ),
    GENUINE_LAUNCH,
    GENUINE_LICENSED_LAUNCH,
    SSH_NO_PROPOSALS_LAUNCH,
    GENUINE_CONTAINERS_LAUNCH,
    GENUINE_CONTAINERS_ACCEPT_A_LAUNCH,
    GENUINE_CONTAINERS_ACCEPT_B_LAUNCH,
    // Last: its rows remove every container of the run, the run's host and registry included.
    {
      ...CONTAINERS_LAUNCH,
      label: 'containers-view',
      suite: 'containers-view',
      registry: true,
    },
  ];
  return launches;
}

/** The launch with the label `label`; it fails naming the label when there is none. */
export function launchLabelled(
  launches: readonly Launch[],
  label: string,
): Launch {
  const found = launches.find(launch => launch.label === label);
  if (found === undefined) {
    throw new Error(`no launch is labelled ${label}`);
  }
  return found;
}

/** The groups a run can name with `@<group>`, in the order a selection line lists them. */
export const LAUNCH_GROUPS = [
  'ssh',
  'hosts',
  'explorer',
  'containers',
  'genuine',
] as const;

/** One of the groups of launches. */
export type LaunchGroup = (typeof LAUNCH_GROUPS)[number];

/**
 * The one group of `launch`, from the table alone: `genuine` for the genuine client, `containers` for a launch that
 * installs Dev Containers, `explorer` for one that installs Remote Explorer and not Dev Containers, `hosts` for the
 * host-case launches, `ssh` for every other.
 */
export function launchGroupOf(launch: Launch): LaunchGroup {
  if (launch.kind === 'plain') {
    const extensions = launch.withExtensions ?? [];
    if (launch.client === 'vscode') {
      return 'genuine';
    }
    if (extensions.includes('remote-oss.remote-containers')) {
      return 'containers';
    }
    return extensions.includes('remote-oss.remote-explorer')
      ? 'explorer'
      : 'ssh';
  }
  return HOST_CASE_SUITES.some(suite => suite.suite === launch.suite)
    ? 'hosts'
    : 'ssh';
}

/** The user settings a launch gets: its own, and the engine's `dev.containers.dockerPath` when it names one. */
export function settingsOfLaunch(
  launch: Launch,
): Readonly<Record<string, unknown>> | undefined {
  return launch.engine === undefined
    ? launch.settings
    : {...launch.settings, 'dev.containers.dockerPath': launch.engine};
}

/** Whether a launch installs Dev Containers, whose rows need the run's dev container image; a launch that publishes its templates builds it too, because the run's `mini` template names it. */
export function needsDevContainerImage(launch: Launch): boolean {
  return (
    launch.kind === 'plain' &&
    ((launch.withExtensions ?? []).includes('remote-oss.remote-containers') ||
      launch.templates === true)
  );
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
