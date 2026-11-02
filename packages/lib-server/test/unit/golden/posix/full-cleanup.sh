if [ -n "${ZSH_VERSION:-}" ]; then
  emulate sh
fi
INSTALL_ROOT='/opt/root dir'
DATA_FOLDER='.server-data'
LAUNCHER='bin/launcher'
COMMIT='abc123'
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
CLI_NAME='codium-abc123'
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
lock_method() {
  if [ "$LOCK_METHOD" = flock ] && have flock; then
    echo flock
  else
    echo link
  fi
}
lock_path() {
  if [ "$LOCK_IN_TEMPORARY" = yes ]; then
    echo "/tmp/$LOCK_PREFIX.$1"
  else
    echo "$DATA_DIR/bin/$1/$LOCK_PREFIX.$1"
  fi
}
lock_link() {
  if LOCK_ERROR=$(ln "$LOCK_CANDIDATE" "$LOCK_CANDIDATE.target" 2>&1); then
    LOCK_ERROR=''
    return 0
  fi
  [ ! -e "$LOCK_CANDIDATE.target" ] || return 1
  return 2
}
lock_take() {
  LOCK_CANDIDATE=$(lock_path "$1")
  LOCK_ERROR=''
  if [ "$LOCK_IN_TEMPORARY" = yes ]; then
    if [ -L "$LOCK_CANDIDATE" ] || { [ -e "$LOCK_CANDIDATE" ] && [ ! -f "$LOCK_CANDIDATE" ]; }; then
      LOCK_ERROR='not a regular file'
      return 2
    fi
  fi
  if [ "$(lock_method)" = flock ]; then
    LOCK_ERROR=$( ( exec 9>>"$LOCK_CANDIDATE" ) 2>&1 ) || return 2
    exec 9>>"$LOCK_CANDIDATE"
    if LOCK_ERROR=$(flock -n 9 2>&1); then
      LOCK_ERROR=''
    else
      [ -z "$LOCK_ERROR" ] || return 2
      return 1
    fi
  else
    for LOCK_ATTEMPT in 1 2; do
      LOCK_ERROR=$( { true >>"$LOCK_CANDIDATE"; } 2>&1 ) || return 2
      lock_link
      LOCK_STATUS=$?
      [ "$LOCK_STATUS" = 2 ] || break
    done
    [ "$LOCK_STATUS" = 0 ] || return "$LOCK_STATUS"
  fi
  LOCK_HELD=$LOCK_CANDIDATE
  trap 'exit 1' HUP INT TERM
  trap 'lock_release' EXIT
}
write_failed() {
  fact server.writeFailedPath "$1"
  fact server.writeFailedError "$2"
  finish CreateInstallDirFailed
}
write_failed_leave() {
  lock_release
  write_failed "$1" "$2"
}
take_lock_or_finish() {
  lock_take "$1"
  case $? in
    0) ;;
    1) fact server.lockPath "$LOCK_CANDIDATE"; finish LockBusy ;;
    *)
      fact server.lockPath "$LOCK_CANDIDATE"
      fact server.lockInTemporary "$LOCK_IN_TEMPORARY"
      write_failed "$LOCK_CANDIDATE" "$LOCK_ERROR"
      ;;
  esac
}
lock_release() {
  [ -n "${LOCK_HELD:-}" ] || return 0
  if [ "$(lock_method)" = flock ]; then
    exec 9>&-
  else
    rm -f "$LOCK_HELD" "$LOCK_HELD.target"
  fi
  LOCK_HELD=''
}
folder_kind() {
  HEAD_PART=$(printf '%s' "$1" | cut -c1-40)
  case $HEAD_PART in
    *[!0-9a-f]*) echo other; return ;;
  esac
  if [ "${#HEAD_PART}" != 40 ]; then
    echo other
  elif [ "${#1}" = 40 ]; then
    echo commit
  else
    case $1 in
      "$HEAD_PART"-*) echo leftover ;;
      *) echo other ;;
    esac
  fi
}
remove_install() {
  if lock_take "$1"; then
    rm -rf "${DATA_DIR:?}/bin/$1" "$DATA_DIR/.$1.log" "$DATA_DIR/.$1.pid" "$DATA_DIR/.$1.token" "$DATA_DIR/.$1.socket.log" "$DATA_DIR/.$1.socket.pid" "$DATA_DIR/.$1.socket.token"
    lock_release
  fi
}
[ -n "$DATA_ROOT" ] && [ -n "$DATA_FOLDER" ] || finish Ok
[ -d "$DATA_DIR/bin" ] || finish Ok
INDEX=0
ls -t "$DATA_DIR/bin" 2>/dev/null | while IFS= read -r NAME; do
  INDEX=$((INDEX + 1))
  [ "$NAME" != "$COMMIT" ] || continue
  KIND=$(folder_kind "$NAME")
  case $CLEANUP_KIND in
    keepNewest)
      [ "$INDEX" -gt "$KEEP_COUNT" ] && remove_install "$NAME"
      ;;
    onlyCurrentRemoveLeftovers)
      [ "$KIND" = other ] || remove_install "$NAME"
      ;;
    *)
      [ "$KIND" != commit ] || remove_install "$NAME"
      ;;
  esac
done
finish Ok
