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
cli_ready_port() {
  sed -n 's/^Listening on 127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' "$LOG_FILE" 2>/dev/null | head -n 1
}
connection_token_usable() {
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  case $(ls -ln "$1" 2>/dev/null) in -rw-------*|-r--------*) ;; *) return 1 ;; esac
  TOKEN_TEXT=$(cat "$1" 2>/dev/null) || return 1
  case $TOKEN_TEXT in ''|*[!0-9A-Za-z_-]*) return 1 ;; esac
  [ "${#TOKEN_TEXT}" -le 128 ]
}
[ -x "$CLI_FILE" ] || finish ServerFailedToStart
[ -n "${VSCODE_CLI_REQUIRE_TOKEN:-}" ] || { fact cli.tokenMissing yes; finish ServerFailedToStart; }
TOKEN_FILE=$CLI_DATA/connection-token
(umask 077; mkdir -p "$CLI_DATA") || finish ServerFailedToStart
if [ ! -e "$TOKEN_FILE" ] && [ ! -L "$TOKEN_FILE" ]; then
  TOKEN_TEMPORARY=$TOKEN_FILE.$$
  (umask 077; tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32 >"$TOKEN_TEMPORARY")
  TOKEN_LENGTH=$(wc -c <"$TOKEN_TEMPORARY" 2>/dev/null)
  [ "$((TOKEN_LENGTH + 0))" -eq 32 ] && ln "$TOKEN_TEMPORARY" "$TOKEN_FILE" 2>/dev/null
  rm -f "$TOKEN_TEMPORARY"
fi
[ -e "$TOKEN_FILE" ] || [ -L "$TOKEN_FILE" ] || finish ServerFailedToStart
connection_token_usable "$TOKEN_FILE" || { fact cli.tokenInvalid yes; finish ServerFailedToStart; }
fact cli.connectionToken "$(cat "$TOKEN_FILE")"
LOG_FILE=$DATA_DIR/.cli.$COMMIT.log
(umask 077; printf '' >"$LOG_FILE") || finish ServerFailedToStart
nohup "$CLI_FILE" command-shell --on-host 127.0.0.1 --on-port 0 --cli-data-dir "$CLI_DATA" --parent-process-id "$PPID" </dev/null >"$LOG_FILE" 2>&1 9>&- &
CLI_PID=$!
if sleep 0.2 2>/dev/null; then TICK=0.2; TICKS=$((READY_SECONDS * 5)); else TICK=1; TICKS=$READY_SECONDS; fi
WAITED=0
while [ "$WAITED" -lt "$TICKS" ]; do
  CLI_PORT=$(cli_ready_port)
  if [ -n "$CLI_PORT" ]; then
    fact cli.port "$CLI_PORT"
    fact cli.pid "$CLI_PID"
    fact cli.log "$LOG_FILE"
    finish Ok
  fi
  kill -0 "$CLI_PID" 2>/dev/null || finish ServerFailedToStart
  sleep "$TICK"
  WAITED=$((WAITED + 1))
done
kill "$CLI_PID" 2>/dev/null
finish ServerFailedToStart
