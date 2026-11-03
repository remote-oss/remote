# Remote - SSH

Work on any machine you can reach over SSH as if the code were on your own disk.

## Installing

- From Open VSX, by the extension's id, `remote-oss.remote-ssh`.
- In an editor whose gallery is not Open VSX, from a VSIX file on
  [this repository's releases page](https://github.com/remote-oss/remote/releases). The two
  companions, `remote-oss.remote-ssh-edit` and `remote-oss.remote-explorer`, are installed the
  same way, from their VSIX files on the same page. The editor installs the companions together
  with the extension only from Open VSX.

## Updates

In an editor whose gallery is not Open VSX, a VSIX install gets no automatic updates and no
pre-release channel. A newer version is installed by hand, the same way as the first one.

## Uninstalling and disabling

Uninstalling the extension uninstalls both companions; disabling it disables both.

## One at a time

Only one extension for the `ssh-remote` authority may be enabled at a time. If another one is
enabled, it must be disabled.

## The proposed API

The extension needs the editor's proposed APIs enabled for it. Add the extension's id to
`enable-proposed-api` in the editor's `argv.json`, then restart the editor:

```json
{
  "enable-proposed-api": [
    "remote-oss.remote-ssh"
  ]
}
```

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the connect flow: connecting the current window, a new window or an empty window to a host, the login terminal, port forwarding, and session troubleshooting |
| Components | the shared connection helper and the askpass program, two programs of their own in `src/programs/` that run outside the editor and ship as `dist/connection-helper.js` and `dist/askpass.js` |
| Allowed imports | `lib-helper` and `lib-ssh` in `src/programs/`; `lib-authority`, `lib-helper`, `lib-host`, `lib-log`, `lib-product`, `lib-server` and `lib-ssh` in `src/pipeline/`; the entry point imports nothing; no program imports `vscode` |
| Coverage exclusions | `src/extension.ts`: it loads the editor, which exists only in the extension host. `src/programs/connection-helper.ts` and `src/programs/askpass.ts`: each runs as a program of its own over real sockets, files and processes, which the acceptance run covers. `src/pipeline/steps.ts`: types only, no executable code |
