# An SSH host of the acceptance tests on Ubuntu 18.04, whose glibc (2.27) is below the server's: the host of the
# prerequisite rows. OpenSSH's server (7.6) with key login only, and the users harness (login shell /bin/sh, dash) and
# harness-mute (the Alpine host's mute-shell, from the build context alpine-host). GNU wget and curl are installed so
# that start-sshd, the Ubuntu 26.04 host's (build context apt-host), can leave the one download tool a run asks for.
# OpenSSH 7.6 reads no sshd_config.d and doesn't know KbdInteractiveAuthentication, so the settings are appended to
# sshd_config, its ChallengeResponseAuthentication standing for the keyboard-interactive switch.
# ubuntu:18.04, pinned by the digest of its multi-platform index so that every run builds the same host.
FROM ubuntu:18.04@sha256:152dc042452c496007f07ca9127571cb9c29697f42acbfad72324b2bb2e43c98

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    openssh-server openssh-client procps netcat-openbsd wget curl ca-certificates tar gzip \
  && rm -rf /var/lib/apt/lists/* \
  && ssh-keygen -A \
  && useradd -m -s /bin/sh harness \
  && usermod -p '*' harness \
  && printf '%s\n' \
    'PasswordAuthentication no' \
    'ChallengeResponseAuthentication no' \
    'PubkeyAuthentication yes' \
    'PermitRootLogin no' \
    'AllowTcpForwarding yes' \
    'AllowAgentForwarding yes' \
    >> /etc/ssh/sshd_config

COPY --from=alpine-host mute-shell /usr/local/bin/mute-shell
RUN chmod 755 /usr/local/bin/mute-shell \
  && echo /usr/local/bin/mute-shell >> /etc/shells \
  && useradd -m -s /usr/local/bin/mute-shell harness-mute \
  && usermod -p '*' harness-mute

COPY --from=apt-host start-sshd /usr/local/bin/start-sshd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/start-sshd"]
