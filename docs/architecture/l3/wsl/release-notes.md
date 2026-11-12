# Remote - WSL: release notes

## Deviations

Where the reimplementation departs from a published spec line on purpose. Each entry names its ruling, which
`brief-remote-wsl.md` (#2348) or one of its four parts records, and the spec question asked on remote-oss/remote-wsl.

- **A distro whose drive mount is off still connects** (`ruling-2348-script-by-stdin`, brief-wsl-connect §3). The script
  and the relay reach the distro over standard input and arguments, not through `/mnt`, so F-6304 AC-10's first clause
  (the connect fails with automount off) doesn't hold.
- **No background download of an update's server** (`ruling-2348-no-update-signal`, brief-wsl-connect §2). F-7902
  rule 10 and AC-29, and F-6301 BR-13 and AC-19, fetch the server of an update the editor has detected; no extension API
  reports one. `remote.WSL.downloadInBackground` is read, and one log line says nothing was prefetched.
- **An unknown machine type is an unsupported platform** (`ruling-2348-unknown-arch`, brief-wsl-connect §2). F-6302
  AC-11 fetches the x64 build in the distro; an x64 server on a machine that isn't x64 can't start and leaves an install
  behind.
- **Reopen in WSL refuses an untitled workspace before the picker** (`ruling-2348-untitled-workspace`,
  brief-wsl-commands §3). F-6204 Q3 option (a), AC-30 and AC-31 reopen the workspace file core's save prompt wrote; that
  prompt runs as the window unloads, after our command has passed its target, so the path never comes back.
- **VSCodium's kept archives sit under a product folder** (`ruling-2348-cache-product-level`, brief-wsl-connect §2).
  ADR-0006 decision 4 adds `<applicationName>\` for products other than `code` and `code-insiders`, where F-7902 rule 4's
  layout is flat. Genuine VS Code's layout is rule 4's.
- **The README describes the other WSL extension without naming it** (`ruling-2348-readme-voice`,
  brief-wsl-package §5). F-7904 B-3's items are said in ADR-0008's neutral voice ("another extension that provides the
  `wsl` authority").
