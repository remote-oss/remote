# Task card containers-52: the coverage sweep of F-0412's image and Dockerfile rows and F-0409's remaining reuse rows (48 todo)

Issue: #1119. Milestone 0.4, containers release 1. Size: L (two or three PRs). Builder: `task:claude`.

**What this card is:** a coverage sweep. Every `todo` line of the features below in
`docs/architecture/catalogue/coverage-containers-r1.tsv` ends with a final tag, and every criterion this release
builds gets the row that proves it. **The method is containers-41's (#1050) §1, §3 and §6**: the tag rules, how rows
are written and measured before they're asserted, and the open rows. Read #1050 first. Athena's rulings on #1109
apply where they name these features. Product code changes only where a row shows the product misses the spec and
the fix is inside one component's existing contract; anything else is an open row.

A row's name starts with its cites, then a lower-case `[a-z0-9-]` label in parentheses, then a colon. A criterion
another open card owns is left to it; check the open cards' issues before each PR. The log clauses stay `todo` until
containers-37 (#992) merges.

Features: **F-0412** (remote-oss/remote-containers#29) and **F-0409** (#23). Owners to skip:
- containers-46 (#1060, selene) has F-0409 AC-4, 7, 26, 34's dialog half, 35, 44 and 45;
- containers-47 (#1064, themis) has F-0409 AC-22 and the rest of AC-34;
- containers-48 (gate row 7) has F-0412 AC-11's row.

Notes:
- **Build failures** use a `RUN false` Dockerfile from the run's image, as gate row 7 does. No row pulls from a
  registry.
- **F-0412's S343 rows** (the obsolete Debian 8 text, AC-12, AC-24, AC-25) print the matching lines from a
  `RUN sh -c 'echo …; exit 1'` step.
- **F-0409 AC-24** (two containers with the same labels) needs two real containers of the folder. Make the second
  with the dev container CLI's `up` against a copy of the folder's configuration, relabelled, not with `docker
  create`: a container made by hand lacks the mounts, and the connect then fails for another reason (measured
  2026-10-19).

## Gates and review

All gates, the changed files at 100 %, `check-coverage` green, and the `containers` launch locally. Each PR moves only
its own lines of the coverage file. PR titles: `tests: <subject> (card containers-52, #1119)`. Request athena only;
hermes assigns the peer.
