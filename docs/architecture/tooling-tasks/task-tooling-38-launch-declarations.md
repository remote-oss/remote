# Task card tooling-38: the acceptance launches are declared in their suite folders

Issue: #798. Release 0.2: it cuts the merge conflicts that send approved PRs back to review (R-110 keeps approvals only
over a clean merge). From athena's brief (hermes's proposal 2), family 4. Size: M–L (about 2.5 agent-days). Builder:
unassigned (task:claude). Track A of the hot-file cards: tooling-42 (#802) lands after this one.

## 0. The data behind the order of tooling-38 to 44

**Method.** For each of the 352 merges into main since 2026-10-11, take both parents, their merge base, and the files
each side changed since the base. A file changed on both sides is one "overlap" for that merge: the merge needed git to
combine two edits of it, and an edit near the other side's is a conflict. `git merge-tree` on the merged parents finds
only 10 files that conflicted at merge time, because a builder merges main into the branch and resolves before the PR
merges. The overlap count is therefore the better measure of the work. hermes's conflict reports of the last 20 hours
agree with it.

| Overlaps | Files | Card |
|---|---|---|
| 12, 10, 4, 2, 1 | `tools/acceptance.test.ts`, `tools/acceptance.ts`, `tools/acceptance-launches.test.ts`, `tools/acceptance-launches.ts`, `suite-*/cases.json` (hermes: #605, #606, #750; the launch count 8→9→10 across #687 and #688) | tooling-38 |
| 10 | `docs/architecture/catalogue/coverage-slice1.tsv` (hermes: #606, #706, #722) | tooling-39 |
| 10, 7, 6 | `remote-ssh/test/unit/wiring.test.ts`, `remote-ssh/src/extension.ts` (hermes: #604, #609, #612; `adapters` hoisted in #608), `remote-ssh/src/pipeline/wiring.ts` | tooling-40 |
| 4 × 15 | `remote-ssh/l10n/bundle.l10n*.json` (hermes: #594, #647, #651) | tooling-41 |
| 12, 6 | `tests/acceptance/README.md`, `knip.jsonc` | tooling-42 |
| 5, 4, 4 | `remote-ssh/test/unit/strings.test.ts`, `failure-strings.test.ts`, `skeleton.test.ts` (hermes: #647, #750) | tooling-43 |
| 5, 3 | `tests/acceptance/windows/harness.ts`, `remote-ssh/src/surfaces/scripted-adapters.ts` (hermes: #612, #694) | tooling-44 |

**The shape they share:** every PR appends one entry at the same spot of a shared list, or bumps a count or an exact
list. The fix in every card is to split the list into one file per entry, or to derive the list. No card uses
`merge=union` or a custom merge driver: union can silently produce two rows for one key, and neither GitHub's merge
nor `git merge-tree`, which R-110 relies on, runs a custom driver. Every generated or derived result is checked by a
gate. ADR-0003 holds: the old file goes in the same PR as its replacement.

**Not carded (observations for athena):**
- `lib-ssh/src/index.ts` (6): a barrel where each PR appends an export. Folder barrels (`export * from
  './config/index.ts'`) would spread the appends, but knip's export checks then see less. Not worth it yet.
- `remote-ssh/src/pipeline/wiring.ts` (6): `stepsOf` composes the connect's steps in order. A split would scatter an
  order that reads best in one place.
- `remote-ssh/src/surfaces/failure-strings.ts` (4): the id union and the template table grow by one entry per text.
  tooling-43 removes the test that repeats the list; the table itself stays one file.

## 1. What changes

**Today:** `launchesOf(root)` in `tools/acceptance-launches.ts` holds every fixed launch in one array literal, and
expands the case suites (`failureCases`, `clientCases`, `HOST_CASE_SUITES`) in place. Every harness card adds a row
there, edits the exact label lists `LAUNCH_ORDER` (`tools/acceptance.test.ts`) and the label rows of
`tools/acceptance-launches.test.ts`, and often a case to a `cases.json` array.

**After:**
1. Each suite folder under `tests/acceptance` that has launches holds a `launch.json`:
   ```json
   {"launches": [{"order": 120, "label": "explorer", "kind": "plain", "base": "explorer"}]}
   ```
   - Each entry has the fields of today's `Launch` (README "Launches" table), without `suite`, which is the folder.
     It also has `order`, an integer, and optionally `base`.
   - `base` names a shared preset, kept as a constant in `tools/acceptance-launches.ts`: `explorer`
     (`EXPLORER_LAUNCH`) or `trust` (`TRUST_LAUNCH`). The entry's own fields are merged over it, with `settings`
     merged key by key.
   - A case suite's entry is `{"order": 40, "cases": "failure"}`, `"client"`, `"ports"` or `"install"`. It expands to
     that suite's cases in their own order, as today.
2. **Cases one file per case.** Each case suite's cases move from `cases.json` to `cases/<NNN>-<label>.json`, one case
   per file, read in file-name order. `NNN` is three digits, with gaps of 10 at migration (`010-…`, `020-…`). A
   case that keeps the previous one's server or files (`keepServer`, `keepFiles`) keeps its neighbour by its number.
3. `launchesOf(root)` reads every `tests/acceptance/*/launch.json`, expands the case entries, and sorts by `order`.
   The function no longer lists any launch.

**Order numbers at migration:** in today's order, in steps of 10 from 10. The launches on main when the build starts
are in the table's order: `local`, `remote`, `reconnect`, the failure cases, `terminal`, `socket`, `slow`, the client
cases, `terminal-pick`, `windows`, `no-proposals`, the three explorer launches, `trust`, `trust-terminal`, then the
ports cases and the install cases. Launches added by PRs merged before the build, such as connect-39's forwarding
launches, keep their places.

## 2. Gates

`launchesOf` throws, naming the file, on any of:
- two entries with the same `order` or the same `label`;
- a `label` outside `LABEL_FORM`;
- an unknown `base` or `cases` value;
- a `launch.json` whose folder has no test file;
- a case file whose name isn't `NNN-<label>.json` with the case's own label;
- a `keepServer` or `keepFiles` case that is first in its suite.

These checks already run in every tools row that calls it, and in every run. A new tools row,
`tooling-38: the repository's launch declarations are valid`, runs `launchesOf(REPOSITORY_ROOT)` in `pnpm
test:unit`, so CI fails on a bad declaration before any run.

## 3. Tests

- **`tools/acceptance.test.ts`:**
  - `LAUNCH_ORDER` goes. The fixture workspace writes its own small `launch.json` files: one runner launch, one plain
    launch, one failure-cases entry and one ports-cases entry.
  - The rows that compare `harness.launched` assert `launchesOf(workspace.root).map(launch => launch.label)`, plus
    one row on the fixture that the case suites come in their `order`.
  - A launch added to the repository no longer touches this file.
- **`tools/acceptance-launches.test.ts`:**
  - Rows that list the repository's labels or count them become property rows over the repository:
    - labels are unique;
    - the list is sorted by `order`;
    - every plain launch's folder has a `tsconfig.json`;
    - only the explorer and trust launches have `debuggingPort`;
    - the `withExtensions` launches name known extensions.
  - Rows about a specific launch's configuration (`explorer-alone`'s `disabledExtensions`, `trust`'s settings) stay,
    looked up by label, not by position.
- **New tools rows, over fixtures:** a duplicate `order`; a duplicate label; an unknown `base`; `base` merging
  (settings key by key); a case suite read in file-name order; a `keepServer` first case; a folder without tests. The
  changed tools files are at 100 %.
- **Suites:** the case suites' test files (`suite-*/…test.ts`) import `cases/*.json` through a small reader in
  `tests/acceptance/suite/cases.ts`, not `cases.json` (a JSON import can't read a folder). `check-coverage` reads cites
  from `cases/*.json`, so its `casesCites` reads the folder.

## 4. The migration, in one PR

1. Write the `launch.json` files and the `cases/` folders from main's table and arrays.
2. Delete `cases.json` and the launch rows of `launchesOf`.
3. Prove the order unchanged: before the change, print `launchesOf(REPOSITORY_ROOT).map(l => l.label)` on main; after
   it, print the same. The two lists are equal. Paste both in the PR.
4. Run the full VSCodium run once, green, and paste its summary.
5. Update the README's "Launches" and "To add a launch" paragraphs: a launch is a `launch.json` entry in its suite
   folder, and the order is its `order`. tooling-42 then splits the README.

## 5. Land when

`tools/acceptance*` and the suites are in nearly every harness branch. Land it right after a quiet window, and tell
hermes the moment it merges, so in-flight builders merge main at once. A branch that added a row to `launchesOf` or a
case to `cases.json` resolves by writing its launch or case as a declaration file, taking main's version of the old
files.

## 6. Gates and review

All gates, the full VSCodium run green, and the changed tools files at 100 %. PR title `tools, tests: the acceptance
launches are declared in their suite folders (card tooling-38, #798)`. Request athena only.

## 7. Open rows (stop and report on #798)

1. A launch whose position depends on another in a way `order` can't express, for example a launch that must
   immediately follow a case of a case suite. Name it.
