# Release 0.2 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **A server download that the client makes and that gets an HTTP 404 always says "Server returned 404"**, whether
  or not the answer carries an `Access-Control-Allow-Origin` header.
  - F-2405 AC-29 describes the reference reading "Failed to fetch" for a 404 without that header, as a browser's fetch
    does. Ours runs in the extension host, where no such header matters (athena on #253; spec question on
    remote-oss/remote-ssh#50).
- **A server archive that the client downloads isn't kept on the client**, after a success or a failure.
  - F-2405 AC-17 describes the reference leaving a `vscode_server_<time>` folder with the archive in the client's
    temporary folder after a successful download. Ours copies the archive to the host and removes it, under Remote -
    SSH's no-cache policy (athena on #253; spec question on remote-oss/remote-ssh#50).
