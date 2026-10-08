# The SSH host of the acceptance tests: OpenSSH's server, key login only, and one user whose login shell is POSIX sh.
# alpine:3.22, pinned by the digest of its multi-platform index so that every run builds the same host.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8

RUN apk add --no-cache openssh-server \
  && ssh-keygen -A \
  && adduser -D -s /bin/sh harness \
  && sed -i 's/^harness:!/harness:*/' /etc/shadow \
  && printf '%s\n' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PubkeyAuthentication yes' \
    'PermitRootLogin no' \
    'AllowTcpForwarding yes' \
    > /etc/ssh/sshd_config.d/harness.conf

COPY start-sshd /usr/local/bin/start-sshd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/start-sshd"]
