# Remote - SSH

Work on any machine you can reach over SSH as if the code were on your own disk.

This extension is under development; its features arrive in coming releases.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | none yet (the connect flow arrives in a later release) |
| Components | the shared connection helper and the askpass program, two programs of their own in `src/programs/` that run outside the editor and ship as `dist/connection-helper.js` and `dist/askpass.js` |
| Allowed imports | `lib-helper` and `lib-ssh` in `src/programs/`; `lib-authority`, `lib-helper`, `lib-host`, `lib-log`, `lib-product`, `lib-server` and `lib-ssh` in `src/pipeline/`; the entry point imports nothing; no program imports `vscode`; `lib-authority`, `lib-companion`, `lib-log` and `lib-ssh` in `src/companion/`; `lib-companion` in `src/extension.ts` |
| Coverage exclusions | `src/extension.ts`: it loads the editor, which exists only in the extension host. `src/programs/connection-helper.ts` and `src/programs/askpass.ts`: each runs as a program of its own over real sockets, files and processes, which the acceptance run covers. `src/pipeline/steps.ts` and `src/surfaces/host-pick.ts`: types only, no executable code |
