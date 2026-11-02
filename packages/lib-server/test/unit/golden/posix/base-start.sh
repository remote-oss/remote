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
leave() {
  lock_release
  finish "$1"
}
if [ "$SOCKET_MODE" = yes ]; then KIND_PREFIX=$BOOT_PREFIX.socket; else KIND_PREFIX=$BOOT_PREFIX; fi
PID_FILE=$KIND_PREFIX.pid
LOG_FILE=$KIND_PREFIX.log
TOKEN_FILE=$KIND_PREFIX.token
STARTED_AT=$(now_seconds)
ready_port() {
  if [ "$SOCKET_MODE" = yes ]; then
    sed -n 's/^Extension host agent listening on \(\/[^ ]*\)$/\1/p' "$LOG_FILE" 2>/dev/null | tail -n 1
  else
    sed -n 's/^Extension host agent listening on \([0-9][0-9]*\)$/\1/p' "$LOG_FILE" 2>/dev/null | tail -n 1
  fi
}
cve_terminated() {
  grep -q '^\* !!!! Server terminated due to presence of CVE-2020-1416 !!!!$' "$LOG_FILE" 2>/dev/null
}
start_failed() {
  if grep -q '^--port: Could not find free port in range: ' "$LOG_FILE" 2>/dev/null; then
    fact server.failure noFreePort
  elif cve_terminated; then
    fact server.failure cveTerminated
  fi
  leave ServerFailedToStart
}
started() {
  [ -s "$TOKEN_FILE" ] || start_failed
  case $SOCKET_MODE:$1 in
    yes:/*) fact server.socketPath "$1" ;;
    no:*[!0-9]*|no:|no:0*) start_failed ;;
    no:*) fact server.port "$1" ;;
    *) start_failed ;;
  esac
  fact server.pid "$2"
  fact server.token "$(cat "$TOKEN_FILE" 2>/dev/null)"
  fact server.log "$LOG_FILE"
  if [ "$LAUNCHED" = yes ]; then
    fact server.reused no
  else
    fact server.reused yes
  fi
  fact host.kernel "$(uname -r 2>/dev/null)"
  fact timing.start "$(elapsed_milliseconds "$STARTED_AT")"
  leave Ok
}
[ -x "$INSTALL_DIR/$LAUNCHER" ] || finish ServerFailedToStart
take_lock_or_finish "$COMMIT"
RUNNING_PID=$(cat "$PID_FILE" 2>/dev/null)
if is_server_process "$RUNNING_PID" "$INSTALL_DIR"; then
  SERVER_PID=$RUNNING_PID
  LAUNCHED=no
else
  prepare_environment
if [ "$REQUIREMENTS_HELPER" = yes ]; then
  REQUIREMENTS_SCRIPT=$INSTALL_DIR/bin/helpers/check-requirements.sh
  if [ -f "$REQUIREMENTS_SCRIPT" ]; then
    REQUIREMENTS_STATUS=0
    REQUIREMENTS_OUTPUT=$(sh "$REQUIREMENTS_SCRIPT" 2>&1) || REQUIREMENTS_STATUS=$?
    if [ "$REQUIREMENTS_STATUS" = 99 ]; then
      REQUIREMENTS_LINE=0
      if [ -n "$REQUIREMENTS_OUTPUT" ]; then
        while IFS= read -r REQUIREMENTS_TEXT; do
          [ "$REQUIREMENTS_LINE" -lt 20 ] || break
          REQUIREMENTS_LINE=$((REQUIREMENTS_LINE + 1))
          REQUIREMENTS_TEXT=$(printf '%s' "$REQUIREMENTS_TEXT" | tr -d '\r' | cut -c1-500)
          fact "server.prerequisites.$REQUIREMENTS_LINE" "$REQUIREMENTS_TEXT"
        done <<REQUIREMENTS_END
$REQUIREMENTS_OUTPUT
REQUIREMENTS_END
      fi
      leave LinuxPrereqs
    fi
  else
    fact server.prerequisitesHelper missing
  fi
fi
  if [ ! -s "$TOKEN_FILE" ]; then
    WRITE_ERROR=$( (umask 077; tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 >"$TOKEN_FILE") 2>&1 )
  fi
  [ -s "$TOKEN_FILE" ] || write_failed_leave "$TOKEN_FILE" "${WRITE_ERROR:-the token file is empty}"
  if [ "$SOCKET_MODE" = yes ]; then
    SOCKET_HEX=$(tr -dc 'a-f0-9' </dev/urandom | head -c 32)
    SOCKET_VARIANT=$(tr -dc '89ab' </dev/urandom | head -c 1)
    SOCKET_NAME=$(printf '%s' "$SOCKET_HEX" | sed "s/^\(........\)\(....\).\(...\).\(...\)\(............\)$/\1-\2-4\3-$SOCKET_VARIANT\4-\5/")
    TAB=$(printf '\t')
    NEWLINE='
'
    if [ -z "${TMPDIR+set}" ]; then
      SOCKET_FOLDER=/tmp
    else
      case $TMPDIR in
        '') SOCKET_FOLDER=/tmp; fact server.socketFolderFallback empty ;;
        *" "*|*"$TAB"*|*"$NEWLINE"*) SOCKET_FOLDER=/tmp; fact server.socketFolderFallback whiteSpace ;;
        /*) if [ -d "$TMPDIR" ] && [ -w "$TMPDIR" ]; then
             SOCKET_FOLDER=$TMPDIR
           else
             SOCKET_FOLDER=/tmp; fact server.socketFolderFallback unusable
           fi ;;
        *) SOCKET_FOLDER=/tmp; fact server.socketFolderFallback relative ;;
      esac
    fi
    SOCKET_FILE="$SOCKET_FOLDER/code-$SOCKET_NAME"
  fi
  set -- '--start-server' '--host' '127.0.0.1' '--port' '0' '--connection-token-file' "$TOKEN_FILE" '--telemetry-level' 'off' '--enable-remote-auto-shutdown'
  WRITE_ERROR=$( (umask 077; printf '' >"$LOG_FILE") 2>&1 ) || write_failed_leave "$LOG_FILE" "$WRITE_ERROR"
  printf '%s\n' 'server.launching=yes'
  fact server.launching yes
  nohup "$INSTALL_DIR/$LAUNCHER" "$@" </dev/null >"$LOG_FILE" 2>&1 9>&- &
  SERVER_PID=$!
  WRITE_ERROR=$( { echo "$SERVER_PID" >"$PID_FILE"; } 2>&1 ) || { kill "$SERVER_PID" 2>/dev/null; write_failed_leave "$PID_FILE" "$WRITE_ERROR"; }
  LAUNCHED=yes
fi
if sleep 0.2 2>/dev/null; then TICK=0.2; TICKS=$((READY_SECONDS * 5)); else TICK=1; TICKS=$READY_SECONDS; fi
WAITED=0
while [ "$WAITED" -lt "$TICKS" ]; do
  SERVER_PORT_READ=$(ready_port)
  [ -z "$SERVER_PORT_READ" ] || started "$SERVER_PORT_READ" "$SERVER_PID"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    [ "$LAUNCHED" = yes ] || start_failed
    ! cve_terminated || start_failed
  fi
  sleep "$TICK"
  WAITED=$((WAITED + 1))
done
start_failed
