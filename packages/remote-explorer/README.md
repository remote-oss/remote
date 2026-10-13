# Remote Explorer

Every remote target in one view: SSH hosts, containers and WSL distros, one click away.

This extension is under development; its features arrive in coming releases.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest: identity, activation event, the view, and the Refresh and connect commands |
| Components | `explorer.package` (manifest, string tables, identifiers) and activation (`src/activation.ts`, `src/window-activation.ts`, `src/extension.ts`, `src/web-extension.ts`); `src/model/` (the SSH group's rows and the connected marker) |
| Allowed imports | `lib-authority`, `lib-identifiers`, `lib-product`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only; `src/web-extension.ts` imports `vscode` only (no `node:` module, no `lib-authority`, no `lib-product`) |
| Coverage exclusions | `src/extension.ts` and `src/web-extension.ts`: they load the `vscode` module, which exists only in the extension host |
