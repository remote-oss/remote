# Dev Containers

Develop inside a container that carries its own toolchain, so each project brings its environment with it.

This extension is under development; its features arrive in coming releases.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest and activation: the guard against another enabled Dev Containers extension, the proposed-API setup, and the Dev Containers log; the connect to a dev container, with its progress, its label and its failure dialog; the checks of the Docker command before a dev container opens and inside the resolve, with their dialogs |
| Components | `containers.package-shell` (`package.json`, `identifiers.json`, `src/activation.ts`, `src/extension.ts`); `containers.engine-host` (`src/engine/`: the Docker CLI behind a port, and its Node adapter); `containers.engine` (`src/engine/` and `src/surfaces/engine-dialogs.ts`: the pre-flight checks of the Docker CLI and their dialogs); `containers.exec` (`src/exec/`: the host channel and the dialer over `docker exec`, the relay script); `containers.cli-bridge` (`src/cli/`: the dev container CLI as a program, its arguments, its output, its override file and what it echoes of the user's secrets; `src/programs/cli-preload.ts`); `containers.reopen` (`src/authority/`: the payload of a dev-container authority; `src/open/`: the Reopen in Container command, its ports and its configuration lookup); `containers.connector` (`src/connect/`: the connector of the `dev-container` authority, its server steps, its relay on the host's loopback, its failures and the presenter of slice 1) |
| Allowed imports | `jsonc-parser`, `lib-authority`, `lib-forwarding`, `lib-helper`, `lib-host`, `lib-identifiers`, `lib-log`, `lib-product`, `lib-server`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only; `node:` modules in `src/engine/node-engine-host.ts`, `src/exec/`, `src/cli/node-cli-host.ts`, `src/cli/node-cli-ports.ts`, `src/cli/override-files.ts`, `src/cli/cli-paths.ts`, `src/line-splitter.ts`, `src/open/config-candidates.ts` and `src/programs/` |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host; `src/engine/engine-host.ts`, `src/cli/cli-host.ts` and `src/open/reopen-ports.ts`: types only; `src/engine/node-engine-host.ts`: it spawns real processes, which the server acceptance rows cover; `src/programs/cli-preload.ts`: it runs as a preload in the CLI's own process, which the preload row covers |
