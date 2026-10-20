# Task card containers-50: the coverage sweep of F-0301's configuration discovery and picker (29 todo)

Issue: #1116. Milestone 0.4, containers release 1. Size: L (two or three PRs). Builder: `task:claude`.

**What this card is:** a coverage sweep. Every `todo` line of the features below in
`docs/architecture/catalogue/coverage-containers-r1.tsv` ends with a final tag, and every criterion this release
builds gets the row that proves it. **The method is containers-41's (#1050) §1, §3 and §6**: the tag rules, how rows
are written and measured before they're asserted, and the open rows. Read #1050 first. Athena's rulings on #1109
apply where they name these features. Product code changes only where a row shows the product misses the spec and
the fix is inside one component's existing contract; anything else is an open row.

A row's name starts with its cites, then a lower-case `[a-z0-9-]` label in parentheses, then a colon. A criterion
another open card owns is left to it; check the open cards' issues before each PR. The log clauses stay `todo` until
containers-37 (#992) merges.

Features: **F-0301** (remote-oss/remote-containers#20). Owners to skip: containers-40 (#1044) for F-0401's
availability, which F-0301 AC-73 cites.

- **Unit first:** most of 5.0's discovery and labelling is pure (`config/discovery.ts`, `choose-configuration.ts`,
  card containers-13), and many criteria are its unit rows with an added cite.
- **The picker in a window** needs a quick-pick helper that chooses an item by label. Containers-47 (#1064) adds
  one to `windows/renderer.ts`; use it if it's on main, else add it there once.
- **Workspace-file windows** use `openWorkspaceWindow` (harness PR #1079).
- **The wizard (F-0801)** is increment 2: criteria that need it are `deferred` with
  `containers release 1: increment 2 (authoring)`, as the file already words it.

## Gates and review

All gates, the changed files at 100 %, `check-coverage` green, and the `containers` launch locally. Each PR moves only
its own lines of the coverage file. PR titles: `tests: <subject> (card containers-50, #1116)`. Request athena only;
hermes assigns the peer.
