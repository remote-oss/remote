# The SSH Docker host of the engine rows: the pinned dind image of the second engine (its digest is passed as
# ENGINE_IMAGE from tools/acceptance-second-engine.ts, so it is pinned in one place) with OpenSSH's server, so that a
# client reaches its own daemon as ssh://. Six accounts in the docker group each log in one way:
# - engine: the run's key (ENGINE_KEY at start);
# - engine-pw and engine-pw2: a password only (ENGINE_PASSWORD and ENGINE_PASSWORD_2 at start), keys refused;
# - engine-enc: only the run's passphrase key (ENGINE_ENC_KEY at start);
# - engine-refused: no key accepted and no password method;
# - engine-tries: no key accepted, and two tries at most (MaxAuthTries 2).
# The client's docker CLI runs `docker system dial-stdio` here, so docker is linked where sshd's PATH finds it.
ARG ENGINE_IMAGE
FROM ${ENGINE_IMAGE}

RUN apk add --no-cache openssh-server shadow \
  && ln -s /usr/local/bin/docker /usr/bin/docker \
  && (getent group docker >/dev/null || addgroup -S docker) \
  && for account in engine engine-pw engine-pw2 engine-enc engine-refused engine-tries; do \
       adduser -D -s /bin/sh "$account" && addgroup "$account" docker && sed -i "s/^$account:!/$account:*/" /etc/shadow; \
     done \
  && install -d -m 755 /etc/ssh/keys \
  && printf '%s\n' \
       'PasswordAuthentication no' \
       'KbdInteractiveAuthentication no' \
       'PubkeyAuthentication yes' \
       'AuthorizedKeysFile /etc/ssh/keys/%u' \
       'Match User engine-pw,engine-pw2' \
       '  PasswordAuthentication yes' \
       '  PubkeyAuthentication no' \
       'Match User engine-tries' \
       '  MaxAuthTries 2' \
       > /etc/ssh/sshd_config.d/engine.conf

COPY start-ssh-engine /usr/local/bin/start-ssh-engine
ENTRYPOINT ["/usr/local/bin/start-ssh-engine"]
