# Task card tooling-39: unit and acceptance tags are derived from the rows that cite a criterion

Issue: #799. Release 0.2 (gate throughput). From athena's brief, family 2. Size: M (about 2 agent-days). Builder:
unassigned (task:claude). Track B: no other hot-file card touches these files. The data is in tooling-38 §0:
`coverage-slice1.tsv` changed on both sides of 10 merges (hermes: #606, #706, #722).

## 1. What changes

**Today:** `docs/architecture/catalogue/coverage-slice1.tsv` has one line per criterion, `ac`, `tag`, `reason`, with
the tags `acceptance`, `unit`, `recorded`, `core`, `deferred` and `todo`. Every coverage PR that adds a row also edits
the criterion's line from `todo` to `unit` or `acceptance`. Neighbouring criteria are tagged by different PRs, so their
edits touch adjacent lines and conflict. `tools/check-coverage.ts` already reads every test row's citation, and
checks that a `unit` or `acceptance` tag has a citing row.

**After:** the file says only what a person decides; the rows say the rest.
1. **The tags in the file** are `open`, `held`, `recorded`, `core` and `deferred`. `unit`, `acceptance` and `todo` are
   no longer written in it.
   - `open`: no decision; the tag is derived (2).
   - `held`, with a reason: cited by a row, but not yet proven, for example a row that proves only one half of the
     criterion, or a tag waiting on a ruling. A `held` criterion counts as `todo`.
   - `recorded`, `core` and `deferred` mean what they mean today, and the last two still need a reason.
2. **The derived tag** of an `open` criterion:
   - `acceptance` when an acceptance row cites it;
   - otherwise `unit` when a unit row cites it;
   - otherwise `todo`.

   An acceptance row is a test file under `tests/acceptance` or a case file's cite, exactly as `rowsOf` decides
   today.
3. **Every criterion keeps its line**, so the file is still the list of the slice's criteria, and `check-coverage`
   still reports a row that cites a criterion the file lacks. A coverage PR no longer edits the file at all; only a
   `held`, `core`, `deferred` or `recorded` decision does, and those are rare.
4. **The counts `check-coverage` prints** are of the effective tags: `acceptance`, `unit`, `recorded`, `core`,
   `deferred` and `todo`, where `todo` includes `held`. They're printed as today.
5. `pnpm coverage-table` (new script, `node tools/check-coverage.ts --table`) prints every criterion with its
   effective tag and, for derived tags, the first citing row. It's for people and is never committed.

**If #777 has merged** (several coverage files, `coverage-containers-r1.tsv`): every rule here applies to each file
alike.

## 2. Gates

`check-coverage` fails on:
- a `held`, `core` or `deferred` line without a reason, or an `open` line with one;
- a `recorded` line that a row also cites: a recorded criterion has no row of ours, so a citing row means the tag
  is stale;
- a `held` line that no row cites: then it's simply `open`, and the reason is stale;
- every check it has today about form, order, repeats and unknown criteria.

The rule "a `unit` or `acceptance` tag needs a citing row" goes: it's true by construction.

## 3. The migration, in one PR

1. **Rewrite every line:**
   - `unit`, `acceptance` and `todo` → `open`;
   - `recorded`, `core` and `deferred` unchanged;
   - **except** a `todo` line that a row cites today. A criterion can be cited and still `todo` on purpose, for
     example F-2101 AC-17 before its republication, or rows that prove one half. Those become `held` with the reason
     `held at migration (tooling-39): cited before it was tagged`. List them all in the PR body for athena, who
     clears each to `open` or rewrites its reason in a follow-up.
2. **Show what moved.** Run `pnpm coverage-table` after the change and compare it with the file on main, `held`
   counted as `todo`. Paste the before and after counts in the PR.
   - The only difference allowed is a criterion tagged `unit` on main that an acceptance row also cites. Its effective
     tag becomes `acceptance`, which is what the rows say. List each one in the PR.
   - Any other difference is a stop (§8).
3. `tools/seed-coverage.ts` writes `open` instead of `todo`.

## 4. Rows (`tools/check-coverage.test.ts`, the changed files at 100 %)

| Given | Expected |
|---|---|
| an `open` criterion cited by an acceptance row and by a unit row | effective `acceptance`, counted once |
| an `open` criterion cited only by a unit row | effective `unit` |
| an `open` criterion no row cites | effective `todo` |
| a `held` criterion with a reason, cited by a unit row | counted as `todo`; no problem |
| a `held` criterion no row cites | a problem naming it ("held, but no row cites it: make it open") |
| a `recorded` criterion a row cites | a problem naming it |
| `core` without a reason; `open` with one | a problem each |
| the old tag `unit` in the file | "unknown tag: unit" |
| `--table` | every criterion, its effective tag, and the first citing row for a derived one |

## 5. Who does what after it

- **Coverage cards and their builders:** a card's "Catalogue" section says which criteria its rows prove. The builder
  no longer edits the file for them. A card that leaves a cited criterion unproven writes it `held`, with a reason.
- **athena's tag check:** it reviews the rows' citations and every changed `held`, `core`, `deferred` or `recorded`
  line. `pnpm coverage-table` shows the effect.
- **AGENTS-level docs:** `docs/architecture/catalogue/` gains a short `coverage.md`: the tags, the derivation, and how
  to hold a criterion. The coverage cards cite it.

## 6. Land when

Every coverage branch in flight edits this file. Land it right after a quiet window, and tell hermes the moment it
merges.
- **How an in-flight branch resolves:** take main's version of the file, then mark `held` any criterion its rows cite
  but don't fully prove. Most branches then have no change to the file at all.
- **Card fix-ups:** hermes asks each open coverage card's builder to drop the "Catalogue: set to unit/acceptance"
  edits, which become no-ops.

## 7. Gates and review

All gates; `check-coverage` green with counts equal to before. PR title `tools, docs: unit and acceptance tags are
derived from the rows that cite a criterion (card tooling-39, #799)`. Request athena only. She also gives the design
check of §1 and §5, since it changes how her tag check works.

## 8. Open rows (stop and report on #799)

1. The before-and-after comparison of §3 differs in any way other than `unit` → `acceptance`. For example, a criterion
   tagged `acceptance` on main is derived as `unit`, because its acceptance row's cite isn't read the way
   `check-coverage` reads it today. Name the criterion and the row.
