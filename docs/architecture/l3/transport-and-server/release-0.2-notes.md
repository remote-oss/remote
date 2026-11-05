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

- **A window whose first connect fails names the host in the remote indicator ("Disconnected from SSH: <host>") and in the window title ("<folder> [SSH: <host>]")**; the
  reference shows "Disconnected from SSH" and "<folder> [SSH]" until a connect has succeeded.
  - F-2307 AC-7 and F-2206 7.E1 describe the indicator without the host for an authority that never connected, while
    F-2410 AC-12 and AC-31 describe it with the host for the same state; F-2704 AC-25 gives the title without the host,
    and AC-23 the reloading window's title as the folder alone. Ours registers the host label at the first resolve's
    start, everywhere (athena's ruling on #1681 and #1608; spec question on remote-oss/remote-ssh#40). Rows:
    `ruling-1681-first-label`.

- **Remote - SSH's local server download copies the archive without the reference's `.done` marker files**; the install starts only after the copy has completed in the same session.
  - F-2405 AC-8, AC-16, BR-9 and BR-10 describe a marker file that the reference's copy leaves beside the archive, which
    its install watches for because the copy and the install are separate steps. Ours copies over the held connection
    and starts the install only after the copy has reported success, so it needs no completion signal and an archive
    that is missing after its copy cannot be installed from. BR-9's client side and POST-2, the `vscode_server_<epoch-ms>`
    folder of the archive and its marker that the reference never removes, are covered by the same ruling: ours keeps
    no such folder (athena's ruling on #1607; spec question on
    remote-oss/remote-ssh#50). Rows: `ruling-1607-no-marker`.

- **A question that Remote - SSH does not recognise, left unanswered in a hidden login terminal, ends in the connection failure dialog after the connect wait**; the reference keeps waiting until it is answered.
  - F-2308 AC-12, 7.E3 and BR-5 have the reference keep waiting, so that the dialog appears only when the user answers
    after the server dropped the login. Ours bounds a question nobody can reach by the connect wait (the connect
    timeout and a margin of 2 seconds, F-2105 BR-3 and BR-4), so the dialog is already there when the server drops the
    login. Brief ruling 3 for the terminal mode (daedalus on #299, corrected by athena on #385) and R-79; spec
    question on remote-oss/remote-ssh#41. Rows: `ruling-299-question-bound`.

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
- **A host key that is not yet known is asked as a question of Remote - SSH, in every flow, not in a terminal and not as a raw input.**
  The progress notification shows first where there is one, and then the question as a pick with the key's fingerprint
  in its title, the placeholder "Are you sure you want to continue?", and Continue and Cancel.
  - F-2410 AC-24 describes nothing but the progress notification showing while ssh waits, with the question in the
    install terminal behind "details". Ours asks it the way terminal mode does with `remote.SSH.showLoginTerminal` off
    (F-2305 AC-43), one rule across the modes; with the setting on the question stays in the terminal (ruled 2026-10-20
    on remote-oss/remote-ssh#41; `ruling-1601-host-key-pick`, athena on #1601; spec question on remote-oss/remote-ssh#55).
  - F-2412 AC-10 describes the question of the maintenance commands as a quick input with core's message "Press 'Enter'
    to confirm your input or 'Escape' to cancel", answered "yes". That raw input is the reference's fallback for a
    wording it does not recognize; a recognized host-key question is F-2305's pick in every flow. Continue goes on and
    records the key; Escape ends the command with the error of F-2412 AC-12 and records nothing (athena on #1687).
    Rows: (ruling-1601-host-key-pick)
- **A window that joins a running local connection server writes no setting line.**
  - F-2604 AC-1 and AC-15 put the line "ERROR: TCP port forwarding appears to be disabled…" (STR:S046) in the log of the
    connect that started the shared `ssh`. A window that joined a login already running, a reload of the window
    included, logs the refused-channel lines the helper relays but not that line (BR-2, 6.5; `ruling-1773-joiner-lines`,
    athena on #1773). Each connect still keeps its own hint.
    Rows: (ruling-1773-joiner-lines)

- **With pty allocation permitted and no RequestTTY, ssh writes no pseudo-terminal warning in local-server mode.**
  - F-2106 AC-14 expects ssh's "Pseudo-terminal will not be allocated…" warning in the log when the setting is on and the
    host entry has no `RequestTTY`. Our connection command always carries a remote command (the prelude), so with
    `RequestTTY` unset ssh asks for no terminal and writes no warning. `-T` is still present exactly when the setting is
    falsy and no terminal is allocated (athena's ruling on #1606; `ruling-1606-no-tty-warning`).
    Rows: (ruling-1606-no-tty-warning)

- **In terminal mode with pty allocation permitted and `RequestTTY yes`, the session gets a pseudo-terminal and ssh writes no warning.**
  - F-2106 AC-14 expects ssh's warning in the log in terminal mode too, as the reference gives ssh a non-terminal standard
    input there. Ours runs ssh in its own login terminal (F-2102), so its standard input is a terminal; with `-T` absent,
    `RequestTTY yes` requests a pty, the session gets one and ssh has nothing to warn about
    (`ruling-1779-terminal-pty`, athena on #1779). We do not override the user's `RequestTTY`.
    Rows: (ruling-1779-terminal-pty)

- **The Remote - SSH log replaces any run of 32 or more letters, digits, underscores or hyphens with `[redacted]`, except commit and digest ids and key fingerprints, to keep tokens out of the log.**
  - Hyphens inside a run count towards the 32; hyphens at its ends stay as written. A value the log shows "as written"
    (for example a configFile path, F-2201 AC-46) shows such a segment redacted. The guard is not loosened for one
    criterion, and it applies to every value any criterion quotes into the log (R-26; `ruling-1794-log-redaction`,
    athena on #1794).
    Rows: (ruling-1794-log-redaction)

- **A host that refuses TCP forwarding fails the connection with a dialog instead of waiting forever.** The reference
  shows a notification and then waits at "Waiting for port forwarding to be ready" until the window is closed; we
  fail the connection as soon as the refusal is recognised, with "TCP port forwarding appears to be disabled on the
  remote host…" as the reason and the troubleshooting table's AllowTcpForwardingDisabled row and its mitigations.
  When the refusal comes from the local ssh after a changed host key was accepted, the reason is "Port forwarding is
  disabled" in every mode. Every wait in the family is bounded (R-79).
  - Rows: `ruling-1985-forwarding-fails`.
  - F-2604 BR-5, AC-6 and AC-19, F-2304 AC-20 and F-2605 AC-12, describe the reference's wait; ruled on remote#1985
    (F-2604 Q3). F-2605 AC-12's two situations came from that wait; the refusal is recognised before the step ends now, so
    the terminal opens (F-2605 AC-5).

## Known issues

- **In a new Remote - SSH window, Terminal: Select Default Profile, Debug: Select and Start Debugging and Tasks: Run Task show empty lists, or nothing, until a terminal has been opened in the window.**
  Open a terminal first.
  - F-2508 AC-14, AC-28 and AC-29 read their Givens as a window whose terminals have been used (`reading-1768-terminal-first`).
    The empty lists before the first terminal are VS Code's own behaviour: the requests are answered and nothing of
    ours shapes them (measured on 1.139.1, connect-125, #1768). Whether to report it upstream is the user's call.

- **When a reconnection fails, for example after a cancelled passphrase, VS Code may show no "Cannot reconnect" dialog.**
  The indicator reads "Disconnected from SSH: <host>". Reload the window to connect again.
  - F-2307 AC-13 and AC-26 describe core's "Cannot reconnect. Please reload the window." dialog after a cancelled
    passphrase input on a reconnection. Ours hands core an unhandled "not available" error, which core's loop gives up
    on without showing the dialog (measured in the editor's own log, also for an ordinary authentication failure on a
    reconnection); the dialog is core's rendering (athena's ruling on #1725).
