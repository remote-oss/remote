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
wget_is_busybox() {
  wget --help 2>&1 </dev/null | grep -i busybox >/dev/null 2>&1
}
fact host.tmp "${TMPDIR:-/tmp}"
fact host.home "${HOME:-}"
OS_NAME=$(uname -s 2>/dev/null)
case $OS_NAME in
  Linux) HOST_OS=linux ;;
  Darwin) HOST_OS=darwin ;;
  *)
    fact host.os "$OS_NAME"
    finish UnsupportedPlatform
    ;;
esac
fact host.os "$HOST_OS"
MACHINE=$(uname -m 2>/dev/null)
case $MACHINE in
  x86_64) HOST_ARCH=x64 ;;
  aarch64 | arm64) HOST_ARCH=arm64 ;;
  armv7l | armv8l) HOST_ARCH=armhf ;;
  ppc64le) HOST_ARCH=ppc64le ;;
  riscv64) HOST_ARCH=riscv64 ;;
  loongarch64) HOST_ARCH=loong64 ;;
  s390x) HOST_ARCH=s390x ;;
  *)
    fact host.arch "$MACHINE"
    finish UnsupportedArch
    ;;
esac
fact host.arch "$HOST_ARCH"
HOST_LIBC=unknown
if [ "$HOST_OS" = linux ]; then
  for LOADER in /lib/ld-musl-* /usr/lib/ld-musl-*; do
    [ ! -e "$LOADER" ] || HOST_LIBC=musl
  done
  if [ "$HOST_LIBC" = unknown ] && have getconf && getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
    HOST_LIBC=glibc
  fi
fi
fact host.libc "$HOST_LIBC"
fact host.kernel "$(uname -r 2>/dev/null)"
RELEASE_ID=$(. /etc/os-release >/dev/null 2>&1 </dev/null; echo "${ID:-}")
fact host.release "${RELEASE_ID:-$OS_NAME}"
for TOOL in wget curl tar unzip flock gzip; do
  if have "$TOOL"; then
    fact "host.tool.$TOOL" yes
  else
    fact "host.tool.$TOOL" no
  fi
done
if have wget && wget_is_busybox; then
  fact host.wgetBusybox yes
else
  fact host.wgetBusybox no
fi
fact host.shell "${SHELL:-}"
fact host.sshAuthSock "${SSH_AUTH_SOCK:-}"
fact host.display "${DISPLAY:-}"
fact server.installDir "$INSTALL_DIR"
if [ -x "$INSTALL_DIR/$LAUNCHER" ]; then
  fact server.installed yes
else
  fact server.installed no
fi
finish Ok
