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
wget_is_busybox() {
  wget --help 2>&1 </dev/null | grep -i busybox >/dev/null 2>&1
}
fetch_archive() {
  FETCH_ERROR=''
  FETCH_STATUS=0
  if have wget; then
    if wget_is_busybox; then
      FETCH_ERROR=$(wget -q -T "$DOWNLOAD_SECONDS" -O "$2" "$1" </dev/null 2>&1) || FETCH_STATUS=$?
    elif [ "$USE_CONFIGURATION_FILES" = yes ]; then
      FETCH_ERROR=$(wget -q -S -T "$DOWNLOAD_SECONDS" -O "$2" "$1" </dev/null 2>&1) || FETCH_STATUS=$?
    else
      FETCH_ERROR=$(wget --no-config -q -S -T "$DOWNLOAD_SECONDS" -O "$2" "$1" </dev/null 2>&1) || FETCH_STATUS=$?
    fi
  elif have curl; then
    if [ "$USE_CONFIGURATION_FILES" = yes ]; then
      FETCH_ERROR=$(curl -fsSL --max-time "$DOWNLOAD_SECONDS" -o "$2" "$1" </dev/null 2>&1) || FETCH_STATUS=$?
    else
      FETCH_ERROR=$(curl -q -fsSL --max-time "$DOWNLOAD_SECONDS" -o "$2" "$1" </dev/null 2>&1) || FETCH_STATUS=$?
    fi
  else
    return 127
  fi
  [ "$FETCH_STATUS" = 0 ] && return 0
  LAST_RESPONSE=$(printf '%s\n' "$FETCH_ERROR" | grep -o 'HTTP/1\.[01] [0-9][0-9][0-9]' | tail -n 1)
  case $LAST_RESPONSE in
    'HTTP/1.0 404' | 'HTTP/1.1 404') fact server.downloadStatus 404 ;;
    '') case $FETCH_ERROR in *'error: 404'*) fact server.downloadStatus 404 ;; esac ;;
  esac
  return "$FETCH_STATUS"
}
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
leave() {
  lock_release
  finish "$1"
}
clear_staging() {
  rm -rf "$CLI_STAGING" "$CLI_STAGING".stage.*
  rmdir "$DATA_DIR/cli-bin" 2>/dev/null
}
STARTED_AT=$(now_seconds)
[ -n "$DATA_ROOT" ] && [ -n "$CLI_NAME" ] || finish CreateInstallDirFailed
MKDIR_ERROR=$(mkdir -p "$INSTALL_DIR" 2>&1) || write_failed "$INSTALL_DIR" "$MKDIR_ERROR"
take_lock_or_finish "$COMMIT"
if [ -x "$CLI_FILE" ]; then
  fact cli.path "$CLI_FILE"
  leave Ok
fi
MKDIR_ERROR=$(mkdir -p "$CLI_STAGING" 2>&1) || write_failed_leave "$CLI_STAGING" "$MKDIR_ERROR"
prepare_environment
if [ -n "$ARCHIVE_PATH" ]; then
  ARCHIVE=$ARCHIVE_PATH
else
  have wget || have curl || leave NoDownloaderAvailable
  ARCHIVE=$CLI_STAGING.archive.$$
  fetch_archive "$ARCHIVE_URL" "$ARCHIVE" || { rm -f "$ARCHIVE"; clear_staging; leave ServerDownloadFailed; }
fi
DOWNLOADED_AT=$(now_seconds)
unpack_into "$ARCHIVE" "$CLI_STAGING" || UNPACK_FAILED=yes
[ -n "$ARCHIVE_PATH" ] || rm -f "$ARCHIVE"
if [ -n "${UNPACK_FAILED:-}" ] || [ ! -f "$CLI_STAGING/$LAUNCHER" ]; then
  clear_staging
  leave UnpackFailed
fi
chmod +x "$CLI_STAGING/$LAUNCHER" && mv "$CLI_STAGING/$LAUNCHER" "$CLI_FILE" || { clear_staging; leave UnpackFailed; }
clear_staging
fact cli.path "$CLI_FILE"
fact timing.download "$(( ( DOWNLOADED_AT - STARTED_AT ) * 1000 ))"
fact timing.install "$(elapsed_milliseconds "$DOWNLOADED_AT")"
leave Ok
