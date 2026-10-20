# Remote Explorer

Every remote target in one view: SSH hosts, containers and WSL distros, one click away.

This extension is under development; its features arrive in coming releases.

## Good to know

- Remote Explorer collects no telemetry.
- Running it beside another Remote Explorer extension isn't supported: when one is installed and enabled, this one
  stands down and shows a warning.
- Extension packs that list another Remote Explorer extension don't install this one. Install it directly.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the package manifest: identity, activation event, the view, and the Refresh and connect commands |
| Components | `explorer.package` (manifest, string tables, identifiers) and activation (`src/activation.ts`, `src/window-activation.ts`, `src/extension.ts`, `src/web-extension.ts`); `src/model/` (the SSH group's rows and the connected marker); `explorer.targets-view` (`src/view/`: the companion calls, the targets, the tree adapter) |
| Allowed imports | `lib-authority`, `lib-companion`, `lib-identifiers`, `lib-product`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only; `src/web-extension.ts` imports `vscode` only (no `node:` module, no `lib-authority`, no `lib-product`) |
| Coverage exclusions | `src/extension.ts` and `src/web-extension.ts`: they load the `vscode` module, which exists only in the extension host |
