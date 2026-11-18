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
- **A `Host` line with no pattern in the SSH configuration doesn't hide the hosts after it.** The Remotes view lists
  every host of the file, as Remote - SSH's host picker does, and the empty line itself gives no row.
  - F-5102 7.E4 describes the reference dropping every host after such a line. Ours shows the companion's list
    (F-5102 BR-7), which follows F-2202 7.E4: "an empty `Host` line does not disturb later lines" (athena on #253).
    The republished AC-26 (2026-11-16) asserts only the hosts before the line and every host after the option line that
    follows it, and nothing about a host written directly after the pattern-less line, so a reimplementation that
    lists it passes: the spec now leaves that open, and athena's answer on remote-oss/remote-explorer#9 decides whether
    this entry stays. The row is `F-5102 AC-26 (odd-lines)` in `tests/acceptance/explorer-rows/host-list.test.ts`, and
    `F-2202.7.E4` in `packages/lib-ssh/test/unit/hosts.test.ts` asserts it the same way.
