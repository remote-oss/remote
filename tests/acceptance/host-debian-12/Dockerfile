# An SSH host of the acceptance tests on Debian 12, whose glibc (2.36) is above the server's: a fresh Debian host for
# the real server's rows. OpenSSH's server (9.2) with key login only, and the users harness (login shell /bin/sh, dash)
# and harness-mute (the Alpine host's mute-shell, from the build context alpine-host). GNU wget and curl are installed so
# that start-sshd, the Ubuntu 26.04 host's (build context apt-host), can leave the one download tool a run asks for.
# debian:12, pinned by the digest of its multi-platform index so that every run builds the same host.
FROM debian:12@sha256:2c037a04925515fdd6ea85ea14a682d0e79931f5e9f5d07b6dbfc6ba12f9e858

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server openssh-client procps netcat-openbsd wget curl ca-certificates tar gzip \
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
    > /etc/ssh/sshd_config.d/harness.conf

COPY --from=alpine-host mute-shell /usr/local/bin/mute-shell
RUN chmod 755 /usr/local/bin/mute-shell \
  && echo /usr/local/bin/mute-shell >> /etc/shells \
  && useradd -m -s /usr/local/bin/mute-shell harness-mute \
  && usermod -p '*' harness-mute

COPY --from=apt-host start-sshd /usr/local/bin/start-sshd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/start-sshd"]
