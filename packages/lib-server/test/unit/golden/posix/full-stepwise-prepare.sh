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
[ -n "$DATA_ROOT" ] || finish CreateInstallDirFailed
STAGING=$DATA_DIR/bin/$COMMIT-$STAGING_SUFFIX
MKDIR_ERROR=$(mkdir -p "$STAGING" 2>&1) || write_failed "$STAGING" "$MKDIR_ERROR"
fact server.stagingDir "$STAGING"
finish Ok
