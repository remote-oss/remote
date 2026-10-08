# The SSH host of the acceptance tests: OpenSSH's server, key login only, and one user whose login shell is POSIX sh.
FROM alpine:3.22

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
