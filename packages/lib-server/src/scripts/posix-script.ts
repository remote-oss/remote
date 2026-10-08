/**
 * @fileoverview The text of the POSIX `sh` bootstrap script, in the pieces the steps are built from. The script runs
 * under dash, ash, BusyBox and bash alike: no bash-only syntax, and every command that could read standard input is
 * given /dev/null, because the script itself may be arriving on standard input.
 */

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
  '  RESULT_FACTS="${RESULT_FACTS}${1}=${2}',
  '"',
  '}',
  'report() {',
  `  printf '\\n%s\\n' ${shellQuote(RESULT_BEGIN)}`,
  '  printf \'status=%s\\n\' "$1"',
  '  printf \'%s\' "$RESULT_FACTS"',
  `  printf '%s\\n' ${shellQuote(RESULT_END)}`,
  '}',
  'finish() {',
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
  '  LOCK_HELD=$(lock_path "$1")',
  '  if [ "$(lock_method)" = flock ]; then',
  '    exec 9>"$LOCK_HELD" || return 1',
  '    flock -n 9 || return 1',
  '  else',
  '    : >"$LOCK_HELD" || return 1',
  '    ln "$LOCK_HELD" "$LOCK_HELD.target" 2>/dev/null || return 1',
  '  fi',
  '}',
  'lock_release() {',
  '  if [ "$(lock_method)" = flock ]; then',
  '    exec 9>&-',
  '  else',
  '    rm -f "$LOCK_HELD" "$LOCK_HELD.target"',
  '  fi',
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

/** Unpack an archive into a folder, then move the archive's one top folder up into the target. */
export const UNPACK_FUNCTIONS: readonly string[] = [
  'unpack_into() {',
  '  UNPACK_STAGE=$2.stage.$$',
  '  rm -rf "$UNPACK_STAGE"',
  '  mkdir -p "$UNPACK_STAGE" "$2" || return 1',
  '  case $ARCHIVE_FORMAT in',
  '    zip) unzip -q "$1" -d "$UNPACK_STAGE" </dev/null || return 1 ;;',
  '    *) tar -xzf "$1" -C "$UNPACK_STAGE" </dev/null || return 1 ;;',
  '  esac',
  '  unpack_move_top "$UNPACK_STAGE" "$2"',
  '}',
  'unpack_move_top() {',
  '  MOVED=0',
  '  for TOP in "$1"/*; do',
  '    [ -d "$TOP" ] || continue',
  '    for ENTRY in "$TOP"/* "$TOP"/.[!.]*; do',
  '      [ -e "$ENTRY" ] || continue',
  '      mv "$ENTRY" "$2"/ || return 1',
  '      MOVED=1',
  '    done',
  '  done',
  '  rm -rf "$1"',
  '  [ "$MOVED" = 1 ]',
  '}',
];

/** Stop the servers whose process ids are recorded in the data folder. */
export const STOP_FUNCTIONS: readonly string[] = [
  'stop_servers() {',
  '  for PID_FILE in "$DATA_DIR"/.*.pid; do',
  '    [ -f "$PID_FILE" ] || continue',
  '    SERVER_PID=$(cat "$PID_FILE" 2>/dev/null)',
  '    [ -n "$SERVER_PID" ] || continue',
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
