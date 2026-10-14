/**
 * @fileoverview The bootstrap scripts of the server lifecycle: for each step, the text of one script that runs on
 * the host and ends with a result block. Only the POSIX `sh` script exists; the PowerShell script answers with a
 * clear failure until it has been captured on a Windows host.
 */

import type {Interpreter} from 'lib-host';
import type {Cleanup} from '../policy/record.ts';
import {
  BUSYBOX_FUNCTIONS,
  CLI_FUNCTIONS,
  COMMON_FUNCTIONS,
  ENVIRONMENT_FUNCTIONS,
  FETCH_FUNCTIONS,
  FOLDER_KIND_FUNCTIONS,
  LOCK_FUNCTIONS,
  SERVER_TREE_FUNCTIONS,
  PROCESS_FUNCTIONS,
  READY_LINE,
  shellQuote,
  STOP_FUNCTIONS,
  UNPACK_FUNCTIONS,
} from './posix-script.ts';
import {RESULT_BEGIN, RESULT_END} from './result-block.ts';

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
  cleanup: Cleanup;
  start: StartParameters;
  /** The CLI's place, for the steps `installCli` and `startCli`; absent for every other step. */
  cli?: CliParameters;
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function assignment(name: string, value: string | number): string {
  return `${name}=${shellQuote(String(value))}`;
}

function cleanupKind(cleanup: Cleanup): string {
  return cleanup.kind;
}

function keepCount(cleanup: Cleanup): number {
  return cleanup.kind === 'keepNewest' ? cleanup.count : 0;
}

/** The parameter block: one quoted assignment per value. */
function parameterBlock(parameters: ScriptParameters): string[] {
  const {start} = parameters;
  return [
    assignment('INSTALL_ROOT', parameters.installRoot),
    assignment('DATA_FOLDER', parameters.dataFolderName),
    assignment('LAUNCHER', parameters.launcher),
    assignment('COMMIT', parameters.commit),
    assignment('ARCHIVE_URL', parameters.archiveUrl),
    assignment('ARCHIVE_PATH', parameters.archivePath),
    assignment('ARCHIVE_REMOVE', yesNo(parameters.removeArchive)),
    assignment('ARCHIVE_FORMAT', parameters.archiveFormat),
    assignment('STAGING_SUFFIX', parameters.epochMilliseconds),
    assignment('PROXY_HTTP', parameters.proxy.http),
    assignment('PROXY_HTTPS', parameters.proxy.https),
    assignment(
      'USE_CONFIGURATION_FILES',
      yesNo(parameters.downloader.useConfigurationFiles),
    ),
    assignment('DOWNLOAD_SECONDS', parameters.downloader.timeoutSeconds),
    assignment('LOCK_METHOD', parameters.lock.method),
    assignment('LOCK_IN_TEMPORARY', yesNo(parameters.lock.inTemporaryFolder)),
    assignment('LOCK_PREFIX', parameters.lock.filePrefix),
    assignment('ENVIRONMENT_SETUP', parameters.environmentSetup),
    assignment('CLEANUP_KIND', cleanupKind(parameters.cleanup)),
    assignment('KEEP_COUNT', keepCount(parameters.cleanup)),
    assignment('BIND_HOST', start.bindHost),
    assignment('SERVER_PORT', start.port),
    assignment('READY_SECONDS', start.readySeconds),
    assignment('SOCKET_MODE', yesNo(start.socketMode)),
    assignment('CLI_NAME', parameters.cli?.name ?? ''),
    assignment('CLI_DATA', parameters.cli?.dataFolder ?? ''),
    assignment('CLI_STOP_PID', parameters.cli?.stopProcessId ?? ''),
  ];
}

/** The `set --` line that holds the server's start options, each as one quoted word. */
function startOptions(start: StartParameters): string {
  const endpoint = start.socketMode
    ? ['--socket-path', '"$SOCKET_FILE"']
    : ['--host', start.bindHost, '--port', start.port];
  const words = ['--start-server', ...endpoint, '--connection-token-file'];
  const tail = ['--telemetry-level', 'off', '--enable-remote-auto-shutdown'];
  const optional = [
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
  ];
  const quoted = [...words, '"$TOKEN_FILE"', ...tail, ...optional].map(word =>
    word.startsWith('"') ? word : shellQuote(word),
  );
  return `set -- ${quoted.join(' ')}`;
}

const GUARD: readonly string[] = [
  'if [ -n "${ZSH_VERSION:-}" ]; then',
  '  emulate sh',
  'fi',
];

const PROBE_BODY: readonly string[] = [
  'fact host.tmp "${TMPDIR:-/tmp}"',
  'fact host.home "${HOME:-}"',
  'OS_NAME=$(uname -s 2>/dev/null)',
  'case $OS_NAME in',
  '  Linux) HOST_OS=linux ;;',
  '  Darwin) HOST_OS=darwin ;;',
  '  *)',
  '    fact host.os "$OS_NAME"',
  '    finish UnsupportedPlatform',
  '    ;;',
  'esac',
  'fact host.os "$HOST_OS"',
  'MACHINE=$(uname -m 2>/dev/null)',
  'case $MACHINE in',
  '  x86_64) HOST_ARCH=x64 ;;',
  '  aarch64 | arm64) HOST_ARCH=arm64 ;;',
  '  armv7l | armv8l) HOST_ARCH=armhf ;;',
  '  ppc64le) HOST_ARCH=ppc64le ;;',
  '  riscv64) HOST_ARCH=riscv64 ;;',
  '  loongarch64) HOST_ARCH=loong64 ;;',
  '  s390x) HOST_ARCH=s390x ;;',
  '  *)',
  '    fact host.arch "$MACHINE"',
  '    finish UnsupportedArch',
  '    ;;',
  'esac',
  'fact host.arch "$HOST_ARCH"',
  'HOST_LIBC=unknown',
  'if [ "$HOST_OS" = linux ]; then',
  '  for LOADER in /lib/ld-musl-* /usr/lib/ld-musl-*; do',
  '    [ ! -e "$LOADER" ] || HOST_LIBC=musl',
  '  done',
  '  if [ "$HOST_LIBC" = unknown ] && have getconf && getconf GNU_LIBC_VERSION >/dev/null 2>&1; then',
  '    HOST_LIBC=glibc',
  '  fi',
  'fi',
  'fact host.libc "$HOST_LIBC"',
  'fact host.kernel "$(uname -r 2>/dev/null)"',
  'RELEASE_ID=$(. /etc/os-release >/dev/null 2>&1 </dev/null; echo "${ID:-}")',
  'fact host.release "${RELEASE_ID:-$OS_NAME}"',
  'for TOOL in wget curl tar unzip flock gzip; do',
  '  if have "$TOOL"; then',
  '    fact "host.tool.$TOOL" yes',
  '  else',
  '    fact "host.tool.$TOOL" no',
  '  fi',
  'done',
  'if have wget && wget_is_busybox; then',
  '  fact host.wgetBusybox yes',
  'else',
  '  fact host.wgetBusybox no',
  'fi',
  'fact host.shell "${SHELL##*/}"',
  'fact host.sshAuthSock "${SSH_AUTH_SOCK:-}"',
  'fact host.display "${DISPLAY:-}"',
  'fact server.installDir "$INSTALL_DIR"',
  'if [ -x "$INSTALL_DIR/$LAUNCHER" ]; then',
  '  fact server.installed yes',
  'else',
  '  fact server.installed no',
  'fi',
  'finish Ok',
];

const LEAVE: readonly string[] = [
  'leave() {',
  '  lock_release',
  '  finish "$1"',
  '}',
];

const INSTALL_BODY: readonly string[] = [
  'STARTED_AT=$(now_seconds)',
  '[ -n "$DATA_ROOT" ] || finish CreateInstallDirFailed',
  'MKDIR_ERROR=$(mkdir -p "$INSTALL_DIR" 2>&1) || write_failed "$INSTALL_DIR" "$MKDIR_ERROR"',
  'take_lock_or_finish "$COMMIT"',
  'if [ -x "$INSTALL_DIR/$LAUNCHER" ]; then',
  '  fact server.installDir "$INSTALL_DIR"',
  '  leave Ok',
  'fi',
  'prepare_environment',
  'if [ -n "$ARCHIVE_PATH" ]; then',
  '  ARCHIVE=$ARCHIVE_PATH',
  'else',
  '  have wget || have curl || leave NoDownloaderAvailable',
  '  ARCHIVE=$INSTALL_DIR/.archive.$$',
  '  fetch_archive "$ARCHIVE_URL" "$ARCHIVE" || leave ServerDownloadFailed',
  'fi',
  'DOWNLOADED_AT=$(now_seconds)',
  'unpack_into "$ARCHIVE" "$INSTALL_DIR" || UNPACK_FAILED=yes',
  '[ -n "$ARCHIVE_PATH" ] || rm -f "$ARCHIVE"',
  '[ -z "${UNPACK_FAILED:-}" ] && [ -x "$INSTALL_DIR/$LAUNCHER" ] || leave UnpackFailed',
  'fact server.installDir "$INSTALL_DIR"',
  'fact timing.download "$(( ( DOWNLOADED_AT - STARTED_AT ) * 1000 ))"',
  'fact timing.install "$(elapsed_milliseconds "$DOWNLOADED_AT")"',
  'leave Ok',
];

const INSTALL_CLI_BODY: readonly string[] = [
  'clear_staging() {',
  '  rm -rf "$CLI_STAGING" "$CLI_STAGING".stage.*',
  '  rmdir "$DATA_DIR/cli-bin" 2>/dev/null',
  '}',
  'STARTED_AT=$(now_seconds)',
  '[ -n "$DATA_ROOT" ] && [ -n "$CLI_NAME" ] || finish CreateInstallDirFailed',
  'MKDIR_ERROR=$(mkdir -p "$INSTALL_DIR" 2>&1) || write_failed "$INSTALL_DIR" "$MKDIR_ERROR"',
  'take_lock_or_finish "$COMMIT"',
  'if [ -x "$CLI_FILE" ]; then',
  '  fact cli.path "$CLI_FILE"',
  '  leave Ok',
  'fi',
  'MKDIR_ERROR=$(mkdir -p "$CLI_STAGING" 2>&1) || write_failed_leave "$CLI_STAGING" "$MKDIR_ERROR"',
  'prepare_environment',
  'if [ -n "$ARCHIVE_PATH" ]; then',
  '  ARCHIVE=$ARCHIVE_PATH',
  'else',
  '  have wget || have curl || leave NoDownloaderAvailable',
  '  ARCHIVE=$CLI_STAGING.archive.$$',
  '  fetch_archive "$ARCHIVE_URL" "$ARCHIVE" || { rm -f "$ARCHIVE"; clear_staging; leave ServerDownloadFailed; }',
  'fi',
  'DOWNLOADED_AT=$(now_seconds)',
  'unpack_into "$ARCHIVE" "$CLI_STAGING" || UNPACK_FAILED=yes',
  '[ -n "$ARCHIVE_PATH" ] || rm -f "$ARCHIVE"',
  'if [ -n "${UNPACK_FAILED:-}" ] || [ ! -f "$CLI_STAGING/$LAUNCHER" ]; then',
  '  clear_staging',
  '  leave UnpackFailed',
  'fi',
  'chmod +x "$CLI_STAGING/$LAUNCHER" && mv "$CLI_STAGING/$LAUNCHER" "$CLI_FILE" || { clear_staging; leave UnpackFailed; }',
  'clear_staging',
  'fact cli.path "$CLI_FILE"',
  'fact timing.download "$(( ( DOWNLOADED_AT - STARTED_AT ) * 1000 ))"',
  'fact timing.install "$(elapsed_milliseconds "$DOWNLOADED_AT")"',
  'leave Ok',
];

/**
 * The check of the host's connection token file: a regular file, not a link, that only its owner can read or write,
 * holding 1 to 128 characters of the server's token form.
 */
const CONNECTION_TOKEN_CHECK: readonly string[] = [
  'connection_token_usable() {',
  '  [ -f "$1" ] && [ ! -L "$1" ] || return 1',
  '  case $(ls -ln "$1" 2>/dev/null) in -rw-------*|-r--------*) ;; *) return 1 ;; esac',
  '  TOKEN_TEXT=$(cat "$1" 2>/dev/null) || return 1',
  "  case $TOKEN_TEXT in ''|*[!0-9A-Za-z_-]*) return 1 ;; esac",
  '  [ "${#TOKEN_TEXT}" -le 128 ]',
  '}',
];

const START_CLI_BODY: readonly string[] = [
  ...CONNECTION_TOKEN_CHECK,
  '[ -x "$CLI_FILE" ] || finish ServerFailedToStart',
  '[ -n "${VSCODE_CLI_REQUIRE_TOKEN:-}" ] || { fact cli.tokenMissing yes; finish ServerFailedToStart; }',
  'TOKEN_FILE=$CLI_DATA/connection-token',
  '(umask 077; mkdir -p "$CLI_DATA") || finish ServerFailedToStart',
  'if [ ! -e "$TOKEN_FILE" ] && [ ! -L "$TOKEN_FILE" ]; then',
  '  TOKEN_TEMPORARY=$TOKEN_FILE.$$',
  '  (umask 077; tr -dc \'A-Za-z0-9\' </dev/urandom | head -c 32 >"$TOKEN_TEMPORARY")',
  '  TOKEN_LENGTH=$(wc -c <"$TOKEN_TEMPORARY" 2>/dev/null)',
  '  [ "$((TOKEN_LENGTH + 0))" -eq 32 ] && ln "$TOKEN_TEMPORARY" "$TOKEN_FILE" 2>/dev/null',
  '  rm -f "$TOKEN_TEMPORARY"',
  'fi',
  '[ -e "$TOKEN_FILE" ] || [ -L "$TOKEN_FILE" ] || finish ServerFailedToStart',
  'connection_token_usable "$TOKEN_FILE" || { fact cli.tokenInvalid yes; finish ServerFailedToStart; }',
  'fact cli.connectionToken "$(cat "$TOKEN_FILE")"',
  'LOG_FILE=$DATA_DIR/.cli.$COMMIT.log',
  '(umask 077; printf \'\' >"$LOG_FILE") || finish ServerFailedToStart',
  'nohup "$CLI_FILE" command-shell --on-host 127.0.0.1 --on-port 0 --cli-data-dir "$CLI_DATA" --parent-process-id "$PPID" </dev/null >"$LOG_FILE" 2>&1 9>&- &',
  'CLI_PID=$!',
  'if sleep 0.2 2>/dev/null; then TICK=0.2; TICKS=$((READY_SECONDS * 5)); else TICK=1; TICKS=$READY_SECONDS; fi',
  'WAITED=0',
  'while [ "$WAITED" -lt "$TICKS" ]; do',
  '  CLI_PORT=$(cli_ready_port)',
  '  if [ -n "$CLI_PORT" ]; then',
  '    fact cli.port "$CLI_PORT"',
  '    fact cli.pid "$CLI_PID"',
  '    fact cli.log "$LOG_FILE"',
  '    finish Ok',
  '  fi',
  '  kill -0 "$CLI_PID" 2>/dev/null || finish ServerFailedToStart',
  '  sleep "$TICK"',
  '  WAITED=$((WAITED + 1))',
  'done',
  'kill "$CLI_PID" 2>/dev/null',
  'finish ServerFailedToStart',
];

const STEPWISE_BODIES: Readonly<Record<StepwiseAction, readonly string[]>> = {
  prepare: [
    '[ -n "$DATA_ROOT" ] || finish CreateInstallDirFailed',
    'STAGING=$DATA_DIR/bin/$COMMIT-$STAGING_SUFFIX',
    'MKDIR_ERROR=$(mkdir -p "$STAGING" 2>&1) || write_failed "$STAGING" "$MKDIR_ERROR"',
    'fact server.stagingDir "$STAGING"',
    'finish Ok',
  ],
  unpack: [
    'STAGING=$DATA_DIR/bin/$COMMIT-$STAGING_SUFFIX',
    'cat >"$STAGING.archive" || finish UnpackFailed',
    'unpack_into "$STAGING.archive" "$STAGING" || UNPACK_FAILED=yes',
    'rm -f "$STAGING.archive"',
    '[ -z "${UNPACK_FAILED:-}" ] && [ -x "$STAGING/$LAUNCHER" ] || finish UnpackFailed',
    'finish Ok',
  ],
  activate: [
    'STAGING=$DATA_DIR/bin/$COMMIT-$STAGING_SUFFIX',
    'if [ -x "$INSTALL_DIR/$LAUNCHER" ]; then',
    '  rm -rf "$STAGING"',
    '  fact server.installDir "$INSTALL_DIR"',
    '  finish Ok',
    'fi',
    '[ -x "$STAGING/$LAUNCHER" ] || finish UnpackFailed',
    'ASIDE=$INSTALL_DIR.old.$$',
    'if [ -d "$INSTALL_DIR" ]; then',
    '  mv "$INSTALL_DIR" "$ASIDE" || finish UnpackFailed',
    'fi',
    'if ! mv "$STAGING" "$INSTALL_DIR"; then',
    '  [ ! -d "$ASIDE" ] || mv "$ASIDE" "$INSTALL_DIR"',
    '  finish UnpackFailed',
    'fi',
    'rm -rf "${ASIDE:?}"',
    'fact server.installDir "$INSTALL_DIR"',
    'finish Ok',
  ],
};

function startBody(start: StartParameters): string[] {
  return [
    'if [ "$SOCKET_MODE" = yes ]; then KIND_PREFIX=$BOOT_PREFIX.socket; else KIND_PREFIX=$BOOT_PREFIX; fi',
    'PID_FILE=$KIND_PREFIX.pid',
    'LOG_FILE=$KIND_PREFIX.log',
    'TOKEN_FILE=$KIND_PREFIX.token',
    'STARTED_AT=$(now_seconds)',
    'ready_port() {',
    `  sed -n 's/.*${READY_LINE} \\([^ ]*\\).*/\\1/p' "$LOG_FILE" 2>/dev/null | tail -n 1`,
    '}',
    'start_failed() {',
    '  if grep -q \'Could not find free port in range\' "$LOG_FILE" 2>/dev/null; then',
    '    fact server.failure noFreePort',
    '  elif grep -q \'Server terminated due to presence of CVE-2020-1416\' "$LOG_FILE" 2>/dev/null; then',
    '    fact server.failure cveTerminated',
    '  fi',
    '  leave ServerFailedToStart',
    '}',
    'started() {',
    '  [ -s "$TOKEN_FILE" ] || start_failed',
    '  case $SOCKET_MODE:$1 in',
    '    yes:/*) fact server.socketPath "$1" ;;',
    '    no:[0-9]*) fact server.port "$1" ;;',
    '    *) start_failed ;;',
    '  esac',
    '  fact server.pid "$2"',
    '  fact server.token "$(cat "$TOKEN_FILE" 2>/dev/null)"',
    '  fact server.log "$LOG_FILE"',
    '  if [ "$LAUNCHED" = yes ]; then',
    '    fact server.reused no',
    '  else',
    '    fact server.reused yes',
    '  fi',
    '  fact host.kernel "$(uname -r 2>/dev/null)"',
    '  fact timing.start "$(elapsed_milliseconds "$STARTED_AT")"',
    '  leave Ok',
    '}',
    '[ -x "$INSTALL_DIR/$LAUNCHER" ] || finish ServerFailedToStart',
    'take_lock_or_finish "$COMMIT"',
    'RUNNING_PID=$(cat "$PID_FILE" 2>/dev/null)',
    'if is_server_process "$RUNNING_PID" "$INSTALL_DIR"; then',
    '  SERVER_PID=$RUNNING_PID',
    '  LAUNCHED=no',
    'else',
    '  prepare_environment',
    '  if [ ! -s "$TOKEN_FILE" ]; then',
    '    WRITE_ERROR=$( (umask 077; tr -dc \'A-Za-z0-9\' </dev/urandom | head -c 32 >"$TOKEN_FILE") 2>&1 )',
    '  fi',
    '  [ -s "$TOKEN_FILE" ] || write_failed_leave "$TOKEN_FILE" "${WRITE_ERROR:-the token file is empty}"',
    '  if [ "$SOCKET_MODE" = yes ]; then',
    "    SOCKET_HEX=$(tr -dc 'a-f0-9' </dev/urandom | head -c 32)",
    "    SOCKET_VARIANT=$(tr -dc '89ab' </dev/urandom | head -c 1)",
    `    SOCKET_NAME=$(printf '%s' "$SOCKET_HEX" | sed "s/^\\(........\\)\\(....\\).\\(...\\).\\(...\\)\\(............\\)$/\\1-\\2-4\\3-$SOCKET_VARIANT\\4-\\5/")`,
    "    TAB=$(printf '\\t')",
    "    NEWLINE='",
    "'",
    '    if [ -z "${TMPDIR+set}" ]; then',
    '      SOCKET_FOLDER=/tmp',
    '    else',
    '      case $TMPDIR in',
    "        '') SOCKET_FOLDER=/tmp; fact server.socketFolderFallback empty ;;",
    '        *" "*|*"$TAB"*|*"$NEWLINE"*) SOCKET_FOLDER=/tmp; fact server.socketFolderFallback whiteSpace ;;',
    '        /*) if [ -d "$TMPDIR" ] && [ -w "$TMPDIR" ]; then',
    '             SOCKET_FOLDER=$TMPDIR',
    '           else',
    '             SOCKET_FOLDER=/tmp; fact server.socketFolderFallback unusable',
    '           fi ;;',
    '        *) SOCKET_FOLDER=/tmp; fact server.socketFolderFallback relative ;;',
    '      esac',
    '    fi',
    '    SOCKET_FILE="$SOCKET_FOLDER/code-$SOCKET_NAME"',
    '  fi',
    `  ${startOptions(start)}`,
    '  WRITE_ERROR=$( (umask 077; printf \'\' >"$LOG_FILE") 2>&1 ) || write_failed_leave "$LOG_FILE" "$WRITE_ERROR"',
    '  nohup "$INSTALL_DIR/$LAUNCHER" "$@" </dev/null >"$LOG_FILE" 2>&1 9>&- &',
    '  SERVER_PID=$!',
    '  WRITE_ERROR=$( { echo "$SERVER_PID" >"$PID_FILE"; } 2>&1 ) || { kill "$SERVER_PID" 2>/dev/null; write_failed_leave "$PID_FILE" "$WRITE_ERROR"; }',
    '  LAUNCHED=yes',
    'fi',
    'if sleep 0.2 2>/dev/null; then TICK=0.2; TICKS=$((READY_SECONDS * 5)); else TICK=1; TICKS=$READY_SECONDS; fi',
    'WAITED=0',
    'SERVER_ENDED=no',
    'while [ "$WAITED" -lt "$TICKS" ]; do',
    '  SERVER_PORT_READ=$(ready_port)',
    '  [ -z "$SERVER_PORT_READ" ] || started "$SERVER_PORT_READ" "$SERVER_PID"',
    '  if ! kill -0 "$SERVER_PID" 2>/dev/null; then',
    '    [ "$LAUNCHED" = yes ] || start_failed',
    '    if [ "$SERVER_ENDED" = no ]; then',
    '      SERVER_ENDED=yes',
    '      wait "$SERVER_PID"',
    '      EXIT_CODE=$?',
    '      [ "$EXIT_CODE" != 207 ] || leave LinuxPrereqs',
    '    fi',
    '    ! grep -q \'Server terminated due to presence of CVE-2020-1416\' "$LOG_FILE" 2>/dev/null || start_failed',
    '  fi',
    '  sleep "$TICK"',
    '  WAITED=$((WAITED + 1))',
    'done',
    'start_failed',
  ];
}

/**
 * Installs each extension with the installed server's own command line, one after the other, and reports one answer
 * per extension: `server.extension.<position>.status` is `installed` or `failed`, and `message` is the last line the
 * command printed. A failure of one extension never stops the others, and the step itself ends `Ok`.
 */
function installExtensionsBody(start: StartParameters): string[] {
  const words = start.extensions.map(extension => shellQuote(extension));
  return [
    '[ -x "$INSTALL_DIR/$LAUNCHER" ] || finish ServerFailedToStart',
    'prepare_environment',
    `set -- ${words.join(' ')}`,
    'POSITION=0',
    'EXTENSION_LOG=$BOOT_PREFIX.extension.$$',
    'for EXTENSION in "$@"; do',
    '  if "$INSTALL_DIR/$LAUNCHER" --install-extension "$EXTENSION" </dev/null >"$EXTENSION_LOG" 2>&1; then',
    '    EXTENSION_STATUS=installed',
    '  else',
    '    EXTENSION_STATUS=failed',
    '  fi',
    '  fact "server.extension.$POSITION.status" "$EXTENSION_STATUS"',
    '  fact "server.extension.$POSITION.message" "$(tail -n 1 "$EXTENSION_LOG" 2>/dev/null | cut -c1-300)"',
    '  POSITION=$((POSITION + 1))',
    'done',
    'rm -f "$EXTENSION_LOG"',
    'finish Ok',
  ];
}

const KILL_BODY: readonly string[] = [
  '[ -n "$DATA_ROOT" ] && [ -n "$DATA_FOLDER" ] || finish Ok',
  'stop_servers',
  'rm -f "${DATA_DIR:?}"/.*.pid',
  'rm -rf "${DATA_DIR:?}/bin"',
  'finish Ok',
];

const DISCARD_BODY: readonly string[] = ['finish Ok'];

const UNINSTALL_BODY: readonly string[] = [
  '[ -n "$DATA_ROOT" ] && [ -n "$DATA_FOLDER" ] || finish Ok',
  'stop_servers',
  'rm -rf "${DATA_DIR:?}"',
  'finish Ok',
];

const CLEANUP_BODY: readonly string[] = [
  '[ -n "$DATA_ROOT" ] && [ -n "$DATA_FOLDER" ] || finish Ok',
  '[ -d "$DATA_DIR/bin" ] || finish Ok',
  'INDEX=0',
  'ls -t "$DATA_DIR/bin" 2>/dev/null | while IFS= read -r NAME; do',
  '  INDEX=$((INDEX + 1))',
  '  [ "$NAME" != "$COMMIT" ] || continue',
  '  KIND=$(folder_kind "$NAME")',
  '  case $CLEANUP_KIND in',
  '    keepNewest)',
  '      [ "$INDEX" -gt "$KEEP_COUNT" ] && remove_install "$NAME"',
  '      ;;',
  '    onlyCurrentRemoveLeftovers)',
  '      [ "$KIND" = other ] || remove_install "$NAME"',
  '      ;;',
  '    *)',
  '      [ "$KIND" != commit ] || remove_install "$NAME"',
  '      ;;',
  '  esac',
  'done',
  'finish Ok',
];

/**
 * Ends the CLI that `startCli` started, only while its process is still that CLI: its first argument is the CLI's own
 * file and its second `command-shell`, read field by field from `/proc`, so neither a recycled process id nor a
 * process that merely mentions the file passes. Without `/proc` the fields can't be read, and nothing is ended.
 */
const STOP_CLI_BODY: readonly string[] = [
  'is_cli_process() {',
  "  case $1 in ''|*[!0-9]*|0|1) return 1 ;; esac",
  '  [ -r "/proc/$1/cmdline" ] || return 1',
  "  CLI_ARGUMENT_0=$(tr '\\0' '\\n' <\"/proc/$1/cmdline\" 2>/dev/null | sed -n 1p)",
  "  CLI_ARGUMENT_1=$(tr '\\0' '\\n' <\"/proc/$1/cmdline\" 2>/dev/null | sed -n 2p)",
  '  [ "$CLI_ARGUMENT_0" = "$CLI_FILE" ] && [ "$CLI_ARGUMENT_1" = command-shell ]',
  '}',
  'if is_cli_process "$CLI_STOP_PID"; then',
  '  kill "$CLI_STOP_PID" 2>/dev/null',
  '  fact cli.stopped yes',
  'else',
  '  fact cli.stopped no',
  'fi',
  'finish Ok',
];

type BodyStep = Exclude<
  BootstrapRequest['step'],
  'start' | 'installExtensions'
>;

function bodyOf(step: BodyStep): readonly string[] {
  switch (step) {
    case 'probe':
      return PROBE_BODY;
    case 'install':
      return INSTALL_BODY;
    case 'installCli':
      return INSTALL_CLI_BODY;
    case 'startCli':
      return START_CLI_BODY;
    case 'stopCli':
      return STOP_CLI_BODY;
    case 'discard':
      return DISCARD_BODY;
    case 'kill':
      return KILL_BODY;
    case 'uninstall':
      return UNINSTALL_BODY;
    case 'cleanup':
      return CLEANUP_BODY;
    default:
      return STEPWISE_BODIES[step];
  }
}

/** The function groups each step needs, so that a script holds only what it uses. */
const FUNCTION_GROUPS: Readonly<
  Record<BootstrapRequest['step'], ReadonlyArray<readonly string[]>>
> = {
  probe: [COMMON_FUNCTIONS, BUSYBOX_FUNCTIONS],
  install: [
    COMMON_FUNCTIONS,
    ENVIRONMENT_FUNCTIONS,
    LOCK_FUNCTIONS,
    BUSYBOX_FUNCTIONS,
    FETCH_FUNCTIONS,
    UNPACK_FUNCTIONS,
    LEAVE,
  ],
  discard: [COMMON_FUNCTIONS],
  prepare: [COMMON_FUNCTIONS],
  unpack: [COMMON_FUNCTIONS, UNPACK_FUNCTIONS],
  activate: [COMMON_FUNCTIONS],
  start: [
    COMMON_FUNCTIONS,
    ENVIRONMENT_FUNCTIONS,
    LOCK_FUNCTIONS,
    PROCESS_FUNCTIONS,
    LEAVE,
  ],
  installExtensions: [COMMON_FUNCTIONS, ENVIRONMENT_FUNCTIONS],
  installCli: [
    COMMON_FUNCTIONS,
    ENVIRONMENT_FUNCTIONS,
    LOCK_FUNCTIONS,
    BUSYBOX_FUNCTIONS,
    FETCH_FUNCTIONS,
    UNPACK_FUNCTIONS,
    LEAVE,
  ],
  startCli: [COMMON_FUNCTIONS, CLI_FUNCTIONS],
  stopCli: [COMMON_FUNCTIONS],
  kill: [
    COMMON_FUNCTIONS,
    PROCESS_FUNCTIONS,
    SERVER_TREE_FUNCTIONS,
    STOP_FUNCTIONS,
  ],
  uninstall: [
    COMMON_FUNCTIONS,
    PROCESS_FUNCTIONS,
    SERVER_TREE_FUNCTIONS,
    STOP_FUNCTIONS,
  ],
  cleanup: [COMMON_FUNCTIONS, LOCK_FUNCTIONS, FOLDER_KIND_FUNCTIONS],
};

function stepBody(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): readonly string[] {
  switch (request.step) {
    case 'start':
      return startBody(parameters.start);
    case 'installExtensions':
      return installExtensionsBody(parameters.start);
    default:
      return bodyOf(request.step);
  }
}

function posixScript(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): string {
  const body = stepBody(request, parameters);
  return [
    ...GUARD,
    ...parameterBlock(parameters),
    ...FUNCTION_GROUPS[request.step].flat(),
    ...body,
    '',
  ].join('\n');
}

/** What the PowerShell twin prints until it exists: a result block that names the missing piece. */
const POWERSHELL_UNAVAILABLE: string = [
  `Write-Output ''`,
  `Write-Output '${RESULT_BEGIN}'`,
  `Write-Output 'status=ServerFailedToStart'`,
  `Write-Output 'host.note=the Windows bootstrap script is not available yet'`,
  `Write-Output '${RESULT_END}'`,
  '',
].join('\n');

/**
 * The text of the script for one step, for the interpreter the host has. The POSIX script runs under any `sh` and
 * prints a result block that `parseResult` reads. The PowerShell script is provisional until it has been captured on
 * a Windows host, so it answers with a failure that says so.
 */
export function scriptFor(
  request: BootstrapRequest,
  interpreter: Interpreter,
  parameters: ScriptParameters,
): string {
  return interpreter === 'powershell'
    ? POWERSHELL_UNAVAILABLE
    : posixScript(request, parameters);
}
