# The relay of the tunnels run (#3076): the relay package as `pnpm deploy --prod` lays it out from the lockfile, built in
# the run and never pushed, so it holds no credential and needs no registry. The base is the Node that .node-version
# names, pinned by digest. The stub identity service runs on the same image, from the suite's folder mounted read-only.
FROM node:24.22.3-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /relay
COPY . .
USER node
ENTRYPOINT ["node", "src/main.ts"]
