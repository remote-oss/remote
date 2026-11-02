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
if [ -x "$INSTALL_TREE/$LAUNCHER" ]; then
  fact server.treeComplete yes
else
  fact server.treeComplete no
fi
finish Ok
