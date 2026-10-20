# Dev Containers

Develop inside a container that carries its own toolchain, so each project brings its environment with it.

This extension is under development; its features arrive in coming releases.

## Requirements

The server that powers a dev container window runs inside the container, so the container needs:

- a glibc image with glibc 2.28 or newer, with `libstdc++` and `ldconfig`, or an Alpine (musl) image, on a 64-bit
  Intel/AMD or 64-bit ARM machine;
- `sh` and `tar`. The editor downloads the server archive and copies it in, so the container needs neither `wget` nor
  `curl` for it.

The extension checks this every time a window connects. When the container does not meet the requirements, the dialog
shows the output of the check, and **Learn More** opens this section.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest and activation: the guard against another enabled Dev Containers extension, the proposed-API setup, and the Dev Containers log; the connect to a dev container, with its progress, its label and its failure dialog with Retry, Edit Locally and More Actions...; the checks of the Docker command before a dev container opens and inside the resolve, with their dialogs |
| Components | `containers.package-shell` (`package.json`, `identifiers.json`, `src/activation.ts`, `src/extension.ts`); `containers.engine-host` (`src/engine/`: the Docker CLI behind a port, and its Node adapter); `containers.engine` (`src/engine/` and `src/surfaces/engine-dialogs.ts`: the pre-flight checks of the Docker CLI and their dialogs); `containers.exec` (`src/exec/`: the host channel and the dialer over `docker exec`, the relay script); `containers.cli-bridge` (`src/cli/`: the dev container CLI as a program, its arguments, its output, its override file and what it echoes of the user's secrets; `src/programs/cli-preload.ts`); `containers.reopen` (`src/authority/`: the payload of a dev-container authority; `src/open/`: the Reopen in Container command, its ports and its configuration lookup); `containers.connector` (`src/connect/` and `src/authority/`: the connector of the `dev-container` authority, its server steps, its relay on the host's loopback, its failures and the payload of the authority); `containers.recovery` (`src/surfaces/`: the failure dialog and its quick pick, the presenter that waits for the user, the texts they show, and their editor adapters; `src/open/pending-edit.ts` and `src/state/`: the configuration file that Edit Locally opens in the next window, and the expiring map in `globalState` it keeps it in); `containers.shutdown-manager` (`src/shutdown/` and `src/programs/shutdown-helper.ts`: the registry of the connections that windows tell the shutdown helper about, its ten-second check and its `docker stop`, the effective `shutdownAction`, and the helper program) |
| Allowed imports | `jsonc-parser`, `lib-authority`, `lib-forwarding`, `lib-helper`, `lib-host`, `lib-identifiers`, `lib-log`, `lib-product`, `lib-server`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only; `node:` modules in `src/engine/node-engine-host.ts`, `src/exec/`, `src/cli/node-cli-host.ts`, `src/cli/node-cli-ports.ts`, `src/cli/override-files.ts`, `src/cli/cli-paths.ts`, `src/line-splitter.ts`, `src/open/config-candidates.ts` and `src/programs/` |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host; `src/engine/engine-host.ts`, `src/cli/cli-host.ts` and `src/open/reopen-ports.ts`: types only; `src/engine/node-engine-host.ts`: it spawns real processes, which the server acceptance rows cover; `src/programs/cli-preload.ts`: it runs as a preload in the CLI's own process, which the preload row covers; `src/programs/shutdown-helper.ts`: it runs as a program of its own over real sockets and processes, which the acceptance run covers |
