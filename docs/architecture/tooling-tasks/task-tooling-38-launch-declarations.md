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
| 5, 4, 2 | `remote-ssh/test/unit/strings.test.ts`, `failure-strings.test.ts`, `skeleton.test.ts` (hermes: #647, #750) | tooling-43 |
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
2. **Cases one file per case.**
   - Each case suite's cases move from `cases.json` to `cases/<NNN>-<name>.json`, one case per file, read in file-name
     order.
   - `NNN` is three digits, with gaps of 10 at migration (`010-…`, `020-…`).
   - `<name>` is the case's launch name: `label` for client, ports and install cases, and `label ?? alias` for a
     failure case.
   - A case that keeps the previous one's server or files (`keepServer`, `keepFiles`) keeps its neighbour by its number.
   - `failureCases(root)`, `clientCases(root)` and `hostCases(root, suite)` stay exported with their signatures, and
     read the folder. `tools/acceptance.ts` (its loops over `failureCases` and `hostCases`, near line 762) is
     unchanged.
3. **The window gets its case from the launch, not from a file.**
   - **Why:** the suites import `./cases.json` today (`failure-window.test.ts:9`, `client.test.ts:16`,
     `ports.test.ts:6`, `install.test.ts:4`), and `bundleFolder` (`tools/acceptance.ts`) bundles them with esbuild into
     `dist-*/*.test.cjs`, which run in the editor's window. A bundled module can't list a source folder.
   - **What the launch passes:** each case launch's `environment` gains `HARNESS_CASE`, the case object as JSON,
     beside today's `HARNESS_<SUITE>_CASE` name.
   - **What the suites read:** `tests/acceptance/suite/cases.ts` (new) exports
     `caseOfLaunch<Case>(): Case`, which parses `process.env.HARNESS_CASE` and throws, naming the variable, when it's
     missing or isn't JSON. Each of the four suites uses it in place of its `cases.json` import and its `.find(...)`
     by name.
   - The suites read no case file, so nothing needs bundling.
4. `launchesOf(root)` reads every `tests/acceptance/*/launch.json`, expands the case entries, and sorts by `order`.
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
- a case file whose name isn't `NNN-<name>.json`, with `<name>` as defined in §1.2;
- two case files of one suite with the same `NNN`: two branches that both append "last" get no git conflict, so this
  gate is what catches them, on main's next green run;
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
- **Suites:** the four case suites use `caseOfLaunch` (§1.3). A tools row checks that each case launch's environment
  holds `HARNESS_CASE` equal to its case.
- **`check-coverage`** reads cites from `cases/*.json`, so its `casesCites` reads the folder.
- **Fixtures:** every tools test that writes a `cases.json` into a temporary workspace writes `cases/<NNN>-<name>.json`
  files instead. That's in `tools/acceptance.test.ts`, `tools/acceptance-launches.test.ts` and
  `tools/check-coverage.test.ts`: about 20 places, found with `grep -n "cases.json" tools/*.test.ts`.
  - A helper in `tools/temporary-workspace.ts`, `writeCases(workspace, suite, cases)`, writes them in order with gaps
    of 10, so each fixture is one call.
  - The fixtures for the new gates use it too.

## 4. The migration, in one PR

1. Write the `launch.json` files and the `cases/` folders from main's table and arrays.
2. Delete `cases.json` and the launch rows of `launchesOf`.
3. Prove the order unchanged: before the change, print `launchesOf(REPOSITORY_ROOT).map(l => l.label)` on main; after
   it, print the same. The two lists are equal. Paste both in the PR.
4. Run the full VSCodium run once, green, and paste its summary.
5. Run `pnpm format`, which covers the new `launch.json` and `cases/*.json` files (`.prettierignore` skips only `*.md`,
   `docs/` and `dist-*/`).
6. Update the README:
   - the "Launches" and "To add a launch" paragraphs: a launch is a `launch.json` entry in its suite folder, and the
     order is its `order`;
   - every sentence that says "entry of `suite-*/cases.json`" (today lines 84, 98, 233 and 247) names
     `suite-*/cases/`;
   - the paragraph naming `HOST_CASE_SUITES` (line 249) says the host-case suites are the `launch.json` entries with
     `"cases": "ports"` or `"install"`.

   tooling-42 then splits the README.

## 5. Land when

`tools/acceptance*` and the suites are in nearly every harness branch. Land it right after a quiet window, and tell
hermes the moment it merges, so in-flight builders merge main at once. An in-flight branch resolves by taking main's
version of the old files, then:
- **A new launch:** it becomes a `launch.json` entry. Its `order` is the gap between its neighbours, or the
  largest `order` plus 10 when it's last. A duplicate with another branch's choice fails `launchesOf` on main's next
  run, and the second branch to merge renumbers.
- **A new case:** it becomes a `cases/<NNN>-<name>.json` file, with the same numbering rule.
- **Rows added to `LAUNCH_ORDER` or to `acceptance-launches.test.ts`'s label lists:** they're dropped. The lists are
  derived now. A row that tested the new launch's own configuration stays, and finds the launch by label.
- **A field added to `FailureCase`, `ClientCase` or `HostCase`** (as `clientListeners` was): the field stays on the
  type, and its value moves into the case files.
- **A suite that imports `./cases.json`:** it uses `caseOfLaunch` instead.

## 6. Gates and review

All gates, the full VSCodium run green, and the changed tools files at 100 %. PR title `tools, tests: the acceptance
launches are declared in their suite folders (card tooling-38, #798)`. Request athena only.

## 7. Open rows (stop and report on #798)

1. A launch whose position depends on another in a way `order` can't express, for example a launch that must
   immediately follow a case of a case suite. Name it.
