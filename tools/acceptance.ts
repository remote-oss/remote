/**
 * @fileoverview acceptance: runs the acceptance tests in the editor under test against an SSH host in a container.
 *
 *     node tools/acceptance.ts
 *
 * It builds the host image of tests/acceptance/host, makes a key pair for this run, starts the host with the public
 * key, writes an ssh_config whose `Host harness` reaches it, bundles the tests of tests/acceptance/suite, and starts
 * `@vscode/test-cli` with tests/acceptance/vscode-test.mjs. The editor gets a fresh user-data and extensions folder
 * (each plain launch a user-data folder of its own), the packaged VSIX files of the extensions under test, and the
 * harness variables. The container and the run's
 * folder are removed at the end, whatever the outcome. Run `pnpm package` first; `pnpm test:acceptance` does both.
 */

import {stopHelpersUnder} from './acceptance-helper-stop.ts';
import {
  daemonLock,
  type LaunchLock,
  NO_LOCK,
  nodeProcessAlive,
} from './acceptance-lock.ts';
import {holdClientPorts, type PortHolder} from './acceptance-occupy.ts';
import {
  type RunRegistry,
  startRunRegistry,
  SYSTEM_CLOCK,
} from './acceptance-registry.ts';
import {staleRefusal} from './acceptance-stale.ts';
import {ghcrLayer, prepareRunTemplates} from './acceptance-templates.ts';
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
import {hostname, tmpdir} from 'node:os';
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
  UPDATE_SERVICE_NAME,
  updateServicePinCommand,
} from './acceptance-downloads.ts';
import {
  acceptanceRunId,
  buildDevContainerImage,
  cleanPodmanRun,
  cleanRun,
  connectRunNetwork,
  loadImageIntoPodman,
  requirePodman,
  startHostContainer,
  sweepStaleRunObjects,
} from './acceptance-run.ts';
import {checked, type CommandRunner, runCommand} from './command-runner.ts';
import {EDITOR_VERSION, GENUINE_VERSIONS} from './editor-floor.ts';
import {type HostBase, HOST_BASE_VARIANTS} from './host-variants.ts';
import {
  agentSocketPath,
  controlFolderOf,
  CERTIFIED_PRINCIPAL,
  makeRunKeys,
  passkeyCopies,
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
  LAUNCH_GROUPS,
  launchGroupOf,
  settingsOfLaunch,
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
  editorLogsEnvironment,
  extensionsFolderOf,
  launchFiles,
  languagePackVsixOf,
  packageLanguagePack,
  packageWindowAgent,
  registerLanguagePack,
  runPlainLaunch,
  startDetached,
  stateFolderOf,
  type Started,
  userDataFolderOf,
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
  /**
   * The container ids of the run's hosts of other bases, as JSON from base to id: one per base that a launch of the run
   * connects to (`hostBase`), when there is one.
   */
  HARNESS_HOST_CONTAINERS?: string;
  /** The host's address on the run network, which the `routed` alias names; a route cut is scoped to it. */
  HARNESS_ROUTED_ADDRESS: string;
  /** The run's folder: user data, extensions, keys. */
  HARNESS_RUN_FOLDER: string;
  /** The run's id, which every Docker object of the run carries in its run label. */
  HARNESS_RUN_ID: string;
  /** The run's dev container image tag, when a launch of the run installs Dev Containers; VSCodium run only. */
  HARNESS_DEVCONTAINER_IMAGE?: string;
  /** The engine CLI the extension drives instead of `docker`, when a chosen launch names one. */
  HARNESS_ENGINE?: 'podman';
  /** The name that engine lists the run's dev container image under, once loaded into its storage. */
  HARNESS_ENGINE_IMAGE?: string;
  /** The address (`host:port`) of the run's registry, when a chosen launch asks for one; VSCodium run only. */
  HARNESS_REGISTRY?: string;
  /** The run's registry as its templates' ids name it (`localhost:<port>`), when a chosen launch asks for templates. */
  HARNESS_TEMPLATE_REGISTRY?: string;
  /** The URL of the run's template index on the download host, when a chosen launch asks for templates; harness-only. */
  REMOTE_OSS_TEMPLATE_INDEX?: string;
  /** The URL of the run's control manifest on the download host, when a chosen launch asks for templates; harness-only. */
  REMOTE_OSS_CONTROL_MANIFEST?: string;
  /** The file with the bare password of the host's user `harness-pw`, mode 600: a test puts it in a script entry. */
  HARNESS_PASSWORD_FILE: string;
  /** The file with the base32 one-time-code secret of the Ubuntu 26.04 host's user `harness-2fa`, mode 600. */
  HARNESS_TOTP_FILE: string;
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
  /** The version of the editor the tests run on: the recorded version, or the job's for a genuine launch. */
  HARNESS_EDITOR_VERSION: string;
  /** The VS Code executable of the genuine version, only when a chosen launch starts it. */
  HARNESS_VSCODE_EXECUTABLE?: string;
  /** The version of VS Code the genuine launches run, only when a chosen launch starts it. */
  HARNESS_GENUINE_VERSION?: string;
  /** The download host's bases and request log (`tools/acceptance-downloads.ts`), in the VSCodium run only. */
  HARNESS_DOWNLOADS_HTTP?: string;
  HARNESS_DOWNLOADS_HTTPS?: string;
  HARNESS_DOWNLOADS_LICENSED?: string;
  HARNESS_DOWNLOADS_LOCAL?: string;
  HARNESS_DOWNLOADS_LOG?: string;
  /** The run's download host certificate file, and the address of the fixture Feature tarball it serves on the runner's `localhost`. */
  HARNESS_DOWNLOADS_CERTIFICATE?: string;
  HARNESS_FEATURE_TARBALL_URL?: string;
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
  /** The VS Code executable of `version`, downloading the editor when it is missing. */
  vscodeExecutable: (version: string) => Promise<string>;
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
  /** Packages the fixture language pack for a language and gives its VSIX file. */
  languagePackVsix: (
    root: string,
    runFolder: string,
    language: string,
  ) => string;
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
  /** Starts the run's registry for a launch that asks for one; the VSCodium run only. */
  startRegistry: (runId: string) => Promise<RunRegistry>;
  /** Publishes the run's templates into the registry at `address` and writes the run's index; the run's dev container image names its `mini` template; gives the templates' registry. */
  prepareTemplates: (
    root: string,
    runFolder: string,
    address: string,
    devContainerImage: string | undefined,
  ) => Promise<string>;
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
 * The container ids of the run's hosts of other bases, by base, from `HARNESS_HOST_CONTAINERS`; none when it is unset.
 */
export function baseContainersOf(
  environment: Readonly<Record<string, string | undefined>>,
): Partial<Record<HostBase, string>> {
  const named = environment.HARNESS_HOST_CONTAINERS;
  return named === undefined
    ? {}
    : (JSON.parse(named) as Partial<Record<HostBase, string>>);
}

/**
 * What the rows of a launch on a host of another base see in place of the run's own host: that host's container and
 * ssh_config, and its base; nothing for a launch on the harness host.
 */
export function hostBaseVariables(
  launch: Launch,
  environment: Readonly<Record<string, string | undefined>>,
  runFolder: string,
): Record<string, string> {
  return launch.hostBase === undefined
    ? {}
    : {
        HARNESS_CONTAINER: baseContainersOf(environment)[launch.hostBase] ?? '',
        HARNESS_SSH_CONFIG: sshConfigOf(runFolder, launch.hostBase),
        HARNESS_HOST_BASE: launch.hostBase,
      };
}

/** The ssh_config of the run's host of `base`: the run's own for Alpine's host, `ssh_config-<base>` beside it otherwise. */
export function sshConfigOf(
  runFolder: string,
  base: HostBase = 'alpine',
): string {
  return path.join(
    runFolder,
    base === 'alpine' ? 'ssh_config' : `ssh_config-${base}`,
  );
}

/**
 * The ssh_config of the run: `Host harness` with the run's key, its own known-hosts file and no agent; three
 * aliases that fail for the failure rows: `refused` (a closed port), `nowhere` (a name that never resolves, RFC 6761)
 * and `stranger` (the harness host with an empty known-hosts file, so its key is unknown); `routed` (the harness
 * account at the host's own address on the run network, which a route cut makes unreachable or silent); and the aliases of the
 * host's other accounts: `password` (login by password only), `password-retry` (the password-only account that asks again after a wrong password, three prompts, so that ssh's refusal names `password`) and `proxy-ask-terminal` (the same for a login terminal, which answers it) and `proxy-ask` (the password account behind a ProxyCommand that asks on the terminal), `password-ask` (the same account whose host key is
 * asked, against its own known-hosts file a test deletes to make the key unknown again), `noforward` (TCP
 * forwarding refused), `nosocket` (stream-local forwarding refused), `noall` (all forwarding refused), `mute` (a login shell that does not answer), `harness-fish` (a login shell that is fish), `readonly` (a server data folder that exists
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
    // The Ubuntu 26.04 host's keyboard-interactive accounts: a password and a one-time code, and a forced change.
    ...accountAlias('twofactor', 'harness-2fa', port, runFolder, KBD_LINES),
    ...accountAlias('expired', 'harness-expired', port, runFolder, KBD_LINES),
    // The password account with ssh's default of three password prompts, so that a wrong password is asked again.
    ...accountAlias('password-retry', 'harness-pwonly', port, runFolder, [
      'PubkeyAuthentication no',
      'PreferredAuthentications password',
      'NumberOfPasswordPrompts 3',
    ]),
    // The same ProxyCommand for a login terminal, which a user answers there; it asks before the handshake, and the host sets no ConnectTimeout, so the setting's is the wait.
    'Host proxy-ask-terminal',
    '  HostName 127.0.0.1',
    `  Port ${String(port)}`,
    '  User harness-pw',
    '  IdentityAgent none',
    '  StrictHostKeyChecking accept-new',
    `  UserKnownHostsFile ${path.join(runFolder, 'known_hosts_proxy-ask-terminal')}`,
    ...PASSWORD_LINES.map(line => `  ${line}`),
    `  ProxyCommand bash -c 'printf "Proceed? " >/dev/tty && read answer </dev/tty && exec 3<>/dev/tcp/127.0.0.1/${String(port)} && { cat <&3 & exec cat >&3; }'`,
    '',
    // The password account behind a ProxyCommand that asks on the terminal, which a window without one cannot answer.
    ...accountAlias('proxy-ask', 'harness-pw', port, runFolder, [
      ...PASSWORD_LINES,
      `ProxyCommand setsid bash -c 'printf "Proceed? " >/dev/tty && read answer </dev/tty && exec 3<>/dev/tcp/127.0.0.1/${String(port)} && { cat <&3 & exec cat >&3; }'`,
    ]),
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
      'nosocket',
      'harness-nosock',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'noall',
      'harness-noall',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...FORWARD_ALIASES.flatMap(([alias, user, lines]) =>
      accountAlias(alias, user, port, runFolder, [
        ...keyLines(runFolder),
        ...lines,
      ]),
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
      'harness-fish',
      'harness-fish',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'harness-bash',
      'harness-bash',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'harness-zsh',
      'harness-zsh',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'harness-dash',
      'harness-dash',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'harness-ksh',
      'harness-ksh',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'harness-csh',
      'harness-csh',
      port,
      runFolder,
      keyLines(runFolder),
    ),
    ...accountAlias(
      'harness-tcsh',
      'harness-tcsh',
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
    // The same alias again under other names, so that a row finds no shared connection a row before it left.
    ...passkeyCopies().flatMap(alias =>
      keyAlias(alias, 'harness', port, runFolder, ['id_passphrase']),
    ),
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

/** The lines of an alias whose account logs in by keyboard-interactive only, every prompt asked of the user. */
const KBD_LINES = [
  'PubkeyAuthentication no',
  'PreferredAuthentications keyboard-interactive',
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
 * The aliases whose configuration forwards ports: `fwd-busy` and `fwd-busy-exit` (a `LocalForward` for a port the row
 * holds, without and with `ExitOnForwardFailure`), `fwd-static` (a `LocalForward` for the host's port 8657),
 * `fwd-gateway` (`GatewayPorts yes` with a `LocalForward`), `fwd-remote` (a `RemoteForward` to a port of the client),
 * `fwd-dynamic` (a `DynamicForward`), `fwd-open` and `fwd-noopen` (a dynamic `RemoteForward` with `PermitRemoteOpen`
 * `any` and `none`, an option of the client's configuration), `fwd-clearall` (`ClearAllForwardings yes`), `fwd-exit`
 * (`ExitOnForwardFailure yes` alone) and `fwd-dynamic-exit` (a `DynamicForward` for a port the row holds, with
 * `ExitOnForwardFailure yes`). Each is the alias's name, its account and its lines.
 */
export const FORWARD_ALIASES: ReadonlyArray<
  readonly [string, string, readonly string[]]
> = [
  ['fwd-busy', 'harness', ['LocalForward 13020 127.0.0.1:8660']],
  [
    'fwd-busy-exit',
    'harness',
    ['LocalForward 13020 127.0.0.1:8660', 'ExitOnForwardFailure yes'],
  ],
  ['fwd-static', 'harness', ['LocalForward 13010 127.0.0.1:8657']],
  [
    'fwd-gateway',
    'harness',
    ['GatewayPorts yes', 'LocalForward 13001 127.0.0.1:8661'],
  ],
  ['fwd-remote', 'harness', ['RemoteForward 19000 127.0.0.1:19101']],
  ['fwd-dynamic', 'harness', ['DynamicForward 11080']],
  ['fwd-open', 'harness', ['RemoteForward 19201', 'PermitRemoteOpen any']],
  ['fwd-noopen', 'harness', ['RemoteForward 19200', 'PermitRemoteOpen none']],
  ['fwd-clearall', 'harness', ['ClearAllForwardings yes']],
  ['fwd-exit', 'harness', ['ExitOnForwardFailure yes']],
  [
    'fwd-dynamic-exit',
    'harness',
    ['DynamicForward 13030', 'ExitOnForwardFailure yes'],
  ],
];

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
 * The editor's user settings of a launch, in its user-data folder: the extensions under test read the harness's
 * ssh_config, and `extra` is the launch's own settings. With a launch, the same bytes go to
 * `<run folder>/<label>-settings.json`, so a row compares the file the editor read with the one its launch got. The
 * launch's `settingsTail` is text put after the last member with no comma before it: a syntax error, after members the
 * editor still reads.
 */
export function writeUserSettings(
  runFolder: string,
  configFile: string,
  extra: Readonly<Record<string, unknown>> = {},
  launch?: Launch,
): void {
  const tail = launch?.settingsTail;
  const written = JSON.stringify(
    {'remote.SSH.configFile': configFile, ...extra},
    null,
    2,
  );
  const bytes =
    tail === undefined
      ? `${written}\n`
      : `${written.slice(0, -2)}\n  ${tail}\n}\n`;
  const folder = path.join(userDataFolderOf(runFolder, launch), 'User');
  mkdirSync(folder, {recursive: true});
  writeFileSync(path.join(folder, 'settings.json'), bytes);
  if (launch !== undefined) {
    writeFileSync(path.join(runFolder, `${launch.label}-settings.json`), bytes);
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
/** One install of a run: the files put into a folder with the CLI of the editor the folder's launches start. */
export interface Install {
  folder: string;
  files: string[];
  client: 'vscodium' | 'vscode';
}

/**
 * The installs of a run: the run's VSIX files into the run's extensions folder, and for each launch with extensions of
 * its own, the same files and the packaged VSIX of each of its own extensions into the launch's folder. A launch that
 * starts VS Code has its folder installed with VS Code's CLI.
 */
export function installsOf(
  root: string,
  runFolder: string,
  vsixFiles: readonly string[],
  launches: readonly Launch[],
): Install[] {
  return [
    {
      folder: extensionsFolderOf(runFolder),
      files: [...vsixFiles],
      client: 'vscodium',
    },
    ...launches.flatMap((launch): Install[] => {
      if (launch.kind !== 'plain') {
        return [];
      }
      if (launch.client === undefined && launch.withExtensions === undefined) {
        return [];
      }
      return [
        {
          folder: extensionsFolderOf(runFolder, launch),
          files: [
            ...vsixFiles,
            ...packagedExtensions(
              root,
              (launch.withExtensions ?? []).flatMap(
                extensionId => LAUNCH_EXTENSIONS.get(extensionId) ?? [],
              ),
            ),
            ...(launch.languagePack === undefined
              ? []
              : [languagePackVsixOf(runFolder, launch.languagePack)]),
          ],
          client: launch.client ?? 'vscodium',
        },
      ];
    }),
  ];
}

async function prepare(
  root: string,
  dependencies: HarnessDependencies,
  runFolder: string,
  started: string[],
  editor: EditorChoice,
  stops: Array<() => Promise<void>>,
  chosen: readonly Launch[],
  genuineVersion: string,
): Promise<HarnessVariables> {
  const {command} = dependencies;
  const runId = acceptanceRunId(process.env, process.pid);
  const podman = chosen.some(launch => launch.engine === 'podman');
  if (podman) {
    requirePodman(command);
  }
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
  const configFile = sshConfigOf(runFolder);
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
  // A launch whose window connects to a host of another base gets that host beside the run's, one per base, with the
  // same key and password, the same download names and its own ssh_config.
  const baseHosts: Partial<Record<HostBase, string>> = {};
  for (const base of HOST_BASE_VARIANTS.filter(variant =>
    chosen.some(launch => launch.hostBase === variant),
  )) {
    const baseHost = startHostContainer(
      command,
      root,
      runId,
      runFolder,
      [
        ...(downloads === undefined ? [] : downloadHostArguments()),
        ...(keys?.hostArguments ?? []),
      ],
      base,
    );
    started.push(baseHost.container);
    baseHosts[base] = baseHost.container;
    const baseConfig = sshConfigOf(runFolder, base);
    writeFileSync(
      baseConfig,
      harnessSshConfig(
        baseHost.port,
        runFolder,
        agentSocket,
        connectRunNetwork(command, runId, baseHost.container),
        controlFolderOf(runFolder),
      ),
    );
    await waitForHost(dependencies, baseConfig);
  }
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
  // Every launch of the table gets its installs, chosen or not, so every language pack file has to exist.
  for (const launch of editor === 'vscodium' ? launchesOf(root) : []) {
    if (launch.kind === 'plain' && launch.languagePack !== undefined) {
      dependencies.languagePackVsix(root, runFolder, launch.languagePack);
    }
  }
  const vscode = chosen.some(
    launch => launch.kind === 'plain' && launch.client === 'vscode',
  )
    ? await dependencies.vscodeExecutable(genuineVersion)
    : undefined;
  const installs = installsOf(
    root,
    runFolder,
    vsixFiles,
    editor === 'vscodium'
      ? launchesOf(root).filter(
          launch =>
            launch.kind !== 'plain' ||
            launch.client === undefined ||
            chosen.includes(launch),
        )
      : [],
  ).filter(install => install.files.length > 0);
  if (installs.length > 0) {
    const editorCommands = {
      vscodium:
        vscodium === undefined
          ? await dependencies.editorCli()
          : vscodiumCliOf(vscodium),
      vscode:
        vscode === undefined
          ? ''
          : resolveCliPathFromVSCodeExecutablePath(vscode),
    };
    // The editor's command line writes a log session as the editor does: into the run's folder, not the user's.
    const stateBefore = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateFolderOf(runFolder, 'install');
    try {
      for (const {folder, files, client} of installs) {
        checked(command, editorCommands[client], [
          `--extensions-dir=${folder}`,
          `--user-data-dir=${userDataFolderOf(runFolder)}`,
          `--shared-data-dir=${path.join(runFolder, 'shared-data')}`,
          ...files.flatMap(file => ['--install-extension', file]),
        ]);
      }
    } finally {
      if (stateBefore === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = stateBefore;
      }
    }
  }
  const launches = editor === 'vscodium' ? launchesOf(root) : [];
  for (const launch of launches) {
    if (launch.kind === 'plain' && launch.languagePack !== undefined) {
      registerLanguagePack(runFolder, launch, launch.languagePack);
    }
    if (launch.kind === 'plain' && launch.standIns !== undefined) {
      writeStandIns(runFolder, launch, standInEngines(root, launch));
    }
  }
  const devContainerImage = launches.some(needsDevContainerImage)
    ? devContainerImageFor(command, root, runId)
    : undefined;
  const registry = chosen.some(
    launch => launch.registry === true || launch.templates === true,
  )
    ? await dependencies.startRegistry(runId)
    : undefined;
  if (registry !== undefined) {
    stops.push(() => registry.stop());
  }
  const templateRegistry =
    registry !== undefined && chosen.some(launch => launch.templates === true)
      ? await dependencies.prepareTemplates(
          root,
          runFolder,
          registry.address,
          devContainerImage,
        )
      : undefined;
  const templateIndex = downloads?.variables.HARNESS_DOWNLOADS_LOCAL;
  const engineImage =
    podman && devContainerImage !== undefined
      ? loadImageIntoPodman(command, runId, runFolder)
      : undefined;
  return {
    REMOTE_OSS_ACCEPTANCE: '1',
    HARNESS_SSH_CONFIG: configFile,
    HARNESS_CONTAINER: host.container,
    ...(Object.keys(baseHosts).length === 0
      ? {}
      : {HARNESS_HOST_CONTAINERS: JSON.stringify(baseHosts)}),
    HARNESS_ROUTED_ADDRESS: routedAddress,
    HARNESS_RUN_FOLDER: runFolder,
    HARNESS_RUN_ID: runId,
    ...(devContainerImage === undefined
      ? {}
      : {HARNESS_DEVCONTAINER_IMAGE: devContainerImage}),
    ...(podman ? {HARNESS_ENGINE: 'podman' as const} : {}),
    ...(engineImage === undefined ? {} : {HARNESS_ENGINE_IMAGE: engineImage}),
    ...(registry === undefined ? {} : {HARNESS_REGISTRY: registry.address}),
    ...(templateRegistry === undefined || templateIndex === undefined
      ? {}
      : {
          HARNESS_TEMPLATE_REGISTRY: templateRegistry,
          REMOTE_OSS_TEMPLATE_INDEX: `${templateIndex}/templates/devcontainer-index.json`,
          REMOTE_OSS_CONTROL_MANIFEST: `${templateIndex}/control/devcontainer-control-manifest.json`,
        }),
    HARNESS_PASSWORD_FILE: host.passwordFile,
    HARNESS_TOTP_FILE: host.totpFile,
    REMOTE_OSS_ACCEPTANCE_SCRIPT: path.join(runFolder, 'script.json'),
    REMOTE_OSS_ACCEPTANCE_RECORD: path.join(runFolder, 'record.jsonl'),
    REMOTE_OSS_ACCEPTANCE_SIGNALS: path.join(runFolder, 'signals'),
    HARNESS_VSIX_FILES: vsixFiles.join(path.delimiter),
    HARNESS_EDITOR: editor,
    REMOTE_OSS_ACCEPTANCE_LOG: path.join(runFolder, 'log.txt'),
    ...(vscodium === undefined ? {} : {HARNESS_VSCODIUM_EXECUTABLE: vscodium}),
    HARNESS_EDITOR_VERSION: EDITOR_VERSION,
    ...(vscode === undefined
      ? {}
      : {
          HARNESS_VSCODE_EXECUTABLE: vscode,
          HARNESS_GENUINE_VERSION: genuineVersion,
        }),
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
  sweepStaleRunObjects(command, runId, Date.now() / 1000);
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
 * A launch with host setup runs it on its own host before each attempt (the harness host, or the host of its
 * `hostBase` in `baseContainers`), and waits the helper's grace after the launch before it, so its resolve finds no
 * live helper of the run.
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
  report: (line: string) => void = line => {
    console.log(line);
  },
  lock: LaunchLock = NO_LOCK,
  baseContainers: Readonly<Partial<Record<HostBase, string>>> = {},
): Promise<number[]> {
  const exitCodes: number[] = [];
  // The harness host starts with the update service's name pinned to the download host.
  let pinned = true;
  for (const launch of launches) {
    if (launch !== undefined) {
      // The line a log reader splits the run's output at: tools/flake-ledger.ts reads each launch's rows after it.
      report(`acceptance: launch ${launch.label}`);
    }
    if (launch?.hostSetup !== undefined) {
      // The helper of the previous launch ends HELPER_GRACE_MILLISECONDS after its window; a live one would be
      // reused by this resolve without any check, so the run waits the grace out.
      await sleep(FRESH_RESOLVE_WAIT_MILLISECONDS);
    }
    // A launch of dev containers holds the daemon's lock through all its attempts: see acceptance-lock.ts.
    const locked =
      launch !== undefined && launchGroupOf(launch) === 'containers';
    if (locked) {
      await lock.take();
    }
    try {
      exitCodes.push(await runAttempts(launch));
    } finally {
      if (locked) {
        lock.release();
      }
    }
  }
  return exitCodes;

  /** The container of the host the launch's window connects to: the harness host, or the run's host of its base. */
  function hostContainerOf(launch: Launch): string {
    if (launch.hostBase === undefined) {
      return container;
    }
    const based = baseContainers[launch.hostBase];
    if (based === undefined) {
      throw new Error(
        `${launch.label}: the run started no host of base ${launch.hostBase}`,
      );
    }
    return based;
  }

  /** The launch's attempts (one, or two after a hung window). */
  function runAttempts(launch: Launch | undefined): Promise<number> {
    return runWithRetry(async () => {
      // Each attempt starts from the base settings plus the launch's own, not from what a failed attempt left.
      if (launch !== undefined) {
        const wanted = launch.publisherDownloads !== true;
        if (wanted !== pinned) {
          runHostSetup(command, container, [
            {command: updateServicePinCommand(wanted)},
          ]);
          pinned = wanted;
          report(
            `acceptance: the harness host resolves ${UPDATE_SERVICE_NAME} ${wanted ? 'to the download host' : 'through DNS'}`,
          );
        }
        if (launch.hostSetup !== undefined) {
          runHostSetup(command, hostContainerOf(launch), launch.hostSetup);
        }
        writeUserSettings(
          runFolder,
          launch.hostBase === undefined
            ? configFile
            : sshConfigOf(runFolder, launch.hostBase),
          withRunTokens(
            withHarnessBases(settingsOfLaunch(launch), bases),
            runFolder,
            process.env.PATH ?? '',
          ),
          launch,
        );
        await beforeAttempt(launch);
      }
      const held = await holdPorts(launch?.clientListeners ?? []);
      try {
        return await runLaunch(launch);
      } finally {
        await held.release();
        // A helper that left the editor's process tree outlives the editor: the attempt stops what it started.
        stopHelpersUnder(userDataFolderOf(runFolder, launch), command);
      }
    }, report);
  }
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
  const genuine = genuineVersionIn(process.env);
  if (typeof genuine === 'object') {
    console.error(`acceptance: ${genuine.problem}`);
    return 2;
  }
  const genuineVersion = genuine;
  if (
    genuineVersion !== EDITOR_VERSION &&
    chosen.some(launch => launch.label === 'ssh-no-proposals')
  ) {
    console.error(
      'acceptance: ssh-no-proposals runs at the recorded version only',
    );
    return 2;
  }
  const refusal = publisherDownloadsRefusal(chosen, process.env);
  if (refusal !== undefined) {
    console.error(`acceptance: ${refusal}`);
    return 2;
  }
  const runId = acceptanceRunId(process.env, process.pid);
  // The run id in the name lets the clean-up find the editor of a run that was killed.
  const runFolder = mkdtempSync(path.join(tmpdir(), `acceptance-${runId}-`));
  const started: string[] = [];
  const stops: Array<() => Promise<void>> = [];
  const startedSeconds = Date.now() / 1000;
  let exitCode = 1;
  try {
    const variables = await prepare(
      root,
      dependencies,
      runFolder,
      started,
      editor,
      stops,
      chosen,
      genuineVersion,
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
            ? dependencies.runPlain(
                root,
                {
                  ...variables,
                  ...hostBaseVariables(
                    launch,
                    {...variables},
                    variables.HARNESS_RUN_FOLDER,
                  ),
                },
                launch,
              )
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
        undefined,
        undefined,
        daemonLock(
          dependencies.command,
          variables.HARNESS_RUN_ID,
          {
            now: Date.now,
            sleep: dependencies.sleep,
            hostName: hostname(),
            processAlive: nodeProcessAlive,
          },
          line => {
            console.log(line);
          },
        ),
        baseContainersOf({...variables}),
      )),
    );
    exitCode = exitCodes.find(code => code !== 0) ?? 0;
  } catch (error) {
    console.error(`acceptance: ${failureText(error)}`);
    exitCode = 1;
  } finally {
    for (const container of started) {
      dependencies.command('docker', ['rm', '--force', container]);
    }
    for (const stop of stops) {
      await stop();
    }
    // What the rows made under the run's label goes too, before the run folder, since it also ends an editor still on
    // one of the run's user-data folders. A failed clean-up fails the run, and an earlier failure keeps its code.
    const cleanUps = [
      () => {
        cleanRun(dependencies.command, runId);
      },
      ...(chosen.some(launch => launch.engine === 'podman')
        ? [
            () => {
              cleanPodmanRun(dependencies.command, runId, startedSeconds);
            },
          ]
        : []),
    ];
    for (const cleanUp of cleanUps) {
      try {
        cleanUp();
      } catch (error) {
        console.error(`acceptance: ${failureText(error)}`);
        exitCode = exitCode === 0 ? 1 : exitCode;
      }
    }
    rmSync(runFolder, {recursive: true, force: true});
    removeBundles(root);
  }
  return exitCode;
}

/**
 * The version of VS Code the genuine launches run: the job's `HARNESS_GENUINE_VERSION`, the recorded version when it
 * is unset, or the problem when it names a version the run does not take.
 */
export function genuineVersionIn(
  environment: Readonly<Record<string, string | undefined>>,
): string | {problem: string} {
  const named = environment.HARNESS_GENUINE_VERSION;
  const version = named === undefined || named === '' ? EDITOR_VERSION : named;
  return GENUINE_VERSIONS.includes(version)
    ? version
    : {
        problem: `HARNESS_GENUINE_VERSION must be ${GENUINE_VERSIONS.join(' or ')}`,
      };
}

/** The id of the workflow job that alone makes a launch with `publisherDownloads`, as Actions gives it in `GITHUB_JOB`. */
export const GENUINE_JOB = 'acceptance-genuine';

/**
 * Why the run refuses its launches, when one of them takes its server from the editor's publisher or accepts its
 * licence outside the genuine job: the run takes such a launch only under Actions, in that job, with the version named.
 * Anyone can set the three variables, so this guards against an accident, not against intent.
 */
export function publisherDownloadsRefusal(
  launches: readonly Launch[],
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const named = environment.HARNESS_GENUINE_VERSION;
  const labels = launches
    .filter(launch => launch.publisherDownloads === true)
    .map(launch => launch.label);
  const genuineJob =
    environment.GITHUB_ACTIONS === 'true' &&
    environment.GITHUB_JOB === GENUINE_JOB &&
    named !== undefined &&
    named !== '';
  return labels.length === 0 || genuineJob
    ? undefined
    : `${labels.join(', ')}: a launch that takes the server from the editor's publisher or accepts its licence runs only in the genuine CI job (D-104): GITHUB_ACTIONS true, GITHUB_JOB ${GENUINE_JOB} and HARNESS_GENUINE_VERSION set`;
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
    env: {
      ...environment,
      ...editorLogsEnvironment(stateFolderOf(runFolder, 'runner'), undefined),
      HARNESS_USER_DATA: userDataFolderOf(runFolder),
    },
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
  const launchEnvironment = withRunTokens(
    launch.environment,
    runFolder,
    environment.PATH ?? '',
  );
  const env: Record<string, string | undefined> = {
    ...environment,
    ...editorLogsEnvironment(
      stateFolderOf(runFolder, launch.label),
      launchEnvironment,
    ),
    REMOTE_OSS_ACCEPTANCE_LOG: files.logFile,
    REMOTE_OSS_ACCEPTANCE_WINDOWS: path.join(
      runFolder,
      launch.label,
      'agent',
      'pids',
    ),
    HARNESS_USER_DATA: userDataFolderOf(runFolder),
    ...hostBaseVariables(launch, environment, runFolder),
    ...(launch.ownScript === true
      ? {
          REMOTE_OSS_ACCEPTANCE_SCRIPT: files.script,
          REMOTE_OSS_ACCEPTANCE_RECORD: files.record,
        }
      : {}),
    ...launchEnvironment,
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
  return resolveCliPathFromVSCodeExecutablePath(
    await vscodeExecutable(EDITOR_VERSION),
  );
}

/** The VS Code executable at the version under test, downloaded when it is missing, with one retry. */
async function vscodeExecutable(version: string): Promise<string> {
  return await withOneRetry(
    () => downloadAndUnzipVSCode(version),
    delay,
    console.log.bind(console),
  );
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
  limits?: LaunchLimits,
): Promise<AttemptResult> {
  return new Promise<AttemptResult>((resolve, reject) => {
    const child = spawn(program, [...programArguments], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let lastOutput = Date.now();
    let resultsAt: number | undefined;
    let tail = '';
    let ended: string | undefined;
    let resultsStand = false;
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        const text = chunk.toString('utf8');
        echo(text);
        lastOutput = Date.now();
        tail = (tail + text).slice(-RESULTS_TAIL_LENGTH);
        if (resultsAt === undefined && RESULTS_LINE.test(tail)) {
          resultsAt = lastOutput;
        }
      });
    }
    const watch =
      limits === undefined
        ? undefined
        : setInterval(() => {
            const reason = boundReached(
              limits,
              Date.now(),
              lastOutput,
              resultsAt,
            );
            if (reason === undefined) {
              return;
            }
            clearInterval(watch);
            // Past its results, the rows have run: a slow quit ends the processes, and the rows' result stands.
            resultsStand = resultsAt !== undefined;
            ended = `acceptance: ${reason}; the launch's processes were ended${resultsStand ? ", and its rows' result stands" : ''}\n`;
            echo(ended);
            child.kill('SIGKILL');
            limits.endLeftovers();
          }, limits.checkMilliseconds);
    child.on('close', (code: number | null) => {
      clearInterval(watch);
      const output = Buffer.concat(chunks).toString('utf8');
      resolve(
        ended === undefined
          ? {exitCode: code ?? 1, output}
          : {
              exitCode: resultsStand && !FAILING_LINE.test(output) ? 0 : 1,
              output: output + ended,
            },
      );
    });
    child.on('error', reject);
  });
}

/** How long a launch may go on: past its results, and with nothing printed; and what ends what it left running. */
export interface LaunchLimits {
  /** How long the editor may take to end after mocha's results line ("N passing (…)"). */
  afterResultsMilliseconds: number;
  /** How long the launch may print nothing at all. */
  quietMilliseconds: number;
  /** How often the limits are checked. */
  checkMilliseconds: number;
  /** Ends what the launch's process leaves behind once it is killed: an editor still on one of the run's profiles. */
  endLeftovers: () => void;
}

/** Mocha's results line, which a launch prints once all its rows have run. */
const RESULTS_LINE = /^\s*\d+ passing \(/m;

/** Mocha's line for the rows that failed, which follows its results line when any did. */
const FAILING_LINE = /^\s*\d+ failing$/m;

/** How much of the output's end is kept to find the results line across two chunks. */
const RESULTS_TAIL_LENGTH = 400;

/**
 * Why a launch is over its limits at `now`, or undefined: its editor has not ended `afterResultsMilliseconds` after
 * its results line, or it has printed nothing for `quietMilliseconds`.
 */
export function boundReached(
  limits: Pick<LaunchLimits, 'afterResultsMilliseconds' | 'quietMilliseconds'>,
  now: number,
  lastOutput: number,
  resultsAt: number | undefined,
): string | undefined {
  if (
    resultsAt !== undefined &&
    now - resultsAt >= limits.afterResultsMilliseconds
  ) {
    return `the editor had not ended ${String(limits.afterResultsMilliseconds / 1000)} s after its results`;
  }
  if (now - lastOutput >= limits.quietMilliseconds) {
    return `nothing was printed for ${String(limits.quietMilliseconds / 1000)} s`;
  }
  return undefined;
}

/**
 * A launch's limits on a run: a minute for the editor to end after its results (it ends within seconds once no row
 * leaves a timer running), twenty minutes of silence (a row's own limit is at most ten), checked every five
 * seconds. What is left is any editor on one of the run's profile folders, the runner launches' shared one or a plain
 * launch's own (`user-data-<label>`, labels being lower-case letters, digits and hyphens).
 */
export function launchLimits(
  runFolder: string,
  command: CommandRunner,
): LaunchLimits {
  return {
    afterResultsMilliseconds: 60_000,
    quietMilliseconds: 20 * 60_000,
    checkMilliseconds: 5000,
    endLeftovers: () => {
      command('pkill', [
        '-KILL',
        '-f',
        '--',
        `${path.join(runFolder, 'user-data')}(-[a-z0-9-]+)?( |$)`,
      ]);
    },
  };
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
    undefined,
    launchLimits(variables.HARNESS_RUN_FOLDER, runCommand),
  );
}

/** The executable a plain launch starts: VS Code for a launch that names it as its client, the run's VSCodium otherwise. */
export function editorExecutableOf(
  variables: HarnessVariables,
  launch: Launch,
): string {
  return (
    (launch.kind === 'plain' && launch.client === 'vscode'
      ? variables.HARNESS_VSCODE_EXECUTABLE
      : variables.HARNESS_VSCODIUM_EXECUTABLE) ?? ''
  );
}

/** What a run prints when its arguments are not understood. */
export const USAGE =
  'usage: node tools/acceptance.ts [--editor vscode|vscodium [--launches all|none|<entry>,...]], an entry being a ' +
  'label, all, @<group> or !<label>|!@<group>';

/** The launches one entry of a selection names: a label, `all`, or `@<group>`; none for an unknown name. */
function launchesNamed(
  launches: readonly Launch[],
  name: string,
): Launch[] | undefined {
  if (name === 'all') {
    return launches.filter(launch => launch.namedOnly !== true);
  }
  if (name.startsWith('@')) {
    const group = LAUNCH_GROUPS.find(each => `@${each}` === name);
    return group === undefined
      ? undefined
      : launches.filter(launch => launchGroupOf(launch) === group);
  }
  // A launch run in parts is named by the launch it is a part of.
  const named = launches.filter(
    launch =>
      launch.label === name ||
      (launch.kind === 'plain' && launch.partOf === name),
  );
  return named.length === 0 ? undefined : named;
}

/**
 * The launches a run makes, in the run's order: every one that is not `namedOnly` when `selected` is undefined, else
 * what its entries name, each in turn. An entry is a label, `all`, or `@<group>` (every launch of the group, a
 * `namedOnly` one included), and `!` before one takes out what the entries before it put in. An entry that names
 * nothing known gives an error text naming the known labels and groups.
 */
export function chosenLaunches(
  launches: readonly Launch[],
  selected: readonly string[] | undefined,
): Launch[] | string {
  if (selected === undefined) {
    return launches.filter(launch => launch.namedOnly !== true);
  }
  const chosen = new Set<Launch>();
  const unknown: string[] = [];
  for (const entry of selected) {
    const removing = entry.startsWith('!');
    const name = removing ? entry.slice(1) : entry;
    const named = launchesNamed(launches, name);
    if (named === undefined) {
      unknown.push(entry);
      continue;
    }
    for (const launch of named) {
      if (removing) {
        chosen.delete(launch);
      } else {
        chosen.add(launch);
      }
    }
  }
  if (unknown.length > 0) {
    const known = launches.map(launch => launch.label);
    const groups = LAUNCH_GROUPS.map(group => `@${group}`);
    return `unknown launch label(s): ${unknown.join(', ')}; the known ones: ${known.join(', ')}; the groups: ${groups.join(', ')}`;
  }
  return launches.filter(launch => chosen.has(launch));
}

/** The line a selected run prints: the launches it makes, with their groups, and the ones it skips. */
export function selectionLine(
  launches: readonly Launch[],
  chosen: readonly Launch[],
): string {
  const made = chosen.map(launch => launch.label);
  const skipped = launches
    .map(launch => launch.label)
    .filter(label => !made.includes(label));
  const groups = LAUNCH_GROUPS.filter(group =>
    chosen.some(launch => launchGroupOf(launch) === group),
  ).map(group => `@${group}`);
  return made.length === 0
    ? `no launch reachable: none made, ${String(skipped.length)} skipped`
    : `launches made (${String(made.length)}, groups ${groups.join(', ')}): ${made.join(', ')}; skipped (${String(skipped.length)}): ${skipped.join(', ') || '-'}`;
}

/** Prints the launches a selected run makes and skips, and adds them to the job's summary when there is one. */
function reportSelection(
  launches: readonly Launch[],
  chosen: readonly Launch[],
): void {
  const text = selectionLine(launches, chosen);
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
  const stale =
    parsed === undefined
      ? undefined
      : staleRefusal(REPOSITORY_ROOT, packagedExtensions(REPOSITORY_ROOT));
  if (parsed === undefined) {
    console.error(USAGE);
    process.exitCode = 2;
  } else if (stale !== undefined) {
    console.error(`acceptance: refused: ${stale}`);
    process.exitCode = 2;
  } else {
    process.exitCode = await runAcceptance(
      REPOSITORY_ROOT,
      {
        command: runCommand,
        sleep: delay,
        bundleSuite,
        editorCli,
        vscodeExecutable,
        vscodiumExecutable: vscodiumExecutableOf.bind(
          undefined,
          REPOSITORY_ROOT,
          process.platform,
          process.arch,
          {download: downloadWithRetry, unpack: unpackArchive},
        ),
        runTests: runTestCli,
        windowAgentVsix: packageWindowAgent,
        languagePackVsix: packageLanguagePack,
        startAgent: startRunAgent,
        startRegistry: runId =>
          startRunRegistry(runCommand, SYSTEM_CLOCK, runId),
        prepareTemplates: (root, runFolder, address, devContainerImage) =>
          prepareRunTemplates(
            runCommand,
            root,
            runFolder,
            address,
            ghcrLayer,
            undefined,
            devContainerImage,
          ),
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
              executable: editorExecutableOf(variables, launch),
              environment: {...process.env, ...variables},
            },
            launch,
            {
              start: startDetached,
              runTests: program =>
                runAndCollect(
                  program.file,
                  program.programArguments,
                  {cwd: root, env: program.environment},
                  undefined,
                  launchLimits(variables.HARNESS_RUN_FOLDER, runCommand),
                ),
            },
          ),
      },
      parsed.editor,
      parsed.launches,
    );
  }
}
