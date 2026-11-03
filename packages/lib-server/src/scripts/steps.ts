/**
 * @fileoverview The bootstrap steps as data, the same for every interpreter: what a script is asked to do, the
 * parameters it is given, the roles of the helper functions it defines, and the words of the server's start. Each
 * interpreter's script renders these in its own language and ends in the same result block.
 */

import type {Interpreter} from 'lib-host';
import type {Cleanup, InstallUmask} from '../policy/record.ts';
import type {ScriptStatus} from './result-block.ts';

/** The steps of a single-script install. */
export type ScriptStep =
  | 'probe'
  | 'install'
  | 'discard'
  | 'start'
  | 'installExtensions'
  | 'installCli'
  | 'startCli'
  | 'stopCli'
  | 'kill'
  | 'uninstall'
  | 'cleanup';

/** The extra actions of a stepwise install, in the order they run. */
export type StepwiseAction = 'prepare' | 'unpack' | 'activate';

/** What a script is asked to do: a step, in one of the two install modes. */
export type BootstrapRequest =
  | {installMode: 'singleScript'; step: ScriptStep}
  | {
      installMode: 'stepwise';
      step:
        | Exclude<ScriptStep, 'install' | 'installCli' | 'startCli' | 'stopCli'>
        | StepwiseAction;
    };

/** The proxy variables to export when the host's own environment sets none, as the final text. */
export interface ProxyVariables {
  http: string;
  https: string;
}

/** The options of one server start. */
export interface StartParameters {
  bindHost: string;
  /** A port, or a range such as `8000-9000`; `0` lets the server choose. */
  port: string;
  /** Whether the user has accepted the server's licence terms. */
  licenceAccepted: boolean;
  /** Seconds of reconnection grace; 0 passes no option. */
  graceSeconds: number;
  /** Extensions the server installs when it starts, and the ones the `installExtensions` step installs. */
  extensions: readonly string[];
  /** The polling interval of the file watcher in milliseconds, when the policy allows it; 0 for none. */
  fileWatcherPollingMilliseconds: number;
  /** Whether the server starts in host-proxy mode, when the policy allows it. */
  useHostProxy: boolean;
  /** Whether the server leaves the user's login-shell environment to the extension, when the policy allows it. */
  forceDisableUserEnv: boolean;
  /** Whether the server's own requirements helper runs before a launch (policy `bundledHelper`). */
  requirementsHelper: boolean;
  /** How many seconds the start waits for the ready line before it fails. */
  readySeconds: number;
  /** Whether the server listens on a socket in the host's temporary folder instead of a TCP port. */
  socketMode: boolean;
}

/** Where the CLI lives on the host: its file name in the data folder and its own data folder. */
interface CliParameters {
  /** `<applicationName>-<commit>`, the CLI's file name in the data folder. */
  name: string;
  /** The CLI's `--cli-data-dir`. */
  dataFolder: string;
  /** The process `stopCli` ends, the one `startCli` reported; absent for the other steps. */
  stopProcessId?: number;
}

/** Everything a script needs, as data; nothing in it is specific to one product. */
export interface ScriptParameters {
  /** The folder that holds the data folder; empty for the user's home. */
  installRoot: string;
  /** The name of the data folder under the install root. */
  dataFolderName: string;
  /** The launcher's path inside an installed server folder. */
  launcher: string;
  commit: string;
  /** Where the host downloads the archive from. */
  archiveUrl: string;
  /** An archive already on the host, used instead of a download; empty for none. */
  archivePath: string;
  /**
   * Whether the archive at `archivePath` is deleted when the script ends, whatever its status, except while the host
   * lock is busy and the step is tried again.
   */
  removeArchive: boolean;
  archiveFormat: 'tar.gz' | 'zip';
  /** The epoch milliseconds that name the staging folder of a stepwise install. */
  epochMilliseconds: number;
  /**
   * V9's server tree the install extracts into and `bin/<commit>` links to; empty for a server installed in the data
   * folder.
   */
  installTree: string;
  proxy: ProxyVariables;
  downloader: {
    /** Whether `curl` and `wget` read their configuration files. */
    useConfigurationFiles: boolean;
    timeoutSeconds: number;
  };
  lock: {
    method: 'flock' | 'link';
    /** Whether the lock file goes in /tmp rather than in the install folder. */
    inTemporaryFolder: boolean;
    /** The lock file's name before the commit: `<prefix>.<commit>`. */
    filePrefix: string;
  };
  /** A host path to source before an install or a start; empty for none. */
  environmentSetup: string;
  /** The umask the install and start scripts apply, or the umask they inherit. */
  installUmask: InstallUmask;
  cleanup: Cleanup;
  start: StartParameters;
  /** The CLI's place, for the steps `installCli` and `startCli`; absent for every other step. */
  cli?: CliParameters;
}

/**
 * A status or a fact key a step may end with; one only its interpreter's script reports names that interpreter. A
 * fact key with a part that varies writes it as `<tool>`, `<n>` or `<line>`.
 */
export type StepOutcome<K extends string> = K | {key: K; only: Interpreter};

/** The statuses and the fact keys one step may end with, over both scripts. */
export interface StepOutcomes {
  statuses: ReadonlyArray<StepOutcome<ScriptStatus>>;
  facts: ReadonlyArray<StepOutcome<string>>;
}

const POSIX_ONLY = 'posixShell';
const POWERSHELL_ONLY = 'powershell';

/** What an install's lock reports when it is busy or cannot be written. */
const LOCK_FACTS = [
  'server.lockPath',
  'server.lockInTemporary',
  'server.writeFailedPath',
  'server.writeFailedError',
] as const;

/** What an install of the server or the CLI reports: its lock, its download and its times. */
const INSTALL_OUTCOMES: StepOutcomes = {
  statuses: [
    'Ok',
    'LockBusy',
    'CreateInstallDirFailed',
    'ServerDownloadFailed',
    'UnpackFailed',
    {key: 'NoDownloaderAvailable', only: POSIX_ONLY},
  ],
  facts: [
    ...LOCK_FACTS,
    'server.downloadStatus',
    'timing.download',
    'timing.install',
  ],
};

/**
 * The statuses and fact keys each step may end with, over both scripts. A row holds every rendered script of either
 * interpreter to its step's entry, so the two scripts cannot drift apart.
 */
export const STEP_OUTCOMES: Readonly<
  Record<BootstrapRequest['step'], StepOutcomes>
> = {
  probe: {
    statuses: ['Ok', 'UnsupportedPlatform', 'UnsupportedArch'],
    facts: [
      'host.tmp',
      'host.home',
      'host.os',
      'host.arch',
      'host.libc',
      'host.kernel',
      'host.release',
      'host.tool.<tool>',
      'host.wgetBusybox',
      'host.shell',
      'host.sshAuthSock',
      'host.display',
      'server.installDir',
      'server.installed',
      'server.treeComplete',
    ],
  },
  install: {
    statuses: [
      ...INSTALL_OUTCOMES.statuses,
      {key: 'ServerFailedToStart', only: POWERSHELL_ONLY},
    ],
    facts: [
      ...INSTALL_OUTCOMES.facts,
      'server.installDir',
      {key: 'server.treeInstalled', only: POSIX_ONLY},
      {key: 'server.installLink', only: POSIX_ONLY},
      {key: 'host.note', only: POWERSHELL_ONLY},
    ],
  },
  installCli: {
    statuses: INSTALL_OUTCOMES.statuses,
    facts: [...INSTALL_OUTCOMES.facts, 'cli.path'],
  },
  discard: {statuses: ['Ok'], facts: []},
  prepare: {
    statuses: ['Ok', 'CreateInstallDirFailed'],
    facts: ['server.stagingDir'],
  },
  unpack: {statuses: ['Ok', 'UnpackFailed'], facts: []},
  activate: {statuses: ['Ok', 'UnpackFailed'], facts: ['server.installDir']},
  start: {
    statuses: [
      'Ok',
      'LockBusy',
      'CreateInstallDirFailed',
      'ServerFailedToStart',
      {key: 'LinuxPrereqs', only: POSIX_ONLY},
    ],
    facts: [
      ...LOCK_FACTS,
      'server.launching',
      'server.port',
      'server.pid',
      'server.token',
      'server.log',
      'server.reused',
      'server.failure',
      'host.kernel',
      'timing.start',
      {key: 'server.socketPath', only: POSIX_ONLY},
      {key: 'server.socketFolderFallback', only: POSIX_ONLY},
      {key: 'server.installLink', only: POSIX_ONLY},
      {key: 'server.prerequisitesHelper', only: POSIX_ONLY},
      {key: 'server.prerequisites.<line>', only: POSIX_ONLY},
      {key: 'host.note', only: POWERSHELL_ONLY},
    ],
  },
  installExtensions: {
    statuses: ['Ok', 'ServerFailedToStart'],
    facts: ['server.extension.<n>.status', 'server.extension.<n>.message'],
  },
  startCli: {
    statuses: ['Ok', 'ServerFailedToStart'],
    facts: [
      'cli.port',
      'cli.pid',
      'cli.log',
      'cli.connectionToken',
      'cli.tokenMissing',
      'cli.tokenInvalid',
      {key: 'cli.parent', only: POWERSHELL_ONLY},
    ],
  },
  stopCli: {statuses: ['Ok'], facts: ['cli.stopped']},
  kill: {statuses: ['Ok'], facts: []},
  uninstall: {statuses: ['Ok'], facts: []},
  cleanup: {
    statuses: ['Ok', 'LockBusy', 'CreateInstallDirFailed'],
    facts: [...LOCK_FACTS],
  },
};

/** The statuses or fact keys of `outcomes` that the interpreter's script may report. */
export function outcomesFor<K extends string>(
  outcomes: ReadonlyArray<StepOutcome<K>>,
  interpreter: Interpreter,
): K[] {
  return outcomes.flatMap(outcome =>
    typeof outcome === 'string'
      ? [outcome]
      : outcome.only === interpreter
        ? [outcome.key]
        : [],
  );
}

/** The roles of the helper functions a script defines; each interpreter's script has its own text for each role. */
export type FunctionRole =
  | 'common'
  | 'environment'
  | 'lock'
  | 'busybox'
  | 'fetch'
  | 'unpack'
  | 'leave'
  | 'process'
  | 'secretToken'
  | 'serverTree'
  | 'stop'
  | 'cliStart'
  | 'folderKind'
  | 'tree';

/** The roles each step needs, in the order its script defines them, so that a script holds only what it uses. */
const STEP_ROLES: Readonly<
  Record<BootstrapRequest['step'], readonly FunctionRole[]>
> = {
  probe: ['common', 'busybox'],
  install: [
    'common',
    'environment',
    'lock',
    'busybox',
    'fetch',
    'unpack',
    'leave',
  ],
  discard: ['common'],
  prepare: ['common'],
  unpack: ['common', 'unpack'],
  activate: ['common'],
  start: ['common', 'environment', 'lock', 'process', 'secretToken', 'leave'],
  installExtensions: ['common', 'environment'],
  installCli: [
    'common',
    'environment',
    'lock',
    'busybox',
    'fetch',
    'unpack',
    'leave',
  ],
  startCli: ['common', 'cliStart', 'secretToken'],
  stopCli: ['common'],
  kill: ['common', 'process', 'serverTree', 'stop'],
  uninstall: ['common', 'process', 'serverTree', 'stop'],
  cleanup: ['common', 'lock', 'folderKind'],
};

/** The roles of one request's script: its step's, and the tree's when an install or a start uses a server tree. */
export function rolesOf(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): readonly FunctionRole[] {
  const usesTree =
    parameters.installTree !== '' &&
    (request.step === 'install' || request.step === 'start');
  return usesTree
    ? [...STEP_ROLES[request.step], 'tree']
    : STEP_ROLES[request.step];
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

/** The parameters every script is given, by name, in the order the script assigns them, each as its text. */
export function parameterValuesOf(
  parameters: ScriptParameters,
): ReadonlyArray<readonly [string, string]> {
  const {start, cleanup} = parameters;
  const values: ReadonlyArray<readonly [string, string | number]> = [
    ['INSTALL_ROOT', parameters.installRoot],
    ['DATA_FOLDER', parameters.dataFolderName],
    ['LAUNCHER', parameters.launcher],
    ['COMMIT', parameters.commit],
    ['ARCHIVE_URL', parameters.archiveUrl],
    ['ARCHIVE_PATH', parameters.archivePath],
    ['ARCHIVE_REMOVE', yesNo(parameters.removeArchive)],
    ['ARCHIVE_FORMAT', parameters.archiveFormat],
    ['STAGING_SUFFIX', parameters.epochMilliseconds],
    ['INSTALL_TREE', parameters.installTree],
    ['PROXY_HTTP', parameters.proxy.http],
    ['PROXY_HTTPS', parameters.proxy.https],
    [
      'USE_CONFIGURATION_FILES',
      yesNo(parameters.downloader.useConfigurationFiles),
    ],
    ['DOWNLOAD_SECONDS', parameters.downloader.timeoutSeconds],
    ['LOCK_METHOD', parameters.lock.method],
    ['LOCK_IN_TEMPORARY', yesNo(parameters.lock.inTemporaryFolder)],
    ['LOCK_PREFIX', parameters.lock.filePrefix],
    ['ENVIRONMENT_SETUP', parameters.environmentSetup],
    ['INSTALL_UMASK', parameters.installUmask],
    ['CLEANUP_KIND', cleanup.kind],
    ['KEEP_COUNT', cleanup.kind === 'keepNewest' ? cleanup.count : 0],
    ['BIND_HOST', start.bindHost],
    ['SERVER_PORT', start.port],
    ['REQUIREMENTS_HELPER', yesNo(start.requirementsHelper)],
    ['READY_SECONDS', start.readySeconds],
    ['SOCKET_MODE', yesNo(start.socketMode)],
    ['CLI_NAME', parameters.cli?.name ?? ''],
    ['CLI_DATA', parameters.cli?.dataFolder ?? ''],
    ['CLI_STOP_PID', parameters.cli?.stopProcessId ?? ''],
  ];
  return values.map(([name, value]) => [name, String(value)]);
}

/** One word of the server's start: a fixed text, or a file the script names in a variable of its own. */
export type StartWord =
  {text: string} | {variable: 'SOCKET_FILE' | 'TOKEN_FILE'};

/** The words the server starts with: the endpoint, the token file, and the options the start parameters ask for. */
export function startWordsOf(start: StartParameters): readonly StartWord[] {
  const endpoint: readonly StartWord[] = start.socketMode
    ? [{text: '--socket-path'}, {variable: 'SOCKET_FILE'}]
    : [
        {text: '--host'},
        {text: start.bindHost},
        {text: '--port'},
        {text: start.port},
      ];
  const options = [
    '--telemetry-level',
    'off',
    '--enable-remote-auto-shutdown',
    ...(start.licenceAccepted ? ['--accept-server-license-terms'] : []),
    ...(start.graceSeconds > 0
      ? ['--reconnection-grace-time', String(start.graceSeconds)]
      : []),
    ...start.extensions.flatMap(extension => [
      '--install-extension',
      extension,
    ]),
    ...(start.fileWatcherPollingMilliseconds > 0
      ? ['--file-watcher-polling', String(start.fileWatcherPollingMilliseconds)]
      : []),
    ...(start.useHostProxy ? ['--use-host-proxy'] : []),
    ...(start.forceDisableUserEnv ? ['--force-disable-user-env'] : []),
  ];
  return [
    {text: '--start-server'},
    ...endpoint,
    {text: '--connection-token-file'},
    {variable: 'TOKEN_FILE'},
    ...options.map(text => ({text})),
  ];
}
