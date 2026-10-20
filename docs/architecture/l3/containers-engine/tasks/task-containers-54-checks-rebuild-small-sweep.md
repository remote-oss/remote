# Task card containers-54: the coverage sweep of F-0201's engine checks, F-0405's rebuild rows, and the eleven smaller features (about 70 todo)

Issue: #1117. Milestone 0.4, containers release 1. Size: L (two or three PRs). Builder: `task:claude`.

**What this card is:** a coverage sweep. Every `todo` line of the features below in
`docs/architecture/catalogue/coverage-containers-r1.tsv` ends with a final tag, and every criterion this release
builds gets the row that proves it. **The method is containers-41's (#1050) §1, §3 and §6**: the tag rules, how rows
are written and measured before they're asserted, and the open rows. Read #1050 first. Athena's rulings on #1109
apply where they name these features. Product code changes only where a row shows the product misses the spec and
the fix is inside one component's existing contract; anything else is an open row.

A row's name starts with its cites, then a lower-case `[a-z0-9-]` label in parentheses, then a colon. A criterion
another open card owns is left to it; check the open cards' issues before each PR. The log clauses stay `todo` until
containers-37 (#992) merges.

Features: **F-0201** (#18), **F-0405** (#24), and the features with fewer than ten `todo` lines:
F-0501, F-0505, F-0504, F-0401, F-0106, F-0403, F-1402, F-0101 and F-0410.
- Skip what other cards own: containers-40 (#1044) for F-0401, containers-45 (#1059) for nothing here, containers-47
  (#1064) for F-0410 AC-6, 11b and 12b.
- **Workspace-file and multi-root criteria** (F-0201 AC-53, F-0401 AC-9 and AC-10) use `openWorkspaceWindow` (PR
  #1079).
- **F-0401 AC-20** (Reopen twice at once) uses `startInWindow` (PR #1102).

## Gates and review

All gates, the changed files at 100 %, `check-coverage` green, and the `containers` launch locally. Each PR moves only
its own lines of the coverage file. PR titles: `tests: <subject> (card containers-54, #1117)`. Request athena only;
hermes assigns the peer.
