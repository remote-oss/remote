# The second SSH host of the acceptance tests: Ubuntu 26.04, whose coreutils are uutils, so the rows that read a host's
# tools meet a userland that is neither GNU nor BusyBox. OpenSSH's server, key login only, and two users: harness, whose
# login shell is POSIX sh (dash, Ubuntu's /bin/sh) unless HOST_SHELL names another (the shells of the shell variants,
# bash, zsh, fish, tcsh, csh and mksh, are installed), and harness-mute, whose login shell is the Alpine host's
# mute-shell (it answers only a command given with -c), taken from that image's folder (the build context
# alpine-host). The other twelve accounts are the Alpine host's only. GNU wget and curl are installed so that
# start-sshd can leave the host with the one download tool a run asks for (HOST_FETCH). iptables lets a test drop the
# packets of port 22 and bring them back (the container runs with NET_ADMIN), xauth lets sshd forward X11, procps gives
# the process tools, and netcat-openbsd the nc the rows talk to a port with. busybox (not as /bin/sh) gives the stand-in
# server a listener that runs a program per connection, which OpenBSD's nc has no option for. libstdc++6 is what the
# glibc server's node needs, installed by name so that it never depends on another package pulling it in. Two more
# users log in by keyboard-interactive through PAM, Ubuntu's sshd being built with it: harness-2fa answers a password,
# then a one-time code of the run's secret (libpam-google-authenticator, after pam_unix in sshd's auth stack), and
# harness-expired a password that start-sshd marks expired, so the login asks for a new one (F-2306 AC-27).
# ubuntu:26.04, pinned by the digest of its multi-platform index so that every run builds the same host.
FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server openssh-client xauth iptables procps netcat-openbsd wget curl ca-certificates busybox libstdc++6 \
    bash zsh fish tcsh csh mksh libpam-google-authenticator \
  && rm -rf /var/lib/apt/lists/* \
  && ssh-keygen -A \
  && useradd -m -s /bin/sh harness \
  && usermod -p '*' harness \
  && printf '%s\n' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PubkeyAuthentication yes' \
    'PermitRootLogin no' \
    'AllowTcpForwarding yes' \
    'AllowAgentForwarding yes' \
    'X11Forwarding yes' \
    'Match User harness-2fa,harness-expired' \
    '  KbdInteractiveAuthentication yes' \
    '  PasswordAuthentication no' \
    '  PubkeyAuthentication no' \
    > /etc/ssh/sshd_config.d/harness.conf \
  && sed -i 's/^@include common-auth$/auth required pam_unix.so\nauth required pam_google_authenticator.so nullok/' \
    /etc/pam.d/sshd \
  && grep -qx 'auth required pam_google_authenticator.so nullok' /etc/pam.d/sshd \
  && useradd -m -s /bin/sh harness-2fa \
  && useradd -m -s /bin/sh harness-expired

COPY --from=alpine-host mute-shell /usr/local/bin/mute-shell
RUN chmod 755 /usr/local/bin/mute-shell \
  && echo /usr/local/bin/mute-shell >> /etc/shells \
  && useradd -m -s /usr/local/bin/mute-shell harness-mute \
  && usermod -p '*' harness-mute

COPY start-sshd /usr/local/bin/start-sshd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/start-sshd"]
