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
prepare_environment() {
  if [ -n "$ENVIRONMENT_SETUP" ] && [ -f "$ENVIRONMENT_SETUP" ]; then
    . "$ENVIRONMENT_SETUP" </dev/null
  fi
  if [ -n "$PROXY_HTTP" ] && [ -z "${http_proxy:-}" ]; then
    http_proxy=$PROXY_HTTP
    export http_proxy
  fi
  if [ -n "$PROXY_HTTPS" ] && [ -z "${https_proxy:-}" ]; then
    https_proxy=$PROXY_HTTPS
    export https_proxy
  fi
}
[ -x "$INSTALL_DIR/$LAUNCHER" ] || finish ServerFailedToStart
prepare_environment
set -- 
POSITION=0
EXTENSION_LOG=$BOOT_PREFIX.extension.$$
for EXTENSION in "$@"; do
  if "$INSTALL_DIR/$LAUNCHER" --install-extension "$EXTENSION" </dev/null >"$EXTENSION_LOG" 2>&1; then
    EXTENSION_STATUS=installed
  else
    EXTENSION_STATUS=failed
  fi
  fact "server.extension.$POSITION.status" "$EXTENSION_STATUS"
  fact "server.extension.$POSITION.message" "$(tail -n 1 "$EXTENSION_LOG" 2>/dev/null | cut -c1-300)"
  POSITION=$((POSITION + 1))
done
rm -f "$EXTENSION_LOG"
finish Ok
