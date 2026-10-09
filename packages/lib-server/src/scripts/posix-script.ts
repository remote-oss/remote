/**
 * @fileoverview The text of the POSIX `sh` bootstrap script, in the pieces the steps are built from. The script runs
 * under dash, ash, BusyBox and bash alike: no bash-only syntax, and every command that could read standard input is
 * given /dev/null, because the script itself may be arriving on standard input.
 */

import {PROGRESS_PREFIX} from './progress-line.ts';
import {RESULT_BEGIN, RESULT_END} from './result-block.ts';

/** The server's own line that says it is ready; the port follows it. */
export const READY_LINE = 'Extension host agent listening on';

/** Quote a value for the shell as one word, whatever it holds. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The functions every step uses: the result block, facts, tools and times. */
export const COMMON_FUNCTIONS: readonly string[] = [
  "RESULT_FACTS=''",
  'fact() {',
  "  FACT_VALUE=$(printf '%s' \"$2\" | tr '\\n\\r' '  ')",
  '  RESULT_FACTS="${RESULT_FACTS}${1}=${FACT_VALUE}',
  '"',
  '}',
  'report() {',
  `  printf '\\n%s\\n' ${shellQuote(RESULT_BEGIN)}`,
  '  printf \'status=%s\\n\' "$1"',
  '  printf \'%s\' "$RESULT_FACTS"',
  `  printf '%s\\n' ${shellQuote(RESULT_END)}`,
  '}',
  'finish() {',
  '  if [ "$ARCHIVE_REMOVE" = yes ] && [ -n "$ARCHIVE_PATH" ] && [ "$1" != LockBusy ]; then',
  '    rm -f "$ARCHIVE_PATH"',
  '  fi',
  '  report "$1"',
  '  exit 0',
  '}',
  'have() {',
  '  command -v "$1" >/dev/null 2>&1',
  '}',
  'now_seconds() {',
  '  date +%s',
  '}',
  'elapsed_milliseconds() {',
  '  echo $(( ( $(now_seconds) - $1 ) * 1000 ))',
  '}',
  'DATA_ROOT=${INSTALL_ROOT:-$HOME}',
  'DATA_DIR=$DATA_ROOT/$DATA_FOLDER',
  'INSTALL_DIR=$DATA_DIR/bin/$COMMIT',
  'BOOT_PREFIX=$DATA_DIR/.$COMMIT',
];

/** Source the environment setup once and export the proxy variables the host's own environment does not set. */
export const ENVIRONMENT_FUNCTIONS: readonly string[] = [
  'prepare_environment() {',
  '  if [ -n "$ENVIRONMENT_SETUP" ] && [ -f "$ENVIRONMENT_SETUP" ]; then',
  '    . "$ENVIRONMENT_SETUP" </dev/null',
  '  fi',
  '  if [ -n "$PROXY_HTTP" ] && [ -z "${http_proxy:-}" ]; then',
  '    http_proxy=$PROXY_HTTP',
  '    export http_proxy',
  '  fi',
  '  if [ -n "$PROXY_HTTPS" ] && [ -z "${https_proxy:-}" ]; then',
  '    https_proxy=$PROXY_HTTPS',
  '    export https_proxy',
  '  fi',
  '}',
];

/** The host lock: `flock` held on a descriptor, or an atomic hard link; `flock` falls back to the link. */
export const LOCK_FUNCTIONS: readonly string[] = [
  'lock_method() {',
  '  if [ "$LOCK_METHOD" = flock ] && have flock; then',
  '    echo flock',
  '  else',
  '    echo link',
  '  fi',
  '}',
  'lock_path() {',
  '  if [ "$LOCK_IN_TEMPORARY" = yes ]; then',
  '    echo "/tmp/$LOCK_PREFIX.$1"',
  '  else',
  '    echo "$DATA_DIR/bin/$1/$LOCK_PREFIX.$1"',
  '  fi',
  '}',
  'lock_take() {',
  '  LOCK_CANDIDATE=$(lock_path "$1")',
  '  if [ "$LOCK_IN_TEMPORARY" = yes ]; then',
  '    [ ! -L "$LOCK_CANDIDATE" ] || return 1',
  '    [ ! -e "$LOCK_CANDIDATE" ] || [ -f "$LOCK_CANDIDATE" ] || return 1',
  '  fi',
  '  if [ "$(lock_method)" = flock ]; then',
  '    ( exec 9>>"$LOCK_CANDIDATE" ) 2>/dev/null || return 1',
  '    exec 9>>"$LOCK_CANDIDATE"',
  '    flock -n 9 || return 1',
  '  else',
  '    true 2>/dev/null >>"$LOCK_CANDIDATE" || return 1',
  '    ln "$LOCK_CANDIDATE" "$LOCK_CANDIDATE.target" 2>/dev/null || return 1',
  '  fi',
  '  LOCK_HELD=$LOCK_CANDIDATE',
  "  trap 'exit 1' HUP INT TERM",
  "  trap 'lock_release' EXIT",
  '}',
  'lock_release() {',
  '  [ -n "${LOCK_HELD:-}" ] || return 0',
  '  if [ "$(lock_method)" = flock ]; then',
  '    exec 9>&-',
  '  else',
  '    rm -f "$LOCK_HELD" "$LOCK_HELD.target"',
  '  fi',
  "  LOCK_HELD=''",
  '}',
];

/** Whether the host's `wget` is BusyBox's, which takes fewer options than GNU's. */
export const BUSYBOX_FUNCTIONS: readonly string[] = [
  'wget_is_busybox() {',
  '  wget --help 2>&1 </dev/null | grep -i busybox >/dev/null 2>&1',
  '}',
];

/** The download with the first downloader the host has, `wget` before `curl`, configuration files skipped. */
export const FETCH_FUNCTIONS: readonly string[] = [
  'fetch_archive() {',
  '  if have wget; then',
  '    if wget_is_busybox; then',
  '      wget -q -T "$DOWNLOAD_SECONDS" -O "$2" "$1" </dev/null',
  '    elif [ "$USE_CONFIGURATION_FILES" = yes ]; then',
  '      wget -q -T "$DOWNLOAD_SECONDS" -O "$2" "$1" </dev/null',
  '    else',
  '      wget --no-config -q -T "$DOWNLOAD_SECONDS" -O "$2" "$1" </dev/null',
  '    fi',
  '  elif have curl; then',
  '    if [ "$USE_CONFIGURATION_FILES" = yes ]; then',
  '      curl -fsSL --max-time "$DOWNLOAD_SECONDS" -o "$2" "$1" </dev/null',
  '    else',
  '      curl -q -fsSL --max-time "$DOWNLOAD_SECONDS" -o "$2" "$1" </dev/null',
  '    fi',
  '  else',
  '    return 127',
  '  fi',
  '}',
];

/**
 * Unpack an archive into a folder, then move the archive's one top folder up into the target. A tar archive is listed
 * first so that the unpack can report whole percents, at most once per 5 points and once at 100.
 */
export const UNPACK_FUNCTIONS: readonly string[] = [
  'progress() {',
  `  printf '%s %s %s\\n' ${shellQuote(PROGRESS_PREFIX)} "$1" "$2"`,
  '}',
  'unpack_progress() {',
  '  COUNT=0',
  '  LAST=0',
  '  while read -r ENTRY_NAME; do',
  '    COUNT=$((COUNT + 1))',
  '    PERCENT=$((COUNT * 100 / $1))',
  '    if [ "$PERCENT" -lt 100 ] && [ $((PERCENT - LAST)) -ge 5 ]; then',
  '      progress unpack "$PERCENT"',
  '      LAST=$PERCENT',
  '    fi',
  '  done',
  '}',
  'extract_tar() {',
  '  TOTAL=$(tar -tzf "$1" </dev/null 2>/dev/null | wc -l | tr -d " ")',
  '  [ "${TOTAL:-0}" -gt 0 ] || return 1',
  '  progress unpack 0',
  '  { tar -xzvf "$1" -C "$2" </dev/null 2>&1; echo $? >"$2.status"; } | unpack_progress "$TOTAL"',
  '  EXTRACT_CODE=$(cat "$2.status" 2>/dev/null)',
  '  rm -f "$2.status"',
  '  [ "$EXTRACT_CODE" = 0 ] || return 1',
  '  progress unpack 100',
  '}',
  'extract_zip() {',
  '  progress unpack 0',
  '  unzip -q "$1" -d "$2" </dev/null || return 1',
  '  progress unpack 100',
  '}',
  'unpack_into() {',
  '  UNPACK_STAGE=$2.stage.$$',
  '  rm -rf "$UNPACK_STAGE"',
  '  mkdir -p "$UNPACK_STAGE" "$2" || return 1',
  '  case $ARCHIVE_FORMAT in',
  '    zip) extract_zip "$1" "$UNPACK_STAGE" || return 1 ;;',
  '    *) extract_tar "$1" "$UNPACK_STAGE" || return 1 ;;',
  '  esac',
  '  unpack_move_top "$UNPACK_STAGE" "$2"',
  '}',
  'unpack_move_top() {',
  '  ENTRIES=0',
  "  WRAPPER=''",
  '  for ENTRY in "$1"/* "$1"/.[!.]*; do',
  '    [ -e "$ENTRY" ] || continue',
  '    ENTRIES=$((ENTRIES + 1))',
  '    WRAPPER=$ENTRY',
  '  done',
  '  SOURCE=$1',
  '  if [ "$ENTRIES" = 1 ] && [ -d "$WRAPPER" ]; then',
  '    SOURCE=$WRAPPER',
  '  fi',
  '  MOVED=0',
  '  for ENTRY in "$SOURCE"/* "$SOURCE"/.[!.]*; do',
  '    [ -e "$ENTRY" ] || continue',
  '    mv "$ENTRY" "$2"/ || return 1',
  '    MOVED=1',
  '  done',
  '  rm -rf "$1"',
  '  [ "$MOVED" = 1 ]',
  '}',
];

/** Whether a process id is a live process whose command line holds a folder, as the server under it does. */
export const PROCESS_FUNCTIONS: readonly string[] = [
  'is_server_process() {',
  "  case $1 in ''|*[!0-9]*|0|1) return 1 ;; esac",
  '  kill -0 "$1" 2>/dev/null || return 1',
  '  if [ -r "/proc/$1/cmdline" ]; then',
  "    PROCESS_LINE=$(tr '\\0' ' ' <\"/proc/$1/cmdline\" 2>/dev/null)",
  '  else',
  '    PROCESS_LINE=$(ps -p "$1" -o args= 2>/dev/null)',
  '    if [ -z "$PROCESS_LINE" ]; then',
  '      PROCESS_LINE=$(ps -o pid= -o args= 2>/dev/null | sed -n "s/^ *$1 //p")',
  '    fi',
  '  fi',
  '  case $PROCESS_LINE in',
  '    *"$2"*) return 0 ;;',
  '  esac',
  '  return 1',
  '}',
];

/** Stop the servers whose process ids are recorded in the data folder; a process that is not a server is left alone. */
export const STOP_FUNCTIONS: readonly string[] = [
  'stop_servers() {',
  '  for PID_FILE in "$DATA_DIR"/.*.pid; do',
  '    [ -f "$PID_FILE" ] || continue',
  '    SERVER_PID=$(cat "$PID_FILE" 2>/dev/null)',
  '    is_server_process "$SERVER_PID" "$DATA_DIR/bin/" || continue',
  '    if have pkill; then',
  '      pkill -P "$SERVER_PID" 2>/dev/null',
  '    fi',
  '    kill "$SERVER_PID" 2>/dev/null',
  '  done',
  '}',
];

/** The kind of a folder under `bin/`: a 40-character commit, a `<commit>-<suffix>` leftover, or something else. */
export const FOLDER_KIND_FUNCTIONS: readonly string[] = [
  'folder_kind() {',
  '  HEAD_PART=$(printf \'%s\' "$1" | cut -c1-40)',
  '  case $HEAD_PART in',
  '    *[!0-9a-f]*) echo other; return ;;',
  '  esac',
  '  if [ "${#HEAD_PART}" != 40 ]; then',
  '    echo other',
  '  elif [ "${#1}" = 40 ]; then',
  '    echo commit',
  '  else',
  '    case $1 in',
  '      "$HEAD_PART"-*) echo leftover ;;',
  '      *) echo other ;;',
  '    esac',
  '  fi',
  '}',
  'remove_install() {',
  '  if lock_take "$1"; then',
  '    rm -rf "${DATA_DIR:?}/bin/$1" "$DATA_DIR/.$1.log" "$DATA_DIR/.$1.pid" "$DATA_DIR/.$1.token"',
  '    lock_release',
  '  fi',
  '}',
];
