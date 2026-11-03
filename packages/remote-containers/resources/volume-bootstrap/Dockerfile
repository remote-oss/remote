FROM alpine:3.20
RUN apk add --no-cache ca-certificates docker-cli docker-cli-compose git git-lfs nodejs openssh-client
COPY devcontainers-cli /usr/local/share/remote-oss/devcontainers-cli
COPY cli-preload.js /usr/local/share/remote-oss/cli-preload.js
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
