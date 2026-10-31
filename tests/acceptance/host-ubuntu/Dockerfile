# The second SSH host of the acceptance tests: Ubuntu 26.04, whose coreutils are uutils, so the rows that read a host's
# tools meet a userland that is neither GNU nor BusyBox. OpenSSH's server, key login only, and one user, harness, whose
# login shell is POSIX sh (dash, Ubuntu's /bin/sh) unless HOST_SHELL names another: the shells of the shell variants
# (bash, zsh, fish, tcsh, csh, mksh) are installed. The thirteen other accounts are the Alpine host's only. GNU wget and
# curl are installed so that start-sshd can leave the host with the one download tool a run asks for (HOST_FETCH).
# iptables lets a test drop the packets of port 22 and bring them back (the container runs with NET_ADMIN), xauth lets
# sshd forward X11, procps gives the process tools, and netcat-openbsd the nc the rows talk to a port with.
# ubuntu:26.04, pinned by the digest of its multi-platform index so that every run builds the same host.
FROM ubuntu:26.04@sha256:6a06111c3b0a8600feadb270aec771dc239bf407b25625f93f44ab00e11f4d3c

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server openssh-client xauth iptables procps netcat-openbsd wget curl ca-certificates \
    bash zsh fish tcsh csh mksh \
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
    > /etc/ssh/sshd_config.d/harness.conf

COPY start-sshd /usr/local/bin/start-sshd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/start-sshd"]
