if [ -n "${ZSH_VERSION:-}" ]; then
  emulate sh
fi
INSTALL_ROOT='/opt/root dir'
DATA_FOLDER='.server-data'
LAUNCHER='bin/launcher'
COMMIT='abc1230000000000000000000000000000000000'
ARCHIVE_URL='https://example.invalid/server.tar.gz'
ARCHIVE_PATH='/tmp/a b.tar.gz'
ARCHIVE_REMOVE='yes'
ARCHIVE_FORMAT='tar.gz'
STAGING_SUFFIX='1700000000000'
INSTALL_TREE='/srv/tree'
PROXY_HTTP='http://proxy:3128'
PROXY_HTTPS='http://it'\''s:3129'
USE_CONFIGURATION_FILES='yes'
DOWNLOAD_SECONDS='45'
LOCK_METHOD='flock'
LOCK_IN_TEMPORARY='yes'
LOCK_PREFIX='lock.u'
ENVIRONMENT_SETUP='/etc/profile.d/x.sh'
INSTALL_UMASK='022'
CLEANUP_KIND='keepNewest'
KEEP_COUNT='2'
BIND_HOST='127.0.0.1'
SERVER_PORT='8000-9000'
REQUIREMENTS_HELPER='yes'
READY_SECONDS='3'
SOCKET_MODE='yes'
CLI_NAME='codium-abc1230000000000000000000000000000000000'
CLI_DATA='/home/u/.cli'
CLI_STOP_PID='4242'
[ "$INSTALL_UMASK" = inherit ] || umask "$INSTALL_UMASK"
RESULT_FACTS=''
fact() {
  FACT_VALUE=$(printf '%s' "$2" | tr '\n\r' '  ')
  RESULT_FACTS="${RESULT_FACTS}${1}=${FACT_VALUE}
"
}
report() {
  printf '\n%s\n' 'remote-oss-server-result-begin'
  printf 'status=%s\n' "$1"
  printf '%s' "$RESULT_FACTS"
  printf '%s\n' 'remote-oss-server-result-end'
}
finish() {
  if [ "$ARCHIVE_REMOVE" = yes ] && [ -n "$ARCHIVE_PATH" ] && [ "$1" != LockBusy ]; then
    rm -f "$ARCHIVE_PATH"
  fi
  report "$1"
  exit 0
}
have() {
  command -v "$1" >/dev/null 2>&1
}
now_seconds() {
  date +%s
}
elapsed_milliseconds() {
  echo $(( ( $(now_seconds) - $1 ) * 1000 ))
}
case $INSTALL_ROOT in
  '~') INSTALL_ROOT=$HOME ;;
  '~/'*) INSTALL_ROOT=$HOME/${INSTALL_ROOT#'~/'} ;;
esac
DATA_ROOT=${INSTALL_ROOT:-$HOME}
DATA_DIR=$DATA_ROOT/$DATA_FOLDER
INSTALL_DIR=$DATA_DIR/bin/$COMMIT
CLI_STAGING=$DATA_DIR/cli-bin/$COMMIT
CLI_FILE=$DATA_DIR/$CLI_NAME
BOOT_PREFIX=$DATA_DIR/.$COMMIT
[ -z "$INSTALL_TREE" ] || LOCK_IN_TEMPORARY=yes
is_server_process() {
  case $1 in ''|*[!0-9]*|0|1) return 1 ;; esac
  kill -0 "$1" 2>/dev/null || return 1
  if [ -r "/proc/$1/cmdline" ]; then
    PROCESS_LINE=$(tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null)
  else
    PROCESS_LINE=$(ps -p "$1" -o args= 2>/dev/null)
    if [ -z "$PROCESS_LINE" ]; then
      PROCESS_LINE=$(ps -o pid= -o args= 2>/dev/null | sed -n "s/^ *$1 //p")
    fi
  fi
  case $PROCESS_LINE in
    *"$2"*) return 0 ;;
  esac
  return 1
}
is_server_tree_process() {
  case $1 in ''|*[!0-9]*|0|1) return 1 ;; esac
  [ -r "/proc/$1/cmdline" ] || return 1
  TREE_FIELDS=$(tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null | head -n 2)
  TREE_PROGRAM=$(printf '%s\n' "$TREE_FIELDS" | sed -n 1p)
  TREE_FIRST=$(printf '%s\n' "$TREE_FIELDS" | sed -n 2p)
  case $TREE_PROGRAM in
    "$2"*) return 0 ;;
  esac
  case ${TREE_PROGRAM##*/} in
    sh|bash|dash|ash)
      case $TREE_FIRST in
        "$2"*) return 0 ;;
      esac
      ;;
  esac
  return 1
}
stop_servers() {
  for PID_FILE in "$DATA_DIR"/.*.pid; do
    [ -f "$PID_FILE" ] || continue
    SERVER_PID=$(cat "$PID_FILE" 2>/dev/null)
    is_server_process "$SERVER_PID" "$DATA_DIR/bin/" || continue
    if have pkill; then
      pkill -P "$SERVER_PID" 2>/dev/null
    fi
    kill "$SERVER_PID" 2>/dev/null
  done
  for PROC_DIR in /proc/[0-9]*; do
    SERVER_PID=${PROC_DIR#/proc/}
    [ "$SERVER_PID" != "$$" ] || continue
    is_server_tree_process "$SERVER_PID" "$DATA_DIR/bin/" ||
      is_server_tree_process "$SERVER_PID" "$DATA_DIR/cli/servers/" ||
      continue
    if have pkill; then
      pkill -P "$SERVER_PID" 2>/dev/null
    fi
    kill "$SERVER_PID" 2>/dev/null
  done
}
[ -n "$DATA_ROOT" ] && [ -n "$DATA_FOLDER" ] || finish Ok
stop_servers
if [ "$DATA_ROOT" != "$HOME" ]; then
  [ -n "$HOME" ] || finish Ok
  DATA_DIR=$HOME/$DATA_FOLDER
  stop_servers
fi
rm -rf "${DATA_DIR:?}"
finish Ok
