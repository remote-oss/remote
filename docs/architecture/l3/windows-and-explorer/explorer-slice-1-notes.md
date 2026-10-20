# Explorer slice 1 notes: the list the release notes are built from

Each entry is worded for users, then cites where it comes from. A deviation from the spec lives here and nowhere else:
the catalogue allows a reason only on `core` and `deferred` rows (dike on #931).

## Deviations

- **The README names no other extension.** It says the extension stands down beside another Remote Explorer and should
  be installed directly, without naming that extension's id.
  - F-5901 AC-14 names `ms-vscode.remote-explorer` (athena on #737; D-56, D-59).
- **The extension's repository and issue tracker are the family's repository.** Its manifest names
  `remote-oss/remote`, with the folder `packages/remote-explorer`, and issues go to that repository's tracker, as the
  pack's and every other member's do.
  - F-5901 AC-3 asks for a repository `remote-oss/remote-explorer` and a `bugs` address of that repository (D-56: one
    monorepo for the family, as athena ruled for the pack on #1158). The row is `F-5901 AC-3 (ruling-d56)` in
    `packages/remote-explorer/test/unit/manifest.test.ts`.
