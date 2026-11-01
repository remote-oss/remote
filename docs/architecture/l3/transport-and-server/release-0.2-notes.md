# Release 0.2 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **The Extensions view's "Install Local Extensions in …" action names the host by its label, "SSH: <host>"**; the
  reference shows the raw authority "ssh-remote+<host>".
  - F-2508 AC-30 records the action's text with the raw authority as observed. Ours registers the host label at the
    first resolve's start, so that a failed first connect's indicator reads "Disconnected from SSH: <host>" (F-2410 AC-12
    and AC-31), and core builds the action's title from it (athena's ruling on #1656; spec question on
    remote-oss/remote-ssh#66). Rows: `ruling-1656-host-label`.

- **Remote - SSH installs in VS Code and VSCodium from version 1.125.0 on**, eight minor versions earlier than 1.133.0.
  - F-2001 AC-19 asks for an `engines.vscode` range whose minimum is 1.133.0 or higher. Ours is `^1.125.0`, the
    family's floor (ADR-0007 as amended, the user's decision D-102 on #1368). The proposed APIs it uses read the same
    at 1.125.0 (athena on #1373). Spec question on remote-oss/remote-ssh#11.

- **In VS Code without the proposed APIs Remote - SSH needs, "Connect to Host..." opens no window.** The window you ran
  it from shows the notification that says how to enable them. A window opened directly on an SSH host shows the same
  notification in its notification centre, and VS Code's own offer to install an extension appears beside it.
  - F-2001 AC-30 describes the notification in the window that opens on the host, from both paths, and not VS Code's
    offer. The window opened from "Connect to Host..." can't connect without the proposals, and it took the focus
    from the notification. VS Code shows its own offer whenever no extension resolves the host, which no extension can
    change (athena on #737; spec question on remote-oss/remote-ssh#11).

- **"Open Setting" in the dialog that says the editor names no server source opens your user settings file at the
  setting**, not the Settings editor. Nothing is written to the file.
  - F-3902 AC-9 describes the Settings editor on the User tab, searching for the setting. The Settings editor can't
    open in a window whose remote authority did not resolve, which is the window this dialog belongs to (measured on
    VS Code 1.139.1 and VSCodium); the settings file opens there (athena on #737; spec question on
    remote-oss/remote-ssh#79).

- **A server download that the client makes and that gets an HTTP 404 always says "Server returned 404"**, whether
  or not the answer carries an `Access-Control-Allow-Origin` header.
  - F-2405 AC-29 describes the reference reading "Failed to fetch" for a 404 without that header, as a browser's fetch
    does. Ours runs in the extension host, where no such header matters (athena on #253; spec question on
    remote-oss/remote-ssh#50).
- **A server archive that the client downloads isn't kept on the client**, after a success or a failure.
  - F-2405 AC-17 describes the reference leaving a `vscode_server_<time>` folder with the archive in the client's
    temporary folder after a successful download. Ours copies the archive to the host and removes it, under Remote -
    SSH's no-cache policy (athena on #253; spec question on remote-oss/remote-ssh#50).
- **A password you dismiss in the window that New Window on Active Host opens fails that window with "Permission denied
  (password,keyboard-interactive)"**, not with "Connecting was canceled".
  - F-2303 AC-15 describes the cancel message. F-2306 7.E2 and AC-20 govern every first connection, the new window's
    included, so the dismissed question reaches ssh as an empty answer and the connect reports the authentication
    failure; the window that ran the command is unchanged (athena on #253; spec question on
    remote-oss/remote-ssh#36).
- **A pre-connection script that a signal ends fails the connect with "ended by a signal"**, in the dialog and the log.
  - F-2108 7.E2 leaves the detail to us when there is no exit status (remote-oss/remote-ssh#26; card connect-87).
- **A pre-connection script that is still running when the connect gives up waiting is left to finish.** The five-minute
  bound ends the wait and the connect fails; the script is not killed, and an "Allow" given after that runs nothing.
  - F-2108 6.8 step 4 does not end a running script, and ending it would need a decision of its own (card connect-87).
- **`remote.SSH.serverInstallPath` accepts `~` and a path that starts with `~/`**, meaning the remote user's home.
  - F-2407 AC-7 describes the reference refusing such a value with "Provided: …". Ours installs under the home
    folder, and every other value that doesn't start with `/` is still refused (athena on #1277, D-99; spec question
    on remote-oss/remote-ssh#52).
- **A startup file that reads a line from the terminal fails the connect within a few seconds with "Could not establish
  connection to <host>."**, not after the connect timeout with "Connecting with SSH timed out".
  - F-2704 AC-11 describes the timeout dialog for a `.bash_profile` that runs `read`. Ours starts the login shell with no
    terminal and no input, so the `read` ends at once and the session ends before the host reports its platform; the
    dialog is AC-13's, and the log's cause line is "the SSH session ended before the host reported its platform" (athena
    on #1221; spec question on remote-oss/remote-ssh#77). A startup file that sleeps past the connect timeout still gets
    the timeout dialog.
- **Remote - SSH's socket mode keeps one server socket per host and reuses it across reloads and windows**; the
  reference creates a new `/tmp/code-<uuid>` socket per connect.
  - F-2410 AC-8, AC-11, AC-26 and AC-27 describe the per-connect socket, which belongs to the reference's per-connect
    CLI layer (BR-6, BR-9). Ours runs one socket-mode server per host and commit, reused by later connects (T6 ruling
    on #299, 2026-10-12; `ruling-299-socket-reuse`, athena on #1601; spec question on remote-oss/remote-ssh#55).
    Rows: (ruling-299-socket-reuse)
- **With the server on a socket, a host key that is not yet known is asked as a question of Remote - SSH, not in the
  install terminal.** The progress notification shows first, and then the question with the key's fingerprint.
  - F-2410 AC-24 describes nothing but the progress notification showing while ssh waits, with the question in the
    install terminal behind "details". Ours asks it the way terminal mode does with `remote.SSH.showLoginTerminal` off
    (F-2305 AC-43), one rule across the modes; with the setting on the question stays in the terminal (ruled 2026-10-20
    on remote-oss/remote-ssh#41; `ruling-1601-host-key-pick`, athena on #1601; spec question on remote-oss/remote-ssh#55).
    Rows: (ruling-1601-host-key-pick)
