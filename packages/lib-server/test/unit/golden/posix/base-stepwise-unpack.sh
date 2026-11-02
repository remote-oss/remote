if [ -n "${ZSH_VERSION:-}" ]; then
  emulate sh
fi
INSTALL_ROOT=''
DATA_FOLDER='.server-data'
LAUNCHER='bin/launcher'
COMMIT='abc123'
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
progress() {
  printf '%s %s %s\n' 'remote-oss-server-progress' "$1" "$2"
}
unpack_progress() {
  COUNT=0
  LAST=0
  while read -r ENTRY_NAME; do
    COUNT=$((COUNT + 1))
    PERCENT=$((COUNT * 100 / $1))
    if [ "$PERCENT" -lt 100 ] && [ $((PERCENT - LAST)) -ge 5 ]; then
      progress unpack "$PERCENT"
      LAST=$PERCENT
    fi
  done
}
extract_tar() {
  TOTAL=$(tar -tzf "$1" </dev/null 2>/dev/null | wc -l | tr -d " ")
  [ "${TOTAL:-0}" -gt 0 ] || return 1
  progress unpack 0
  { tar -xzvf "$1" -C "$2" </dev/null 2>&1; echo $? >"$2.status"; } | unpack_progress "$TOTAL"
  EXTRACT_CODE=$(cat "$2.status" 2>/dev/null)
  rm -f "$2.status"
  [ "$EXTRACT_CODE" = 0 ] || return 1
  progress unpack 100
}
extract_zip() {
  progress unpack 0
  unzip -q "$1" -d "$2" </dev/null || return 1
  progress unpack 100
}
unpack_into() {
  UNPACK_STAGE=$2.stage.$$
  rm -rf "$UNPACK_STAGE"
  mkdir -p "$UNPACK_STAGE" "$2" || return 1
  case $ARCHIVE_FORMAT in
    zip) extract_zip "$1" "$UNPACK_STAGE" || return 1 ;;
    *) extract_tar "$1" "$UNPACK_STAGE" || return 1 ;;
  esac
  unpack_move_top "$UNPACK_STAGE" "$2"
}
unpack_move_top() {
  ENTRIES=0
  WRAPPER=''
  for ENTRY in "$1"/* "$1"/.[!.]*; do
    [ -e "$ENTRY" ] || continue
    ENTRIES=$((ENTRIES + 1))
    WRAPPER=$ENTRY
  done
  SOURCE=$1
  if [ "$ENTRIES" = 1 ] && [ -d "$WRAPPER" ] && [ ! -L "$WRAPPER" ]; then
    SOURCE=$WRAPPER
  fi
  MOVED=0
  for ENTRY in "$SOURCE"/* "$SOURCE"/.[!.]*; do
    [ -e "$ENTRY" ] || continue
    mv "$ENTRY" "$2"/ || return 1
    MOVED=1
  done
  rm -rf "$1"
  [ "$MOVED" = 1 ]
}
STAGING=$DATA_DIR/bin/$COMMIT-$STAGING_SUFFIX
cat >"$STAGING.archive" || finish UnpackFailed
unpack_into "$STAGING.archive" "$STAGING" || UNPACK_FAILED=yes
rm -f "$STAGING.archive"
[ -z "${UNPACK_FAILED:-}" ] && [ -x "$STAGING/$LAUNCHER" ] || finish UnpackFailed
finish Ok
