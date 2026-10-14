# Dev Containers

Develop inside a container that carries its own toolchain, so each project brings its environment with it.

This extension is under development; its features arrive in coming releases.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest and activation: the guard against another enabled Dev Containers extension, the proposed-API setup, and the Dev Containers log |
| Components | `containers.package-shell` (`package.json`, `identifiers.json`, `src/activation.ts`, `src/extension.ts`) |
| Allowed imports | `lib-authority`, `lib-identifiers`, `lib-log`, `lib-product`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only |
| Coverage exclusions | `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host |
