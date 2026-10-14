# Dev Containers

Develop inside a container that carries its own toolchain, so each project brings its environment with it.

This extension is under development; its features arrive in coming releases.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest and activation: the guard against another enabled Dev Containers extension, the proposed-API setup, and the Dev Containers log |
| Components | `containers.package-shell` (`package.json`, `identifiers.json`, `src/activation.ts`, `src/extension.ts`); `containers.engine-host` (`src/engine/`: the Docker CLI behind a port, and its Node adapter); `containers.exec` (`src/exec/`: the host channel and the dialer over `docker exec`, the relay script) |
| Allowed imports | `lib-authority`, `lib-forwarding`, `lib-host`, `lib-identifiers`, `lib-log`, `lib-product`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only; `node:` modules in `src/engine/node-engine-host.ts` and `src/exec/` |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host; `src/engine/engine-host.ts`: types only; `src/engine/node-engine-host.ts`: it spawns real processes, which the server acceptance rows cover |
