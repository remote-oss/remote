# WSL

Open your Linux projects in WSL and use Linux tools from a Windows editor, without leaving it.

This extension is under development; its features arrive in coming releases.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest: identity, activation events, the commands, settings, menus, the WSL Targets view and the key binding; the activation with the stand-down, the commands' registration and the machine's WSL presence; the browser entry |
| Components | `wsl.package` (manifest, string tables, identifiers) and activation (`src/activation.ts`, `src/defaults.ts`, `src/strings.ts`, `src/commands/`, `src/process/`, `src/text/`, `src/activation/`, `src/extension.ts`); `wsl.web-entry` (`src/web-activation.ts`, `src/web-extension.ts`) |
| Allowed imports | `lib-identifiers`, `lib-log`, `lib-standdown`, `lib-wsl`; `vscode` and `node:` modules in `src/extension.ts` and `node:` modules in `src/process/` only; `src/web-extension.ts` imports `vscode` only (no `node:` module, no `lib-wsl`) |
| Coverage exclusions | `src/extension.ts` and `src/web-extension.ts`: they load the `vscode` module, which exists only in the extension host |
