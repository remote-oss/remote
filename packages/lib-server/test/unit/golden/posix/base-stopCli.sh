if [ -n "${ZSH_VERSION:-}" ]; then
  emulate sh
fi
INSTALL_ROOT=''
DATA_FOLDER='.server-data'
LAUNCHER='bin/launcher'
COMMIT='abc1230000000000000000000000000000000000'
ARCHIVE_URL='https://example.invalid/server.tar.gz'
ARCHIVE_PATH=''
ARCHIVE_REMOVE='no'
ARCHIVE_FORMAT='tar.gz'
STAGING_SUFFIX='1700000000000'
INSTALL_TREE=''
PROXY_HTTP=''
PROXY_HTTPS=''
USE_CONFIGURATION_FILES='no'
DOWNLOAD_SECONDS='30'
LOCK_METHOD='link'
LOCK_IN_TEMPORARY='no'
LOCK_PREFIX='boot-lock.user'
ENVIRONMENT_SETUP=''
INSTALL_UMASK='inherit'
CLEANUP_KIND='keepNewest'
KEEP_COUNT='5'
BIND_HOST='127.0.0.1'
SERVER_PORT='0'
REQUIREMENTS_HELPER='no'
READY_SECONDS='3'
SOCKET_MODE='no'
CLI_NAME=''
CLI_DATA=''
CLI_STOP_PID=''
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
is_cli_process() {
  case $1 in ''|*[!0-9]*|0|1) return 1 ;; esac
  [ -r "/proc/$1/cmdline" ] || return 1
  CLI_ARGUMENT_0=$(tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null | sed -n 1p)
  CLI_ARGUMENT_1=$(tr '\0' '\n' <"/proc/$1/cmdline" 2>/dev/null | sed -n 2p)
  [ "$CLI_ARGUMENT_0" = "$CLI_FILE" ] && [ "$CLI_ARGUMENT_1" = command-shell ]
}
if is_cli_process "$CLI_STOP_PID"; then
  kill "$CLI_STOP_PID" 2>/dev/null
  fact cli.stopped yes
else
  fact cli.stopped no
fi
finish Ok
