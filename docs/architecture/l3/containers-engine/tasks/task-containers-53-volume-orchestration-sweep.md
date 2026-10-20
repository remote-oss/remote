# Task card containers-53: the coverage sweep of F-0419's server-cache volume rows and F-0408's orchestration and progress rows (43 todo)

Issue: #1118. Milestone 0.4, containers release 1. Size: L (two or three PRs). Builder: `task:claude`.

**What this card is:** a coverage sweep. Every `todo` line of the features below in
`docs/architecture/catalogue/coverage-containers-r1.tsv` ends with a final tag, and every criterion this release
builds gets the row that proves it. **The method is containers-41's (#1050) §1, §3 and §6**: the tag rules, how rows
are written and measured before they're asserted, and the open rows. Read #1050 first. Athena's rulings on #1109
apply where they name these features. Product code changes only where a row shows the product misses the spec and
the fix is inside one component's existing contract; anything else is an open row.

A row's name starts with its cites, then a lower-case `[a-z0-9-]` label in parentheses, then a colon. A criterion
another open card owns is left to it; check the open cards' issues before each PR. The log clauses stay `todo` until
containers-37 (#992) merges.

Features: **F-0419** (#92) and **F-0408** (#27). Cards on main: containers-18, 25 and 27 (the volume),
containers-20, 24, 38 and 39 (the progress and the terminal).
- **F-0419 is architecture-sensitive.** The recorded gate proves 0 of its 69 on x86_64 (brief §5), so a criterion
  that needs another architecture is `deferred` with `containers release 1: later (Windows, WSL and macOS)` or the
  file's architecture reason.
- **F-0408's progress texts** are the exact ones of #1046 (S087, then S209 or S334 after a colon).

## Gates and review

All gates, the changed files at 100 %, `check-coverage` green, and the `containers` launch locally. Each PR moves only
its own lines of the coverage file. PR titles: `tests: <subject> (card containers-53, #1118)`. Request athena only;
hermes assigns the peer.
