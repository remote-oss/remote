# The client image of the tunnels run (#3076): the Rust client built from rust-client/ on a toolchain pinned by digest,
# beside the suite's TypeScript client and the SDK at the lockfile's version (`pnpm deploy --prod` of the suite's
# package). Built in the run and never pushed. The rows run its programs with `docker exec`, trusting the run's
# authority through NODE_EXTRA_CA_CERTS (Node) and SSL_CERT_FILE (the Rust client's OpenSSL).
FROM rust:1.100.0-slim-bookworm@sha256:bb875b0f8ce726053e259034848c471840e96bfe591fd52556178ae9a05e6126 AS rust
RUN apt-get update && apt-get install --yes --no-install-recommends git libssl-dev pkg-config \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY rust-client/ .
RUN cargo build --release --locked

FROM node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates libssl3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=rust /build/target/release/tunnels-rust-client /usr/local/bin/tunnels-rust-client
WORKDIR /client
COPY . .
USER node
ENTRYPOINT ["sleep", "infinity"]
