# The SSH host of the acceptance tests: OpenSSH's server, key login only, and one user whose login shell is POSIX sh
# unless HOST_SHELL names another of the shells installed here. Five more users serve tests that need another kind of account:
# harness-pw (password login only), harness-nofwd (TCP forwarding refused), harness-mute (a login shell that
# answers only a command given with -c), harness-ro (a server data folder that exists and cannot be written), and
# harness-cert, which accepts only a certificate signed by the run's own authority (CA_PUBLIC_KEY, written to
# /etc/ssh/ca.pub by start-sshd).
# libstdc++ is what a musl server's node needs to start on Alpine (F-6302). curl and GNU wget are installed so that
# start-sshd can leave the host with the one download tool a run asks for (HOST_FETCH). iptables lets a test drop the
# packets of port 22 and bring them back (the container runs with NET_ADMIN). xauth lets sshd forward X11, and
# openssh-client brings ssh-add, with which a terminal lists the keys of a forwarded agent.
# alpine:3.22, pinned by the digest of its multi-platform index so that every run builds the same host.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8

RUN apk add --no-cache openssh-server openssh-client xauth iptables libstdc++ curl wget bash zsh dash fish tcsh mksh shadow \
  && ssh-keygen -A \
  && for shell in /bin/bash /bin/zsh /usr/bin/dash /usr/bin/fish /bin/tcsh /bin/csh /bin/mksh; do \
       grep -qx "$shell" /etc/shells || echo "$shell" >> /etc/shells; \
     done \
  && adduser -D -s /bin/sh harness \
  && sed -i 's/^harness:!/harness:*/' /etc/shadow \
  && adduser -D -s /bin/sh harness-pw \
  && adduser -D -s /bin/sh harness-nofwd \
  && sed -i 's/^harness-nofwd:!/harness-nofwd:*/' /etc/shadow \
  && adduser -D -s /bin/sh harness-ro \
  && sed -i 's/^harness-ro:!/harness-ro:*/' /etc/shadow \
  && mkdir -p /home/harness-ro/.vscodium-server-insiders/bin \
  && chown -R root:root /home/harness-ro/.vscodium-server-insiders \
  && chmod -R 755 /home/harness-ro/.vscodium-server-insiders \
  && printf '%s\n' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PubkeyAuthentication yes' \
    'PermitRootLogin no' \
    'AllowTcpForwarding yes' \
    'AllowAgentForwarding yes' \
    'X11Forwarding yes' \
    > /etc/ssh/sshd_config.d/harness.conf

COPY mute-shell /usr/local/bin/mute-shell
RUN echo /usr/local/bin/mute-shell >> /etc/shells \
  && adduser -D -s /usr/local/bin/mute-shell harness-mute \
  && sed -i 's/^harness-mute:!/harness-mute:*/' /etc/shadow \
  && adduser -D -s /bin/sh harness-cert \
  && sed -i 's/^harness-cert:!/harness-cert:*/' /etc/shadow \
  && printf '%s\n' \
    'Match User harness-pw' \
    '  PasswordAuthentication yes' \
    '  KbdInteractiveAuthentication yes' \
    '  PubkeyAuthentication no' \
    'Match User harness-nofwd' \
    '  AllowTcpForwarding no' \
    'Match User harness-cert' \
    '  AuthorizedKeysFile none' \
    '  TrustedUserCAKeys /etc/ssh/ca.pub' \
    >> /etc/ssh/sshd_config

COPY start-sshd /usr/local/bin/start-sshd

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/start-sshd"]
