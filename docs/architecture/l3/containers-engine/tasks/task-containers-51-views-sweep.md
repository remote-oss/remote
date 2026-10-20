# Task card containers-51: the coverage sweep of the Dev Containers views' criteria (F-0901, F-0902, F-0903, F-0906; 80 todo)

Issue: #1115. Milestone 0.4, containers release 1. Size: L (two or three PRs). Builder: `task:claude`.

**What this card is:** a coverage sweep. Every `todo` line of the features below in
`docs/architecture/catalogue/coverage-containers-r1.tsv` ends with a final tag, and every criterion this release
builds gets the row that proves it. **The method is containers-41's (#1050) §1, §3 and §6**: the tag rules, how rows
are written and measured before they're asserted, and the open rows. Read #1050 first. Athena's rulings on #1109
apply where they name these features. Product code changes only where a row shows the product misses the spec and
the fix is inside one component's existing contract; anything else is an open row.

A row's name starts with its cites, then a lower-case `[a-z0-9-]` label in parentheses, then a colon. A criterion
another open card owns is left to it; check the open cards' issues before each PR. The log clauses stay `todo` until
containers-37 (#992) merges.

Features: **F-0901** (#76), **F-0902** (#80), **F-0903** (#94), **F-0906** (#72). Cards on main: containers-29 to
33 (the targets model, the view, its events, the coverage lines, the Details view).
- **F-0902 is slice B** (open, start, stop, remove, inspect, log). Check on the issue which of its actions are
  registered on main.
  - An action that's built gets its rows.
  - An action that isn't built is an open row (§6 of #1050). Don't write the product for it: daedalus cards it.
- **F-0904, F-0905 and F-0902's attach and recent-folder actions** stay `deferred` with the file's existing reasons.
- **#1025 (triton)** owns the targets-view and targets-events rows that fail on main today. Leave those to it.

## Gates and review

All gates, the changed files at 100 %, `check-coverage` green, and the `containers` launch locally. Each PR moves only
its own lines of the coverage file. PR titles: `tests: <subject> (card containers-51, #1115)`. Request athena only;
hermes assigns the peer.
