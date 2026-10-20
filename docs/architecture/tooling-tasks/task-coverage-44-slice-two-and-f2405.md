# Task card coverage-44: catalogue lines and rows for Remote - SSH slice 2 and F-2405

Issue: #1114. Release 0.2. Size: L (seed and tag first, then rows by feature). Builder: `task:claude`.
Design: athena's 0.2 plan of 2026-10-20 (through hermes). Slice 2's features and F-2405 have no lines in
`docs/architecture/catalogue/coverage-slice1.tsv` at all, so `check-coverage` can't see what's proven.

Features (all `spec:draft` today, from `remote-oss/remote-ssh`):
- F-2104 (#22), the P0;
- F-2308 (#41), F-2312 (#45), F-2507 (#65), F-2106 (#24), F-2604 (#71), F-2410 (#55), F-2508 (#66);
- F-2405 (#50).

## 1. Seed (PR a)

1. Add the nine ids to `SLICE_ONE_FEATURES` in `tools/spec-acceptance-criteria.ts`, in catalogue order.
2. Seed the new features' lines, the way #722 seeded D-86's extension. `tools/seed-coverage.ts` writes a whole file
   with every criterion `todo`, so **never run it over `coverage-slice1.tsv`**: that would wipe its tags. Run it into a
   scratch copy, or call its function for the nine ids, and append only the nine features' lines to the file. Every new
   line is `todo`, and no existing line changes (check with `git diff`: only added lines). Fix `acCount` in `docs/architecture/catalogue.tsv` where the issue's
   count differs, as #468 did.
3. **Draft specs:** if a spec's review later renumbers or removes criteria, re-seed that feature and move its tags.
   Card containers-32 did the same for F-0902. Say so in the PR.

## 2. Tag (PR a, continued)

Tag each new line by containers-41's (#1050) §1 rules: `deferred` with a reason, `core`, `acceptance`, `unit`, else
`todo`. Many of slice 2's criteria are already proven by rows on main, cited by spec section rather than AC. For
those, add the `F-2xxx AC-n` cite to the start of the existing row's name (a lower-case `[a-z0-9-]` label in
parentheses) instead of writing a second row. Grep the test names for each feature id to find them.

**F-2104** is the P0, and its gate cases are recorded from the dirty side's observations (D-65). Its criteria aren't
`recorded` until the recording exists and a green x86_64 replay passes (athena on #1120). Until then they stay `todo`,
listed in the PR. Don't write a row that stands in for a recording.

## 3. Rows (PRs b, c, …, one per feature or two)

**Each feature's rows wait for its spec's review** (athena on #1120): all nine are `spec:draft` today. PR a seeds and
tags now. A feature's rows start when its spec is `spec:reviewed`. Re-seed that feature first if the review renumbered
its criteria.

Once a feature's spec is reviewed, write the rows its in-release criteria still lack, measured against main before they're asserted
(containers-41 §3). Order, by what gates 0.2:
1. F-2405 (the server's download, which 0.2's install path uses);
2. F-2410;
3. F-2308 and F-2312;
4. F-2507 and F-2508;
5. F-2106 and F-2604.

A criterion where the product does something else is an open row: post it on the issue, and carry on with the
others.

## 4. Gates and review

All gates, `check-coverage` green after each PR, and the VSCodium run for the launches the rows are in. PR titles:
`docs: seed and tag slice 2 and F-2405 (card coverage-44, #1114)`, then `tests: <feature>'s rows (card coverage-44,
#1114)`. Request athena only; hermes assigns the peer.
