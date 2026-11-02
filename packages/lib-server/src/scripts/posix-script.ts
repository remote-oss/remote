/**
 * @fileoverview The POSIX `sh` script of each bootstrap step: the guard, the parameter block, the helper functions its
 * roles name, and the step's body, which ends in the result block.
 */

import {
  CVE_LINE,
  NO_FREE_PORT_PREFIX,
  POSIX_FUNCTIONS,
  READY_LINE,
  shellQuote,
} from './posix-functions.ts';
import {LAUNCHING_LINE} from './result-block.ts';
import {
  type BootstrapRequest,
  parameterValuesOf,
  rolesOf,
  type ScriptParameters,
  type StartParameters,
  startWordsOf,
  type StepwiseAction,
} from './steps.ts';

/**
 * The `set --` line that holds the server's start options: each option and value as one single-quoted word, and the
 * two file variables as words the script expands.
 */
function startOptions(start: StartParameters): string {
  const words = startWordsOf(start).map(word =>
    'text' in word ? shellQuote(word.text) : `"$${word.variable}"`,
  );
  return `set -- ${words.join(' ')}`;
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
  'fact host.shell "${SHELL:-}"',
  'fact host.sshAuthSock "${SSH_AUTH_SOCK:-}"',
  'fact host.display "${DISPLAY:-}"',
  'fact server.installDir "$INSTALL_DIR"',
  'if [ -x "$INSTALL_DIR/$LAUNCHER" ]; then',
  '  fact server.installed yes',
  'else',
  '  fact server.installed no',
  'fi',
];

/** What the probe adds when the server installs into a tree: whether the tree is complete. */
const PROBE_TREE_BODY: readonly string[] = [
  'if [ -x "$INSTALL_TREE/$LAUNCHER" ]; then',
  '  fact server.treeComplete yes',
  'else',
  '  fact server.treeComplete no',
  'fi',
];

function probeBody(installTree: string): readonly string[] {
  return [
    ...PROBE_BODY,
    ...(installTree === '' ? [] : PROBE_TREE_BODY),
    'finish Ok',
  ];
}

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

/**
 * The install into a tree: the lock is the container's own, in the temporary folder; a complete tree is not
 * touched, and the link `bin/<commit>` is made whether the tree was installed now or by another container.
 */
const INSTALL_TREE_BODY: readonly string[] = [
  'STARTED_AT=$(now_seconds)',
  '[ -n "$DATA_ROOT" ] || finish CreateInstallDirFailed',
  'MKDIR_ERROR=$(mkdir -p "$DATA_DIR/bin" "${INSTALL_TREE%/*}" 2>&1) || write_failed "$DATA_DIR/bin" "$MKDIR_ERROR"',
  'take_lock_or_finish "$COMMIT"',
  'if [ -x "$INSTALL_TREE/$LAUNCHER" ]; then',
  '  fact server.treeInstalled no',
  'else',
  '  prepare_environment',
  '  if [ -n "$ARCHIVE_PATH" ]; then',
  '    ARCHIVE=$ARCHIVE_PATH',
  '  else',
  '    have wget || have curl || leave NoDownloaderAvailable',
  '    ARCHIVE=${INSTALL_TREE}_$STAGING_SUFFIX.archive.$$',
  '    fetch_archive "$ARCHIVE_URL" "$ARCHIVE" || leave ServerDownloadFailed',
  '  fi',
  '  DOWNLOADED_AT=$(now_seconds)',
  '  install_tree "$ARCHIVE" || UNPACK_FAILED=yes',
  '  [ -n "$ARCHIVE_PATH" ] || rm -f "$ARCHIVE"',
  '  [ -z "${UNPACK_FAILED:-}" ] || leave UnpackFailed',
  '  fact server.treeInstalled yes',
  '  fact timing.download "$(( ( DOWNLOADED_AT - STARTED_AT ) * 1000 ))"',
  '  fact timing.install "$(elapsed_milliseconds "$DOWNLOADED_AT")"',
  'fi',
  'ensure_install_link',
  '[ -x "$INSTALL_DIR/$LAUNCHER" ] || leave UnpackFailed',
  'fact server.installDir "$INSTALL_DIR"',
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

/**
 * What a launch does first under the `bundledHelper` policy: it runs the server's own requirements helper through `sh`.
 * Exit 99 is `LinuxPrereqs`, with the helper's output as facts inside the result block (ADR-0010 rule 1): up to 20 lines
 * of 500 characters, read from a here-document so that the loop runs in the script's own shell. Any other exit
 * launches the server. A server with no helper is not checked, and the fact says so. The lines of the here-document
 * start in the first column, because its end marker must.
 */
const REQUIREMENTS_HELPER_LINES: readonly string[] = [
  'if [ "$REQUIREMENTS_HELPER" = yes ]; then',
  '  REQUIREMENTS_SCRIPT=$INSTALL_DIR/bin/helpers/check-requirements.sh',
  '  if [ -f "$REQUIREMENTS_SCRIPT" ]; then',
  '    REQUIREMENTS_STATUS=0',
  '    REQUIREMENTS_OUTPUT=$(sh "$REQUIREMENTS_SCRIPT" 2>&1) || REQUIREMENTS_STATUS=$?',
  '    if [ "$REQUIREMENTS_STATUS" = 99 ]; then',
  '      REQUIREMENTS_LINE=0',
  '      if [ -n "$REQUIREMENTS_OUTPUT" ]; then',
  '        while IFS= read -r REQUIREMENTS_TEXT; do',
  '          [ "$REQUIREMENTS_LINE" -lt 20 ] || break',
  '          REQUIREMENTS_LINE=$((REQUIREMENTS_LINE + 1))',
  "          REQUIREMENTS_TEXT=$(printf '%s' \"$REQUIREMENTS_TEXT\" | tr -d '\\r' | cut -c1-500)",
  '          fact "server.prerequisites.$REQUIREMENTS_LINE" "$REQUIREMENTS_TEXT"',
  '        done <<REQUIREMENTS_END',
  '$REQUIREMENTS_OUTPUT',
  'REQUIREMENTS_END',
  '      fi',
  '      leave LinuxPrereqs',
  '    fi',
  '  else',
  '    fact server.prerequisitesHelper missing',
  '  fi',
  'fi',
];

function startBody(start: StartParameters, installTree: string): string[] {
  return [
    'if [ "$SOCKET_MODE" = yes ]; then KIND_PREFIX=$BOOT_PREFIX.socket; else KIND_PREFIX=$BOOT_PREFIX; fi',
    'PID_FILE=$KIND_PREFIX.pid',
    'LOG_FILE=$KIND_PREFIX.log',
    'TOKEN_FILE=$KIND_PREFIX.token',
    'STARTED_AT=$(now_seconds)',
    'ready_port() {',
    '  if [ "$SOCKET_MODE" = yes ]; then',
    `    sed -n 's/^${READY_LINE} \\(\\/[^ ]*\\)$/\\1/p' "$LOG_FILE" 2>/dev/null | tail -n 1`,
    '  else',
    `    sed -n 's/^${READY_LINE} \\([0-9][0-9]*\\)$/\\1/p' "$LOG_FILE" 2>/dev/null | tail -n 1`,
    '  fi',
    '}',
    'cve_terminated() {',
    `  grep -q '^${CVE_LINE}$' "$LOG_FILE" 2>/dev/null`,
    '}',
    'start_failed() {',
    `  if grep -q '^${NO_FREE_PORT_PREFIX}' "$LOG_FILE" 2>/dev/null; then`,
    '    fact server.failure noFreePort',
    '  elif cve_terminated; then',
    '    fact server.failure cveTerminated',
    '  fi',
    '  leave ServerFailedToStart',
    '}',
    'started() {',
    '  [ -s "$TOKEN_FILE" ] || start_failed',
    '  case $SOCKET_MODE:$1 in',
    '    yes:/*) fact server.socketPath "$1" ;;',
    '    no:*[!0-9]*|no:|no:0*) start_failed ;;',
    '    no:*) fact server.port "$1" ;;',
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
    ...(installTree === '' ? [] : ['ensure_install_link']),
    '[ -x "$INSTALL_DIR/$LAUNCHER" ] || finish ServerFailedToStart',
    'take_lock_or_finish "$COMMIT"',
    'RUNNING_PID=$(cat "$PID_FILE" 2>/dev/null)',
    'if is_server_process "$RUNNING_PID" "$INSTALL_DIR"; then',
    '  SERVER_PID=$RUNNING_PID',
    '  LAUNCHED=no',
    'else',
    '  prepare_environment',
    ...REQUIREMENTS_HELPER_LINES,
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
    `  printf '%s\\n' ${shellQuote(LAUNCHING_LINE)}`,
    '  fact server.launching yes',
    '  nohup "$INSTALL_DIR/$LAUNCHER" "$@" </dev/null >"$LOG_FILE" 2>&1 9>&- &',
    '  SERVER_PID=$!',
    '  WRITE_ERROR=$( { echo "$SERVER_PID" >"$PID_FILE"; } 2>&1 ) || { kill "$SERVER_PID" 2>/dev/null; write_failed_leave "$PID_FILE" "$WRITE_ERROR"; }',
    '  LAUNCHED=yes',
    'fi',
    'if sleep 0.2 2>/dev/null; then TICK=0.2; TICKS=$((READY_SECONDS * 5)); else TICK=1; TICKS=$READY_SECONDS; fi',
    'WAITED=0',
    'while [ "$WAITED" -lt "$TICKS" ]; do',
    '  SERVER_PORT_READ=$(ready_port)',
    '  [ -z "$SERVER_PORT_READ" ] || started "$SERVER_PORT_READ" "$SERVER_PID"',
    '  if ! kill -0 "$SERVER_PID" 2>/dev/null; then',
    '    [ "$LAUNCHED" = yes ] || start_failed',
    '    ! cve_terminated || start_failed',
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
  'if [ "$DATA_ROOT" != "$HOME" ]; then',
  '  [ -n "$HOME" ] || finish Ok',
  '  DATA_DIR=$HOME/$DATA_FOLDER',
  '  stop_servers',
  'fi',
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
  'start' | 'installExtensions' | 'probe' | 'install'
>;

function bodyOf(step: BodyStep): readonly string[] {
  switch (step) {
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

function stepBody(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): readonly string[] {
  switch (request.step) {
    case 'start':
      return startBody(parameters.start, parameters.installTree);
    case 'installExtensions':
      return installExtensionsBody(parameters.start);
    case 'probe':
      return probeBody(parameters.installTree);
    case 'install':
      return parameters.installTree === '' ? INSTALL_BODY : INSTALL_TREE_BODY;
    default:
      return bodyOf(request.step);
  }
}

/** The POSIX script of one request: the guard, the parameters, the role functions and the step's body. */
export function posixScript(
  request: BootstrapRequest,
  parameters: ScriptParameters,
): string {
  const body = stepBody(request, parameters);
  return [
    ...GUARD,
    ...parameterValuesOf(parameters).map(
      ([name, value]) => `${name}=${shellQuote(value)}`,
    ),
    // The install and start scripts set the policy's umask; the token and log files keep their own.
    '[ "$INSTALL_UMASK" = inherit ] || umask "$INSTALL_UMASK"',
    ...rolesOf(request, parameters).flatMap(role => POSIX_FUNCTIONS[role]),
    ...body,
    '',
  ].join('\n');
}
