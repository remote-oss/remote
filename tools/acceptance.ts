/**
 * @fileoverview acceptance: runs the acceptance tests in the editor under test against an SSH host in a container.
 *
 *     node tools/acceptance.ts
 *
 * It builds the host image of tests/acceptance/host, makes a key pair for this run, starts the host with the public
 * key, writes an ssh_config whose `Host harness` reaches it, bundles the tests of tests/acceptance/suite, and starts
 * `@vscode/test-cli` with tests/acceptance/vscode-test.mjs. The editor gets a fresh user-data and extensions folder,
 * the packaged VSIX files of the extensions under test, and the harness variables. The container and the run's
 * folder are removed at the end, whatever the outcome. Run `pnpm package` first; `pnpm test:acceptance` does both.
 */

import {holdClientPorts, type PortHolder} from './acceptance-occupy.ts';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import {build} from 'esbuild';
import {
  downloadHostArguments,
  type RunDownloads,
  startRunDownloads,
} from './acceptance-downloads.ts';
import {
  acceptanceRunId,
  buildDevContainerImage,
  connectRunNetwork,
  startHostContainer,
  sweepStaleDevContainers,
} from './acceptance-run.ts';
import {checked, type CommandRunner, runCommand} from './command-runner.ts';
import {
  agentSocketPath,
  controlFolderOf,
  CERTIFIED_PRINCIPAL,
  makeRunKeys,
  startRunAgent,
} from './acceptance-keys.ts';
import {
  clearCalls,
  rewriteClient,
  writeClients,
  writeSshRecorder,
  writeTildeCopy,
} from './acceptance-clients.ts';
import {
  bundleFolderOf,
  extensionsOf,
  clientCases,
  failureCases,
  hostExtensionFolder,
  failureLabel,
  LAUNCH_EXTENSIONS,
  type HostSetupEntry,
  type Launch,
  type RunnerLaunch,
  launchesOf,
  needsDevContainerImage,
  HOST_CASE_SUITES,
  hostCaseLabel,
  hostCases,
  runnerLaunches,
  suitesOf,
  withHarnessBases,
  withRunTokens,
} from './acceptance-launches.ts';
import {
  editorArguments,
  extensionsFolderOf,
  launchFiles,
  packageWindowAgent,
  runPlainLaunch,
  startDetached,
  type Started,
  writeStandIns,
} from './acceptance-plain.ts';
import {
  isMainModule,
  REPOSITORY_ROOT,
  resolveBinary,
  sortedEntries,
} from './repository.ts';

/** The port mapping and the real runner, re-exported for the tests. */
export {mappedPort} from './acceptance-run.ts';
export {runCommand} from './command-runner.ts';
export type {CommandResult} from './command-runner.ts';

/** The editor version the tests run on: the floor of ADR-0007. */
const EDITOR_VERSION = '1.139.1';

/**
 * How long the run waits before a launch whose resolve must find no live helper: the extension's helper outlives
 * its last window by HELPER_GRACE_MILLISECONDS (packages/remote-ssh/src/pipeline/bounds.ts), so the run waits the
 * grace out instead of reaching into the run's helpers. A row in acceptance.test.ts keeps this equal to the
 * extension's constant.
 */
export const FRESH_RESOLVE_WAIT_MILLISECONDS = 3000;

/**
 * The script every ports launch answers from: dismiss the connect's dialog and its pick of actions. A connected
 * case never asks them.
 */
const DIALOG_SCRIPT = [
  {surface: 'failureDialog', match: '"', answer: 'dismiss'},
  {surface: 'mitigationPick', match: 'Pick an action', answer: 'dismiss'},
];

/** The editor a run uses: VS Code at the floor of ADR-0007, or the pinned VSCodium Insiders. */
export type EditorChoice = 'vscode' | 'vscodium';

/** The VSCodium build the VSCodium run uses: an exact tag, never "latest". */
export const VSCODIUM_RELEASE = {
  tagName: '1.140.06829-insider',
  repository: 'VSCodium/vscodium-insiders',
  /** The release asset's sha256, by `<os>-<arch>` of the client. */
  sha256: {
    'linux-x64':
      '7d8779cb07f5dd66810a94a45855d0ffbe5c286ffddbb88f8ecdca6b63a6813f',
    'linux-arm64':
      'e0ad855b10ec0928f8f832bbf9d12536918b6ecb8cec4600431654ff27a72c37',
  },
} as const;

/** The packages whose VSIX files are installed into the editor under test, by their extension id. */
const EXTENSIONS_UNDER_TEST = new Map([
  ['remote-oss.remote-ssh', 'remote-ssh'],
  ['remote-oss.remote-ssh-edit', 'remote-ssh-edit'],
]);

/**
 * The variables the harness passes to the extension host. `REMOTE_OSS_ACCEPTANCE` is the one switch with which a
 * package installs its harness adapters (dialogs answered from a script, the log readable by the tests); a user's
 * editor never sets it.
 */
export interface HarnessVariables {
  REMOTE_OSS_ACCEPTANCE: '1';
  /** The ssh_config whose `Host harness` reaches the container. */
  HARNESS_SSH_CONFIG: string;
  /** The container id, for `docker exec` checks on the host. */
  HARNESS_CONTAINER: string;
  /** The host's address on the run network, which the `routed` alias names; a route cut is scoped to it. */
  HARNESS_ROUTED_ADDRESS: string;
  /** The run's folder: user data, extensions, keys. */
  HARNESS_RUN_FOLDER: string;
  /** The run's id, which every Docker object of the run carries in its run label. */
  HARNESS_RUN_ID: string;
  /** The run's dev container image tag, when a launch of the run installs Dev Containers; VSCodium run only. */
  HARNESS_DEVCONTAINER_IMAGE?: string;
  /** The file with the bare password of the host's user `harness-pw`, mode 600: a test puts it in a script entry. */
  HARNESS_PASSWORD_FILE: string;
  /** The VSIX files to install, separated by the path delimiter; empty when none is packaged yet. */
  HARNESS_VSIX_FILES: string;
  /** The file the scripted adapters read their script from, in the run's folder. */
  REMOTE_OSS_ACCEPTANCE_SCRIPT: string;
  /** The file the scripted adapters append their record to, in the run's folder. */
  REMOTE_OSS_ACCEPTANCE_RECORD: string;
  /** The folder the signal files of held entries live in, one per run: the harness's `signal` creates a file in it. */
  REMOTE_OSS_ACCEPTANCE_SIGNALS: string;
  /** The editor of the run. */
  HARNESS_EDITOR: EditorChoice;
  /** The file the log channel's lines are appended to, in the run's folder. */
  REMOTE_OSS_ACCEPTANCE_LOG: string;
  /** The VSCodium executable, in the VSCodium run only. */
  HARNESS_VSCODIUM_EXECUTABLE?: string;
  /** The download host's bases and request log (`tools/acceptance-downloads.ts`), in the VSCodium run only. */
  HARNESS_DOWNLOADS_HTTP?: string;
  HARNESS_DOWNLOADS_HTTPS?: string;
  HARNESS_DOWNLOADS_LICENSED?: string;
  HARNESS_DOWNLOADS_LOCAL?: string;
  HARNESS_DOWNLOADS_LOG?: string;
  /** The run's own ssh-agent, named for every launch's processes, and its socket for the tests; VSCodium run only. */
  SSH_AUTH_SOCK?: string;
  HARNESS_AGENT_SOCKET?: string;
  /** The file with the bare passphrase of the run's passphrase key, mode 600; VSCodium run only. */
  HARNESS_PASSPHRASE_FILE?: string;
}

/** Waits the given number of milliseconds. */
export type Sleeper = (milliseconds: number) => Promise<void>;

/** The steps of a run that touch more than the run's folder: what a test replaces. */
export interface HarnessDependencies {
  command: CommandRunner;
  sleep: Sleeper;
  bundleSuite: (root: string) => Promise<void>;
  /** The command line of the editor's CLI at the version under test, downloading the editor when it is missing. */
  editorCli: () => Promise<string>;
  /** The VSCodium executable at the pinned release, downloading and unpacking it when it is missing. */
  vscodiumExecutable: () => Promise<string>;
  /**
   * Starts test-cli with the harness variables and returns its exit code and its output; `label` picks one of the
   * configurations, and none runs the only one.
   */
  runTests: (
    root: string,
    variables: HarnessVariables,
    label?: string,
  ) => Promise<AttemptResult>;
  /** Packages the window agent into a VSIX in the run's folder and returns the file. */
  windowAgentVsix: (root: string, runFolder: string) => Promise<string>;
  /** Runs a launch with no runner: the editor started plainly, and the Node tests against it. */
  runPlain: (
    root: string,
    variables: HarnessVariables,
    launch: Launch,
  ) => Promise<AttemptResult>;
  /** Starts the run's download host in the run's folder; the VSCodium run only. */
  startDownloads: (root: string, runFolder: string) => Promise<RunDownloads>;
  /** Starts the run's own ssh-agent on `socket`, with no askpass of its own; the VSCodium run only. */
  startAgent: (socket: string) => Started;
}

/** How long the run waits for sshd to accept the first connection, in attempts half a second apart. */
const READY_ATTEMPTS = 40;

const READY_INTERVAL = 500;

/** The password account behind an OpenSSH ControlMaster of the given mode, its socket `socket` in `controlFolder`. */
function masterAlias(
  name: string,
  mode: string,
  socket: string,
  port: number,
  runFolder: string,
  controlFolder: string,
): string[] {
  return accountAlias(name, 'harness-pw', port, runFolder, [
    ...PASSWORD_LINES,
    `ControlMaster ${mode}`,
    `ControlPath ${path.join(controlFolder, socket)}`,
    'ControlPersist 600',
  ]);
}

/**
 * The ssh_config of the run: `Host harness` with the run's key, its own known-hosts file and no agent; three
 * aliases that fail for the failure rows: `refused` (a closed port), `nowhere` (a name that never resolves, RFC 6761)
 * and `stranger` (the harness host with an empty known-hosts file, so its key is unknown); `routed` (the harness
 * account at the host's own address on the run network, which a route cut makes unreachable or silent); and the aliases of the
 * host's other accounts: `password` (login by password only), `password-ask` (the same account whose host key is
 * asked, against its own known-hosts file a test deletes to make the key unknown again), `noforward` (TCP
 * forwarding refused), `mute` (a login shell that does not answer), `readonly` (a server data folder that exists
 * and cannot be written) and `master` and `master-ask` (the password account behind a ControlMaster); and `agentfwd`,
 * `agentfwd-off` and `x11fwd`, the harness account forwarding the run's agent at `agentSocket` and X11; three for the
 * authority rows: `badkey` (a key the host does not accept), `blackhole` (an address that is never routed) and
 * `127.0.0.2` (the loopback name that reaches the host with a refused key, the port coming from the authority). The
 * sockets of the ControlMaster aliases are in `controlFolder`.
 */
export function harnessSshConfig(
  port: number,
  runFolder: string,
  agentSocket: string,
  routedAddress: string,
  controlFolder = runFolder,
): string {
  return [
    'Host harness',
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    '  User harness',
    `  IdentityFile ${path.join(runFolder, 'id_ed25519')}`,
    '  IdentitiesOnly yes',
    '  IdentityAgent none',
    '  StrictHostKeyChecking accept-new',
    '  BatchMode yes',
    '  ConnectTimeout 10',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts')}`,
    '',
    'Host 127.0.0.1',
    `  Port ${String(port)}`,
    '  User harness',
    `  IdentityFile ${path.join(runFolder, 'id_ed25519')}`,
    '  IdentitiesOnly yes',
    '  IdentityAgent none',
    '  StrictHostKeyChecking accept-new',
    '  BatchMode yes',
    '  ConnectTimeout 10',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts')}`,
    '',
    'Host refused',
    '  HostName 127.0.0.1',
    '  Port 9',
    '  BatchMode yes',
    '',
    'Host nowhere',
    '  HostName nowhere.invalid',
    '  BatchMode yes',
    '',
    'Host stranger',
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    '  User harness',
    `  IdentityFile ${path.join(runFolder, 'id_ed25519')}`,
    '  IdentitiesOnly yes',
    '  IdentityAgent none',
    '  StrictHostKeyChecking ask',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts_stranger')}`,
    '',
    'Host routed',
    `  HostName ${routedAddress}`,
    '  Port 22',
    '  User harness',
    `  IdentityFile ${path.join(runFolder, 'id_ed25519')}`,
    '  IdentitiesOnly yes',
    '  IdentityAgent none',
    '  StrictHostKeyChecking accept-new',
    '  BatchMode yes',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts_routed')}`,
    '',
    ...accountAlias('password', 'harness-pw', port, runFolder, PASSWORD_LINES),
    'Host password-ask',
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    '  User harness-pw',
    '  IdentityAgent none',
    '  StrictHostKeyChecking ask',
    '  ConnectTimeout 10',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts_password_ask')}`,
    ...PASSWORD_LINES.map(line => `  ${line}`),
    '',
    ...accountAlias(
      'noforward',
      'harness-nofwd',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'mute',
      'harness-mute',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'i686',
      'harness-i686',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'readonly',
      'harness-ro',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...masterAlias('master', 'auto', 'cm-%C', port, runFolder, controlFolder),
    ...masterAlias(
      'master-ask',
      'ask',
      'cm-ask-%C',
      port,
      runFolder,
      controlFolder,
    ),
    ...masterAlias(
      'master-yes',
      'yes',
      'cm-yes-%C',
      port,
      runFolder,
      controlFolder,
    ),
    ...masterAlias(
      'master-autoask',
      'autoask',
      'cm-autoask-%C',
      port,
      runFolder,
      controlFolder,
    ),
    ...keyAlias('passkey', 'harness', port, runFolder, ['id_passphrase']),
    ...keyAlias('passkey-then-second', 'harness', port, runFolder, [
      'id_passphrase',
      'id_second',
    ]),
    ...keyAlias('loosekey', 'harness', port, runFolder, ['id_loose']),
    ...keyAlias('certonly', CERTIFIED_PRINCIPAL, port, runFolder, [
      'id_certified',
    ]),
    ...keyAlias('certonly-nocert', CERTIFIED_PRINCIPAL, port, runFolder, [
      'id_second',
    ]),
    // Two aliases, so the window with the setting off finds no connection, and no stored plan, of the other.
    ...['agentfwd', 'agentfwd-off'].flatMap(alias =>
      accountAlias(
        alias,
        'harness',
        port,
        runFolder,
        [...keyLines(runFolder), `ForwardAgent ${agentSocket}`],
        agentSocket,
      ),
    ),
    ...accountAlias('x11fwd', 'harness', port, runFolder, [
      ...keyLines(runFolder),
      'ForwardX11 yes',
      'ForwardX11Trusted yes',
    ]),
    'Host badkey',
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    '  User harness',
    `  IdentityFile ${path.join(runFolder, 'id_unauthorised')}`,
    '  IdentitiesOnly yes',
    '  BatchMode yes',
    '  StrictHostKeyChecking accept-new',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts')}`,
    '',
    'Host blackhole',
    '  HostName 192.0.2.1',
    '  BatchMode yes',
    '',
    'Host 127.0.0.2',
    '  HostName 127.0.0.1',
    '  BatchMode yes',
    '  IdentitiesOnly yes',
    `  IdentityFile ${path.join(runFolder, 'id_unauthorised')}`,
    '  StrictHostKeyChecking accept-new',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts')}`,
    '',
  ].join('\n');
}

/**
 * One alias of the run's further keys: the named key files of the run's folder, offered alone, with the run's agent
 * left to the environment and no `BatchMode`, so that ssh may ask for a passphrase. `certonly`'s key brings its
 * `-cert.pub` beside it, which ssh offers by itself.
 */
function keyAlias(
  alias: string,
  user: string,
  port: number,
  runFolder: string,
  keyFiles: readonly string[],
): string[] {
  return [
    `Host ${alias}`,
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    `  User ${user}`,
    ...keyFiles.map(file => `  IdentityFile ${path.join(runFolder, file)}`),
    '  IdentitiesOnly yes',
    '  StrictHostKeyChecking accept-new',
    '  ConnectTimeout 10',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts')}`,
    '',
  ];
}

/** The lines of an alias that logs in with the account's password; `BatchMode` would refuse the prompt. */
const PASSWORD_LINES = [
  'PubkeyAuthentication no',
  'PreferredAuthentications password,keyboard-interactive',
  'NumberOfPasswordPrompts 1',
];

/** The lines of an alias that logs in with the run's key and never prompts. */
function keyLines(runFolder: string): string[] {
  return [
    `IdentityFile ${path.join(runFolder, 'id_ed25519')}`,
    'IdentitiesOnly yes',
    'BatchMode yes',
  ];
}

/**
 * One alias of the host's other accounts: the lines every one shares, its own known-hosts file, then `further`. Its
 * agent is `identityAgent`, none by default; ssh forwards no agent from an alias whose `IdentityAgent` is none.
 */
function accountAlias(
  alias: string,
  user: string,
  port: number,
  runFolder: string,
  further: readonly string[],
  identityAgent = 'none',
): string[] {
  return [
    `Host ${alias}`,
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    `  User ${user}`,
    `  IdentityAgent ${identityAgent}`,
    '  StrictHostKeyChecking accept-new',
    '  ConnectTimeout 10',
    `  UserKnownHostsFile ${path.join(runFolder, `known_hosts_${alias}`)}`,
    ...further.map(line => `  ${line}`),
    '',
  ];
}

/**
 * The packaged VSIX files that exist under `<root>/dist` of the named packages: by default, the extensions under test.
 */
export function packagedExtensions(
  root: string,
  packages: Iterable<string> = EXTENSIONS_UNDER_TEST.values(),
): string[] {
  const folder = path.join(root, 'dist');
  if (!existsSync(folder)) {
    return [];
  }
  const packageNames = new Set(packages);
  return sortedEntries(folder)
    .filter(entry => {
      const packageName = /^(.+)-\d+\.\d+\.\d+\.vsix$/.exec(entry.name)?.[1];
      return packageName !== undefined && packageNames.has(packageName);
    })
    .map(entry => path.join(folder, entry.name));
}

/**
 * The editor's user settings of the run: the extensions under test read the harness's ssh_config, and `extra` is a
 * launch's own settings. With `label`, the same bytes go to `<run folder>/<label>-settings.json`, so a row compares
 * the file the editor read with the one its launch got. A `tail` is text put after the last member with no comma
 * before it: a syntax error, after members the editor still reads.
 */
export function writeUserSettings(
  runFolder: string,
  configFile: string,
  extra: Readonly<Record<string, unknown>> = {},
  label?: string,
  tail?: string,
): void {
  const written = JSON.stringify(
    {'remote.SSH.configFile': configFile, ...extra},
    null,
    2,
  );
  const bytes =
    tail === undefined
      ? `${written}\n`
      : `${written.slice(0, -2)}\n  ${tail}\n}\n`;
  const folder = path.join(runFolder, 'user-data', 'User');
  mkdirSync(folder, {recursive: true});
  writeFileSync(path.join(folder, 'settings.json'), bytes);
  if (label !== undefined) {
    writeFileSync(path.join(runFolder, `${label}-settings.json`), bytes);
  }
}

async function waitForHost(
  dependencies: HarnessDependencies,
  configFile: string,
): Promise<void> {
  for (let attempt = 1; attempt <= READY_ATTEMPTS; attempt++) {
    const result = dependencies.command('ssh', [
      '-F',
      configFile,
      'harness',
      'true',
    ]);
    if (result.status === 0) {
      return;
    }
    if (attempt === READY_ATTEMPTS) {
      throw new Error(`the host did not accept SSH: ${result.stderr.trim()}`);
    }
    await dependencies.sleep(READY_INTERVAL);
  }
}

/**
 * Prepares the host and the run's folder and returns the harness variables. The caller removes the container and
 * the folder through `tearDown`, also when this throws after the container started.
 */
/**
 * The installs of a run: the run's VSIX files into the run's extensions folder, and for each launch with extensions of
 * its own, the same files and the packaged VSIX of each of its own extensions into the launch's folder.
 */
export function installsOf(
  root: string,
  runFolder: string,
  vsixFiles: readonly string[],
  launches: readonly Launch[],
): Array<{folder: string; files: string[]}> {
  return [
    {folder: extensionsFolderOf(runFolder), files: [...vsixFiles]},
    ...launches.flatMap(launch =>
      launch.kind === 'plain' && launch.withExtensions !== undefined
        ? [
            {
              folder: extensionsFolderOf(runFolder, launch),
              files: [
                ...vsixFiles,
                ...packagedExtensions(
                  root,
                  launch.withExtensions.flatMap(
                    extensionId => LAUNCH_EXTENSIONS.get(extensionId) ?? [],
                  ),
                ),
              ],
            },
          ]
        : [],
    ),
  ];
}

async function prepare(
  root: string,
  dependencies: HarnessDependencies,
  runFolder: string,
  started: string[],
  editor: EditorChoice,
  stops: Array<() => Promise<void>>,
): Promise<HarnessVariables> {
  const {command} = dependencies;
  const runId = acceptanceRunId(process.env, process.pid);
  const downloads =
    editor === 'vscodium'
      ? await dependencies.startDownloads(root, runFolder)
      : undefined;
  if (downloads !== undefined) {
    stops.push(() => downloads.stop());
  }
  const keys =
    editor === 'vscodium' ? makeRunKeys(command, runFolder) : undefined;
  const agentSocket = agentSocketPath(runFolder);
  if (editor === 'vscodium') {
    const agent = dependencies.startAgent(agentSocket);
    stops.push(() => agent.stop());
  }
  const host = startHostContainer(command, root, runId, runFolder, [
    ...(downloads === undefined ? [] : downloadHostArguments()),
    ...(keys?.hostArguments ?? []),
  ]);
  started.push(host.container);
  const port = host.port;
  const routedAddress = connectRunNetwork(command, runId, host.container);
  const configFile = path.join(runFolder, 'ssh_config');
  writeFileSync(
    configFile,
    harnessSshConfig(
      port,
      runFolder,
      agentSocket,
      routedAddress,
      controlFolderOf(runFolder),
    ),
  );
  writeUserSettings(runFolder, configFile);
  await waitForHost(dependencies, configFile);
  await dependencies.bundleSuite(root);
  const vscodium =
    editor === 'vscodium' ? await dependencies.vscodiumExecutable() : undefined;
  const vsixFiles = packagedExtensions(root);
  if (
    editor === 'vscodium' &&
    launchesOf(root).some(launch => launch.kind === 'plain')
  ) {
    vsixFiles.push(await dependencies.windowAgentVsix(root, runFolder));
  }
  const installs = installsOf(
    root,
    runFolder,
    vsixFiles,
    editor === 'vscodium' ? launchesOf(root) : [],
  ).filter(install => install.files.length > 0);
  if (installs.length > 0) {
    const editorCommand =
      vscodium === undefined
        ? await dependencies.editorCli()
        : vscodiumCliOf(vscodium);
    for (const {folder, files} of installs) {
      checked(command, editorCommand, [
        `--extensions-dir=${folder}`,
        `--user-data-dir=${path.join(runFolder, 'user-data')}`,
        `--shared-data-dir=${path.join(runFolder, 'shared-data')}`,
        ...files.flatMap(file => ['--install-extension', file]),
      ]);
    }
  }
  const launches = editor === 'vscodium' ? launchesOf(root) : [];
  for (const launch of launches) {
    if (launch.kind === 'plain' && launch.standIns !== undefined) {
      writeStandIns(runFolder, launch, standInEngines(root, launch));
    }
  }
  const devContainerImage = launches.some(needsDevContainerImage)
    ? devContainerImageFor(command, root, runId)
    : undefined;
  return {
    REMOTE_OSS_ACCEPTANCE: '1',
    HARNESS_SSH_CONFIG: configFile,
    HARNESS_CONTAINER: host.container,
    HARNESS_ROUTED_ADDRESS: routedAddress,
    HARNESS_RUN_FOLDER: runFolder,
    HARNESS_RUN_ID: runId,
    ...(devContainerImage === undefined
      ? {}
      : {HARNESS_DEVCONTAINER_IMAGE: devContainerImage}),
    HARNESS_PASSWORD_FILE: host.passwordFile,
    REMOTE_OSS_ACCEPTANCE_SCRIPT: path.join(runFolder, 'script.json'),
    REMOTE_OSS_ACCEPTANCE_RECORD: path.join(runFolder, 'record.jsonl'),
    REMOTE_OSS_ACCEPTANCE_SIGNALS: path.join(runFolder, 'signals'),
    HARNESS_VSIX_FILES: vsixFiles.join(path.delimiter),
    HARNESS_EDITOR: editor,
    REMOTE_OSS_ACCEPTANCE_LOG: path.join(runFolder, 'log.txt'),
    ...(vscodium === undefined ? {} : {HARNESS_VSCODIUM_EXECUTABLE: vscodium}),
    ...downloads?.variables,
    ...(keys === undefined
      ? {}
      : {
          SSH_AUTH_SOCK: agentSocket,
          HARNESS_AGENT_SOCKET: agentSocket,
          HARNESS_PASSPHRASE_FILE: keys.passphraseFile,
        }),
  };
}

/**
 * The run's dev container image: other runs' stale dev containers and images swept first, then the image built with the
 * run's labels.
 */
function devContainerImageFor(
  command: CommandRunner,
  root: string,
  runId: string,
): string {
  sweepStaleDevContainers(command, runId, Date.now() / 1000);
  return buildDevContainerImage(command, root, runId);
}

/** The `engines.vscode` of a launch's stand-ins: the one of the first extension the launch installs of its own. */
export function standInEngines(root: string, launch: Launch): string {
  const own = launch.kind === 'plain' ? launch.withExtensions?.[0] : undefined;
  const folder = own === undefined ? undefined : LAUNCH_EXTENSIONS.get(own);
  if (folder === undefined) {
    return '';
  }
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'packages', folder, 'package.json'), 'utf8'),
  ) as {engines?: {vscode?: string}};
  return manifest.engines?.vscode ?? '';
}

/** Copies the host extensions of the launches into the host's home folder of the user harness. */
function prepareHost(
  command: CommandRunner,
  root: string,
  container: string,
  launches: readonly Launch[],
): void {
  for (const extension of new Set(
    runnerLaunches(launches).flatMap(launch => launch.hostExtensions ?? []),
  )) {
    const folder = hostExtensionFolder(extension);
    checked(command, 'docker', [
      'cp',
      path.join(root, 'tests', 'acceptance', extension),
      `${container}:${folder}`,
    ]);
    checked(command, 'docker', [
      'exec',
      '--user',
      'root',
      container,
      'chown',
      '-R',
      'harness:harness',
      folder,
    ]);
  }
}

/**
 * Runs a launch's host setup in order, as root, in the host container. A command that exits non-zero fails the
 * attempt with its command and its output.
 */
function runHostSetup(
  command: CommandRunner,
  container: string,
  entries: readonly HostSetupEntry[],
): void {
  for (const entry of entries) {
    const result = command('docker', [
      'exec',
      ...(entry.detach === true ? ['-d'] : []),
      '--user',
      'root',
      container,
      'sh',
      '-c',
      entry.command,
    ]);
    if (result.status !== 0) {
      throw new Error(
        `host setup failed: ${entry.command}\n${result.stderr.trim()}`,
      );
    }
  }
}

/**
 * Runs each launch in order and returns their exit codes. The VS Code run has one configuration and needs no label;
 * each attempt of a VSCodium launch finds the run's base settings plus the launch's own, so none inherits another's.
 * A launch with host setup runs it before each attempt, and waits the helper's grace after the launch before it,
 * so its resolve finds no live helper of the run.
 */
export async function runLaunches(
  runFolder: string,
  configFile: string,
  launches: ReadonlyArray<Launch | undefined>,
  command: CommandRunner,
  container: string,
  sleep: Sleeper,
  runLaunch: (launch?: Launch) => Promise<AttemptResult>,
  beforeAttempt: (launch: Launch) => Promise<void> = () => Promise.resolve(),
  bases: Readonly<Record<string, string | undefined>> = {},
  holdPorts: PortHolder = holdClientPorts,
): Promise<number[]> {
  const exitCodes: number[] = [];
  for (const launch of launches) {
    if (launch?.hostSetup !== undefined) {
      // The helper of the previous launch ends HELPER_GRACE_MILLISECONDS after its window; a live one would be
      // reused by this resolve without any check, so the run waits the grace out.
      await sleep(FRESH_RESOLVE_WAIT_MILLISECONDS);
    }
    exitCodes.push(
      await runWithRetry(async () => {
        // Each attempt starts from the base settings plus the launch's own, not from what a failed attempt left.
        if (launch !== undefined) {
          if (launch.hostSetup !== undefined) {
            runHostSetup(command, container, launch.hostSetup);
          }
          writeUserSettings(
            runFolder,
            configFile,
            withRunTokens(
              withHarnessBases(launch.settings, bases),
              runFolder,
              process.env.PATH ?? '',
            ),
            launch.label,
            launch.settingsTail,
          );
          await beforeAttempt(launch);
        }
        const held = await holdPorts(launch?.clientListeners ?? []);
        try {
          return await runLaunch(launch);
        } finally {
          await held.release();
        }
      }, console.log.bind(console)),
    );
  }
  return exitCodes;
}

/**
 * Notes, for a launch, how many requests the download host had logged when it began, in
 * `<run folder>/<label>-requests-start`, so that its rows read only the requests of their own case. A run without a
 * download host notes nothing.
 */
export function markDownloadRequests(
  runFolder: string,
  label: string,
  variables: Pick<HarnessVariables, 'HARNESS_DOWNLOADS_LOG'>,
): void {
  const requestLog = variables.HARNESS_DOWNLOADS_LOG;
  if (requestLog === undefined) {
    return;
  }
  const logged = existsSync(requestLog)
    ? readFileSync(requestLog, 'utf8')
        .split('\n')
        .filter(line => line !== '').length
    : 0;
  writeFileSync(
    path.join(runFolder, `${label}-requests-start`),
    `${String(logged)}\n`,
  );
}

/**
 * How long the run waits before a client-search launch, in milliseconds: the connection helper of the launch before it
 * ends when its grace after the last window has passed (3 s), and a live helper would be reused without a check.
 */
const HELPER_GONE_MILLISECONDS = 5000;

/**
 * Runs the acceptance tests and returns the exit code for the process: the first failing run's test-cli code, or 1
 * when the harness could not be prepared. Every label runs, also after a failure.
 */
export async function runAcceptance(
  root: string,
  dependencies: HarnessDependencies,
  editor: EditorChoice = 'vscode',
  selected?: readonly string[],
): Promise<number> {
  const chosen =
    editor === 'vscodium' ? chosenLaunches(launchesOf(root), selected) : [];
  if (typeof chosen === 'string') {
    console.error(`acceptance: ${chosen}`);
    return 2;
  }
  if (editor === 'vscodium' && selected !== undefined) {
    reportSelection(launchesOf(root), chosen);
    if (chosen.length === 0) {
      return 0;
    }
  }
  // The run id in the name lets the clean-up find the editor of a run that was killed.
  const runFolder = mkdtempSync(
    path.join(
      tmpdir(),
      `acceptance-${acceptanceRunId(process.env, process.pid)}-`,
    ),
  );
  const started: string[] = [];
  const stops: Array<() => Promise<void>> = [];
  try {
    const variables = await prepare(
      root,
      dependencies,
      runFolder,
      started,
      editor,
      stops,
    );
    const exitCodes: number[] = [];
    for (const failure of editor === 'vscodium' ? failureCases(root) : []) {
      writeFileSync(
        launchFiles(runFolder, failureLabel(failure.label ?? failure.alias))
          .script,
        JSON.stringify({entries: failure.script}),
      );
    }
    for (const suite of editor === 'vscodium' ? HOST_CASE_SUITES : []) {
      for (const hostCase of hostCases(root, suite.suite)) {
        // A connected case leaves the script unused, which is no failure; a failed one is answered from it.
        writeFileSync(
          launchFiles(runFolder, hostCaseLabel(suite, hostCase)).script,
          JSON.stringify({entries: hostCase.script ?? DIALOG_SCRIPT}),
        );
      }
    }
    for (const client of editor === 'vscodium' ? clientCases(root) : []) {
      // A connected case leaves the script unused, which is no failure; a failed one is answered from it.
      writeFileSync(
        launchFiles(runFolder, client.label).script,
        JSON.stringify({entries: client.script ?? []}),
      );
    }
    const launches = chosen;
    if (editor === 'vscodium') {
      writeClients(runFolder);
      writeTildeCopy(runFolder);
      writeSshRecorder(runFolder);
    }
    prepareHost(
      dependencies.command,
      root,
      variables.HARNESS_CONTAINER,
      launches,
    );
    exitCodes.push(
      ...(await runLaunches(
        runFolder,
        variables.HARNESS_SSH_CONFIG,
        editor === 'vscodium' ? launches : [undefined],
        dependencies.command,
        variables.HARNESS_CONTAINER,
        dependencies.sleep,
        launch =>
          launch?.kind === 'plain'
            ? dependencies.runPlain(root, variables, launch)
            : dependencies.runTests(root, variables, launch?.label),
        async launch => {
          if (launch.label.startsWith('client-')) {
            await dependencies.sleep(HELPER_GONE_MILLISECONDS);
            clearCalls(runFolder);
          }
          // The vanishing client's check deletes itself, so an attempt after a hung one must find it again.
          if (launch.label === 'client-vanishing') {
            rewriteClient(runFolder, 'vanishing');
          }
          markDownloadRequests(runFolder, launch.label, variables);
        },
        {...variables},
      )),
    );
    return exitCodes.find(exitCode => exitCode !== 0) ?? 0;
  } catch (error) {
    console.error(`acceptance: ${failureText(error)}`);
    return 1;
  } finally {
    for (const container of started) {
      dependencies.command('docker', ['rm', '--force', container]);
    }
    for (const stop of stops) {
      await stop();
    }
    rmSync(runFolder, {recursive: true, force: true});
    removeBundles(root);
  }
}

/** The `@vscode/test-cli` configuration of a run, from the harness variables in `environment`. */
export function acceptanceConfiguration(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
): {
  label: string;
  version: string;
  extensionDevelopmentPath: string;
  files: string;
  launchArgs: string[];
  env: Record<string, string | undefined>;
  mocha: {ui: 'bdd'; timeout: number};
} {
  const runFolder = environment.HARNESS_RUN_FOLDER ?? '';
  return {
    label: 'acceptance',
    version: EDITOR_VERSION,
    extensionDevelopmentPath: path.join(root, 'tests', 'acceptance', 'runner'),
    // test-cli expands a glob relative to its configuration file, tests/acceptance/vscode-test.mjs.
    files: 'dist/**/*.test.cjs',
    launchArgs: editorArguments(runFolder),
    env: {...environment},
    mocha: {ui: 'bdd', timeout: 60_000},
  };
}

/** The test-cli configuration of one VSCodium window; the window's folder, when it has one, comes first on the editor's command line. */
export function vscodiumConfiguration(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
  executable: string,
  launch: RunnerLaunch,
) {
  const runFolder = environment.HARNESS_RUN_FOLDER ?? '';
  const files = launchFiles(runFolder, launch.label);
  const acceptance = path.join(root, 'tests', 'acceptance');
  const runner = path.join(acceptance, launch.runner);
  const env: Record<string, string | undefined> = {
    ...environment,
    REMOTE_OSS_ACCEPTANCE_LOG: files.logFile,
    REMOTE_OSS_ACCEPTANCE_WINDOWS: path.join(
      runFolder,
      launch.label,
      'agent',
      'pids',
    ),
    ...(launch.ownScript === true
      ? {
          REMOTE_OSS_ACCEPTANCE_SCRIPT: files.script,
          REMOTE_OSS_ACCEPTANCE_RECORD: files.record,
        }
      : {}),
    ...withRunTokens(launch.environment, runFolder, environment.PATH ?? ''),
  };
  return {
    label: launch.label,
    useInstallation: {fromPath: executable},
    extensionDevelopmentPath:
      launch.extraExtensions === undefined
        ? runner
        : [
            runner,
            ...launch.extraExtensions.map(extension =>
              path.join(acceptance, extension),
            ),
          ],
    files: `${bundleFolderOf(launch.suite)}/**/*.test.cjs`,
    launchArgs: [
      ...(launch.folderUri === undefined
        ? []
        : ['--folder-uri', launch.folderUri]),
      ...(launch.hostExtensions ?? []).map(
        extension =>
          `--extensionDevelopmentPath=vscode-remote://ssh-remote+harness${hostExtensionFolder(extension)}`,
      ),
      ...editorArguments(runFolder, launch.proposedApi !== false),
    ],
    env,
    mocha: {ui: 'bdd' as const, timeout: 120_000},
  };
}

/** The VSCodium configurations, one per launch of the table in acceptance-launches.ts. */
export function vscodiumConfigurations(
  root: string,
  environment: Readonly<Record<string, string | undefined>>,
  executable: string,
) {
  return runnerLaunches(launchesOf(root)).map(launch =>
    vscodiumConfiguration(root, environment, executable, launch),
  );
}

/** The suites that are bundled: the shared helpers and the suite of each launch. */
function suitesOfRun(root: string): string[] {
  return suitesOf(launchesOf(root));
}

/** The bundle of a further development extension: the `extension.cjs` beside its package.json. */
function extensionBundleOf(root: string, extension: string): string {
  return path.join(root, 'tests', 'acceptance', extension, 'extension.cjs');
}

/** Removes every suite's bundle folder and extension bundle, so that no run leaves bundles in a checkout. */
export function removeBundles(root: string): void {
  for (const suite of suitesOfRun(root)) {
    rmSync(path.join(root, 'tests', 'acceptance', bundleFolderOf(suite)), {
      recursive: true,
      force: true,
    });
  }
  for (const extension of extensionsOf(launchesOf(root))) {
    rmSync(extensionBundleOf(root, extension), {force: true});
  }
}

/**
 * Bundles every `*.test.ts` of each suite folder of tests/acceptance into its output folder, one `.cjs` file each,
 * and the `src/extension.ts` of each further development extension into its `extension.cjs`.
 */
export async function bundleSuite(root: string): Promise<void> {
  for (const suite of suitesOfRun(root)) {
    await bundleFolder(root, suite, bundleFolderOf(suite));
  }
  for (const extension of extensionsOf(launchesOf(root))) {
    await build({
      entryPoints: [
        path.join(
          root,
          'tests',
          'acceptance',
          extension,
          'src',
          'extension.ts',
        ),
      ],
      outfile: extensionBundleOf(root, extension),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['vscode'],
      logLevel: 'warning',
    });
  }
}

/** Where the hold that every suite's bundle folder gets is written, relative to the repository. */
const SETTLE_ENTRY = 'tests/acceptance/suite/settle.ts';

/** Bundles every `*.test.ts` of tests/acceptance/`source` into tests/acceptance/`output`, and the hold beside them. */
async function bundleFolder(
  root: string,
  source: string,
  output: string,
): Promise<void> {
  const suite = path.join(root, 'tests', 'acceptance', source);
  const outputFolder = path.join(root, 'tests', 'acceptance', output);
  // A bundle a former run left behind would run with these; a shared runner keeps its checkout between jobs.
  rmSync(outputFolder, {recursive: true, force: true});
  await build({
    entryPoints: [
      ...sortedEntries(suite)
        .filter(entry => entry.name.endsWith('.test.ts'))
        .map(entry => path.join(suite, entry.name)),
      // The hold after a window's last row, which every suite's run loads beside its own files.
      // eslint-disable-next-line id-length -- esbuild's entry point fields
      {in: path.join(root, SETTLE_ENTRY), out: 'settle.test'},
    ],
    outdir: outputFolder,
    bundle: true,
    platform: 'node',
    // The repository's package.json says "type": "module", so a CommonJS bundle needs the .cjs extension.
    format: 'cjs',
    outExtension: {'.js': '.cjs'},
    external: ['vscode'],
    logLevel: 'warning',
  });
}

/**
 * The editor's CLI at the version under test. The harness installs the VSIX files with it into the run's own
 * extensions folder, the one the editor is started with; test-cli's own install would use its default folder.
 */
async function editorCli(): Promise<string> {
  const executable = await withOneRetry(
    () => downloadAndUnzipVSCode(EDITOR_VERSION),
    delay,
    console.log.bind(console),
  );
  return resolveCliPathFromVSCodeExecutablePath(executable);
}

/** What the VSCodium download needs from outside: the network and the unpacking. */
export interface VscodiumTransfer {
  download: (url: string) => Promise<Uint8Array>;
  unpack: (archive: Uint8Array, folder: string) => void;
}

/** The command-line wrapper beside the VSCodium executable; the editor itself, started through it, does not run tests. */
function vscodiumCliOf(executable: string): string {
  return path.join(path.dirname(executable), 'bin', 'codium-insiders');
}

/**
 * The VSCodium executable of the pinned release under `<root>/.vscode-test`, in a folder of the release and the
 * client's platform, so a build of another architecture is never taken for it. A missing build is downloaded, checked
 * against the release's sha256 and unpacked; one already there is used as it is.
 */
export async function vscodiumExecutableOf(
  root: string,
  platform: string,
  architecture: string,
  transfer: VscodiumTransfer,
  checksums: Readonly<Record<string, string>> = VSCODIUM_RELEASE.sha256,
): Promise<string> {
  const key = `${platform}-${architecture}`;
  const folder = path.join(
    root,
    '.vscode-test',
    `vscodium-${VSCODIUM_RELEASE.tagName}-${key}`,
  );
  const executable = path.join(folder, 'codium-insiders');
  if (existsSync(executable)) {
    return executable;
  }
  const expected = checksums[key];
  if (expected === undefined) {
    throw new Error(
      `no VSCodium build is pinned for ${platform}-${architecture}`,
    );
  }
  const archive = await transfer.download(
    `https://github.com/${VSCODIUM_RELEASE.repository}/releases/download/${VSCODIUM_RELEASE.tagName}/VSCodium-${key}-${VSCODIUM_RELEASE.tagName}.tar.gz`,
  );
  if (createHash('sha256').update(archive).digest('hex') !== expected) {
    throw new Error('the VSCodium download does not match its checksum');
  }
  transfer.unpack(archive, folder);
  return executable;
}

/** The lines in the editor's output that report a hung window; the run is retried once on them. */
const HANG_MARKERS: readonly string[] = ['CodeWindow: detected unresponsive'];

/** The result of one attempt of the acceptance run: the process's exit code and its output. */
export interface AttemptResult {
  exitCode: number;
  output: string;
}

/** Whether the first attempt is retried once: a failing first attempt whose output names a hung window. */
export function shouldRetry(
  attempt: number,
  exitCode: number,
  output: string,
): boolean {
  return (
    attempt === 1 &&
    exitCode !== 0 &&
    HANG_MARKERS.some(marker => output.includes(marker))
  );
}

/** Runs the attempt; on a retriable result it logs the retry and runs once more; it returns the last exit code. */
export async function runWithRetry(
  attempt: () => Promise<AttemptResult>,
  report: (line: string) => void,
): Promise<number> {
  const first = await attempt();
  if (!shouldRetry(1, first.exitCode, first.output)) {
    return first.exitCode;
  }
  report('acceptance: editor window unresponsive on attempt 1; retrying once');
  const second = await attempt();
  return second.exitCode;
}

/** How long the harness waits before its one retry of a step that failed, in milliseconds. */
export const RETRY_PAUSE_MILLISECONDS = 5000;

/**
 * The text of a failure for the harness's line: an Error's message; when that is empty, its cause's text; when it
 * has none, the first two lines of its stack, trimmed and joined with a space, or its name when it has no stack.
 * Anything else as `String(caught)`.
 */
export function failureText(caught: unknown): string {
  if (!(caught instanceof Error)) {
    return String(caught);
  }
  if (caught.message !== '') {
    return caught.message;
  }
  const cause = caught.cause;
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === 'string') {
    return cause;
  }
  if (caught.stack !== undefined) {
    return caught.stack
      .split('\n')
      .slice(0, 2)
      .map(line => line.trim())
      .join(' ');
  }
  return caught.name;
}

/**
 * Runs `step`; when it throws, reports the failure through `report`, waits `RETRY_PAUSE_MILLISECONDS`, and runs
 * it once more. The second attempt's result or error is the outcome.
 */
export async function withOneRetry<Value>(
  step: () => Promise<Value>,
  sleep: (milliseconds: number) => Promise<void>,
  report: (line: string) => void,
): Promise<Value> {
  try {
    return await step();
  } catch (error) {
    report(
      `acceptance: ${failureText(error)}; retrying once in ${String(
        RETRY_PAUSE_MILLISECONDS / 1000,
      )} s`,
    );
    await sleep(RETRY_PAUSE_MILLISECONDS);
    return await step();
  }
}

/**
 * Runs a program and returns its exit code and its output. Each output chunk is handed to `echo` as it
 * arrives, so a run that hangs until the job's own timeout still shows its output in the job's log.
 */
export function runAndCollect(
  program: string,
  programArguments: readonly string[],
  options: {cwd?: string; env?: NodeJS.ProcessEnv} = {},
  echo: (chunk: string) => void = chunk => process.stdout.write(chunk),
): Promise<AttemptResult> {
  return new Promise<AttemptResult>((resolve, reject) => {
    const child = spawn(program, [...programArguments], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        echo(chunk.toString('utf8'));
      });
    }
    child.on('close', (code: number | null) => {
      resolve({
        exitCode: code ?? 1,
        output: Buffer.concat(chunks).toString('utf8'),
      });
    });
    child.on('error', reject);
  });
}

/**
 * Starts test-cli with the acceptance configuration and the harness variables, and returns its result: the
 * editor's output streams to the job's log as it arrives, and is kept whole for the retry decision, so both
 * attempts show there.
 */
export function runTestCli(
  root: string,
  variables: HarnessVariables,
  label?: string,
): Promise<AttemptResult> {
  return runAndCollect(
    process.execPath,
    [
      path.join(path.dirname(resolveBinary('@vscode/test-cli')), 'bin.mjs'),
      '--config',
      path.join(root, 'tests', 'acceptance', 'vscode-test.mjs'),
      ...(label === undefined ? [] : ['--label', label]),
    ],
    {cwd: root, env: {...process.env, ...variables}},
  );
}

/** What a run prints when its arguments are not understood. */
export const USAGE =
  'usage: node tools/acceptance.ts [--editor vscode|vscodium [--launches all|none|<label>,...]]';

/**
 * The launches a run makes: every one when `selected` is undefined, else those whose label it names,
 * in the run's order; an error text naming the known labels when it names an unknown one.
 */
export function chosenLaunches(
  launches: readonly Launch[],
  selected: readonly string[] | undefined,
): Launch[] | string {
  if (selected === undefined) {
    return [...launches];
  }
  const known = launches.map(launch => launch.label);
  const unknown = selected.filter(label => !known.includes(label));
  if (unknown.length > 0) {
    return `unknown launch label(s): ${unknown.join(', ')}; the known ones: ${known.join(', ')}`;
  }
  return launches.filter(launch => selected.includes(launch.label));
}

/** Prints the launches a selected run makes and skips, and adds them to the job's summary when there is one. */
function reportSelection(
  launches: readonly Launch[],
  chosen: readonly Launch[],
): void {
  const made = chosen.map(launch => launch.label);
  const skipped = launches
    .map(launch => launch.label)
    .filter(label => !made.includes(label));
  const text =
    made.length === 0
      ? `no launch reachable: none made, ${String(skipped.length)} skipped`
      : `launches made (${String(made.length)}): ${made.join(', ')}; skipped (${String(skipped.length)}): ${skipped.join(', ') || '-'}`;
  console.log(`acceptance: ${text}`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') {
    appendFileSync(summary, `**VSCodium launches:** ${text}\n`);
  }
}

/** The run's editor and launch selection from its arguments, or undefined when they are not understood. */
export function runArgumentsOf(
  commandArguments: readonly string[],
): {editor: EditorChoice; launches?: string[]} | undefined {
  const flagIndex = commandArguments.indexOf('--launches');
  if (flagIndex === -1) {
    const editor = editorChoiceOf(commandArguments);
    return editor === undefined ? undefined : {editor};
  }
  const value = commandArguments[flagIndex + 1];
  const rest = [
    ...commandArguments.slice(0, flagIndex),
    ...commandArguments.slice(flagIndex + 2),
  ];
  if (
    value === undefined ||
    value === '' ||
    editorChoiceOf(rest) !== 'vscodium'
  ) {
    return undefined;
  }
  if (value === 'all') {
    return {editor: 'vscodium'};
  }
  return {
    editor: 'vscodium',
    launches: value === 'none' ? [] : value.split(','),
  };
}

/** The editor the arguments choose (VS Code when they name none), or undefined when they are not understood. */
export function editorChoiceOf(
  commandArguments: readonly string[],
): EditorChoice | undefined {
  if (commandArguments.length === 0) {
    return 'vscode';
  }
  const [flag, value, ...rest] = commandArguments;
  return flag === '--editor' &&
    rest.length === 0 &&
    (value === 'vscode' || value === 'vscodium')
    ? value
    : undefined;
}

/** Downloads `url` into memory through `fetcher`, with one retry. */
export async function downloadWithRetry(
  url: string,
  fetcher: typeof fetch = fetch,
  pause: Sleeper = delay,
): Promise<Uint8Array> {
  return withOneRetry(
    async () => {
      const response = await fetcher(url);
      if (!response.ok) {
        throw new Error(`${url}: ${String(response.status)}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    pause,
    console.log.bind(console),
  );
}

/** Unpacks a gzipped tar archive into `folder`. */
export function unpackArchive(archive: Uint8Array, folder: string): void {
  mkdirSync(folder, {recursive: true});
  const archiveFile = path.join(folder, 'archive.tar.gz');
  writeFileSync(archiveFile, archive);
  checked(runCommand, 'tar', ['-xzf', archiveFile, '-C', folder]);
  rmSync(archiveFile);
}

if (isMainModule(import.meta.url)) {
  const parsed = runArgumentsOf(process.argv.slice(2));
  if (parsed === undefined) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    process.exitCode = await runAcceptance(
      REPOSITORY_ROOT,
      {
        command: runCommand,
        sleep: delay,
        bundleSuite,
        editorCli,
        vscodiumExecutable: vscodiumExecutableOf.bind(
          undefined,
          REPOSITORY_ROOT,
          process.platform,
          process.arch,
          {download: downloadWithRetry, unpack: unpackArchive},
        ),
        runTests: runTestCli,
        windowAgentVsix: packageWindowAgent,
        startAgent: startRunAgent,
        startDownloads: startRunDownloads.bind(
          undefined,
          runCommand,
          downloadWithRetry,
        ),
        runPlain: (root, variables, launch) =>
          runPlainLaunch(
            root,
            {
              runFolder: variables.HARNESS_RUN_FOLDER,
              executable: variables.HARNESS_VSCODIUM_EXECUTABLE ?? '',
              environment: {...process.env, ...variables},
            },
            launch,
            {
              start: startDetached,
              runTests: program =>
                runAndCollect(program.file, program.programArguments, {
                  cwd: root,
                  env: program.environment,
                }),
            },
          ),
      },
      parsed.editor,
      parsed.launches,
    );
  }
}
