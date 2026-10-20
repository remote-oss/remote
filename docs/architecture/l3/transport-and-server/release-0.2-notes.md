# Release 0.2 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **On a host whose login shell is fish, "Kill VS Code Server on Host" and "Uninstall VS Code Server from Host"
  work** as on any other host: the server is stopped, or removed.
  - F-2411 AC-24 and F-2412 AC-24 describe the reference ending silently there, with nothing done. Our scripts run
    under an explicit POSIX `sh`, whatever the login shell (F-2703, decided 2026-10-06), so the step runs (proteus and
    athena on #1080; spec question on remote-oss/remote-ssh#56 and #57).
