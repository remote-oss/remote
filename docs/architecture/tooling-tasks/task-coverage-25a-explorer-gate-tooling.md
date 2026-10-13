# Task card coverage-25a: the explorer gate's tooling

Issue: #644. Release 0.3 (#43), explorer slice 1, item S8, part a. Why: the eight gate rows of slice 1 (brief
`docs/architecture/l3/windows-and-explorer/brief-remote-explorer.md`, "The slice-1 gate") need three things beyond
tooling-30 (#633):
- a way for the renderer helpers to find the page of a window named by its claim (tooling-28, #609);
- the notification toasts a window shows;
- a coverage file for the explorer's slice-1 criteria.

coverage-25b writes the rows, and coverage-25c tags the criteria. Builder: selene. Size: about 1.5 agent-days.
**Depends on:** tooling-30 (#649) and tooling-28 (#609, window claims) merged.

## 1. Files

| File | Change |
|---|---|
| `tools/acceptance-launches.ts` | `EXPLORER_LAUNCH.settings` becomes `{'window.title': '[${rootName}]${remoteName}'}` (§2.2) |
| `tests/acceptance/windows/renderer.ts` | `pageOf` finds a claimed window's page (§2.2), and the new `notifications(name)` (§2.3) |
| `tools/check-coverage.ts`, `tools/spec-acceptance-criteria.ts`, `tools/seed-coverage.ts` | the coverage sets of §3 |
| `docs/architecture/catalogue/coverage-explorer-slice1.tsv` | new: seeded by `node tools/seed-coverage.ts explorer` (§3.3), every line `todo` |
| the matching `*.test.ts` of each changed tools file | the rows of §4 |

Nothing in `packages/` changes.

## 2. Windows

### 2.1 Window names: the claims of tooling-28

athena's ruling on #648: the explorer launches name their windows as every launch does since tooling-28 (#609).
- A window with a folder is named by its folder.
- A window without one claims the first free name of its launch: `local`, then `empty-1`, `empty-2`, and so on.
- A claim stays for the launch's life, so a reloaded empty window comes back under the next free name.

This card adds no naming rule, and neither the agent nor remote-ssh changes. Check that the three explorer launches
get `REMOTE_OSS_ACCEPTANCE_WINDOWS`, as every VSCodium launch does after #609, with a tools row. If an explorer launch
can't use claims, stop and say why on #644.

### 2.2 Finding a claimed window's page

In the explorer launches the window title is `[${rootName}]${remoteName}`. It reads `[]` for a local window without a
folder, `[]SSH: harness` for one on `harness`, `[smoke]` for a local folder, and `[k1 [SSH: harness]]SSH: harness` for
a remote folder (core's own label). A claimed name doesn't appear in the title, so `pageOf(name)` first reads the
window's `state` from its agent (`windowState(name)` of `windows/harness.ts`):
- **A window with folders:** the page whose title is `[<name>]` or starts with `[<name> [`, as today.
- **A window without folders and with `remoteName` `null`:** the page whose title is exactly `[]`.
- **A window without folders on a remote:** the page whose title starts with `[]` and isn't `[]`.

There must be exactly one such page, as today. Two folder-less windows of the same kind at once can't be told apart,
so the gate rows never have two. `pageOf` fails naming both titles when they do.

### 2.3 Notifications

`notifications(name): Promise<string[]>`: the text of each `.notifications-toasts .notification-list-item-message` of
window `name`'s page, in DOM order. It reads the toasts on screen only; the notification centre is closed.

## 3. A second coverage set

### 3.1 The sets

In `tools/spec-acceptance-criteria.ts`, beside `SLICE_ONE_FEATURES`:

```ts
/** The features of Remote Explorer's slice 1, with the part of Remote - SSH that serves it. */
export const EXPLORER_SLICE_ONE_FEATURES: readonly string[] = [
  'F-2503', 'F-5001', 'F-5002', 'F-5101', 'F-5102', 'F-5103', 'F-5901', 'F-5902',
];
```

In `tools/check-coverage.ts`:

```ts
export interface CoverageSet {
  name: string;               // 'slice1' | 'explorer'
  file: string;               // repository-relative
  features: readonly string[];
  /** The only reasons a `deferred` line may give; any reason when absent. */
  deferredReasons?: readonly string[];
}
export const COVERAGE_SETS: readonly CoverageSet[];
```

| `name` | `file` | `features` | `deferredReasons` |
|---|---|---|---|
| `slice1` | `docs/architecture/catalogue/coverage-slice1.tsv` (`COVERAGE_FILE`, unchanged) | `SLICE_ONE_FEATURES` | absent |
| `explorer` | `docs/architecture/catalogue/coverage-explorer-slice1.tsv` | `EXPLORER_SLICE_ONE_FEATURES` | `explorer slice 1: increment 2`, `explorer slice 1: increment 3`, `D-55: no tunnel rows`, `F-2503 Q4: the Windows and macOS path form` |

### 3.2 The check

`checkCoverage(root)` checks each set in order, with today's rules, each set against its own file and features:
- a row that cites a criterion of a set's feature that its file lacks is a problem naming that file;
- `place(...)` names the set's file;
- the "names a feature without an AC" rule applies to each set's features.

**Missing files:** a missing `slice1` file still gives `{kind: 'unreadable'}`, as today. A missing file of any other set
is skipped, so that the existing workspace rows of `check-coverage.test.ts` keep working. The repository row in §4
proves that both files are read on main.

**Reasons:** a `deferred` line of a set with `deferredReasons` whose reason isn't exactly one of them is a problem:
`<place>: <id> gives the reason "<reason>", which isn't one of the set's`.

**The report:** `{kind: 'checked'; problems: string[]; counts: Array<{file: string; counts: Record<Tag, number>}>}`, one
`counts` entry per set read. `outputOf` prints the sorted problems, then for each entry a line `<file>:` followed by its
six `<tag>: <n>` lines. Existing rows that compare the printed lines gain the header line; change only that.

**Overlap:** a feature in two sets is a problem: `<feature> is in two coverage sets`. A tools row proves there's
none on main.

### 3.3 Seeding

`tools/seed-coverage.ts`:
- `issueNumbersOf(catalogue)` keeps every row with an issue, as `feature → {repository, issue}`, where `repository` is
  `remote-oss/<repo column>`;
- `bodyOf(issue, repository, program)` passes `-R <repository>`;
- `seedFor(catalogue, program, set)` seeds the set's features;
- the command line takes an optional set name (`slice1` by default, so today's command is unchanged), and writes that
  set's file.

Run `node tools/seed-coverage.ts explorer` once, commit the file, and paste its line count in the PR. Never run it for
`slice1`: that would overwrite its tags.

## 4. Rows

| Cite | Given | Expected |
|---|---|---|
| tooling coverage-25a | `launchesOf(...)`'s explorer launches | each has `settings` `{'window.title': '[${rootName}]${remoteName}'}` (replace tooling-30's row) |
| tooling coverage-25a | the environment `runPlainLaunch` gives the tests of each explorer launch | it has `REMOTE_OSS_ACCEPTANCE_WINDOWS`, the launch's own pid folder |
| tooling coverage-25a | (each) the page choice for a state and a list of titles: folders `['/x/k1']` with `['[k1 [SSH: harness]]SSH: harness', '[k10]']`; no folders, `remoteName` `null`, with `['[]', '[]SSH: harness']`; no folders, `ssh-remote`, with the same; no folders, `ssh-remote`, with `['[]SSH: a', '[]SSH: b']` | the first title; `[]`; `[]SSH: harness`; a failure naming both titles. Export the pure choice function for the row, and keep knip green |
| tooling coverage-25a | a workspace with both files, where a `deferred` line of the explorer file gives `later` | one problem naming the explorer file and the reason |
| tooling coverage-25a | a workspace with both files, where an acceptance row cites `F-5101.AC-1` and the explorer file lacks it | one problem naming the explorer file |
| tooling coverage-25a | a workspace with the slice-1 file only | the report has one `counts` entry; the outcome is what it is today |
| tooling coverage-25a | `COVERAGE_SETS` | no feature is in two sets |
| tooling coverage-25a | `checkCoverage(REPOSITORY_ROOT)` | `kind` `checked`, with two `counts` entries, the second for the explorer file, whose total is its line count |
| tooling coverage-25a | `issueNumbersOf` of a catalogue with a remote-ssh and a remote-explorer row; `bodyOf(10, 'remote-oss/remote-explorer', <recording program>)` | both rows kept with their repositories; the program got `-R remote-oss/remote-explorer` |
| tooling coverage-25a | `seedFor(<catalogue>, <program answering a body with F-5101.AC-1 and AC-2>, <explorer set restricted to F-5101>)` | the header, then `F-5101.AC-1\ttodo\t` and `F-5101.AC-2\ttodo\t` |

The `notifications` helper gets its first use, and its proof, in coverage-25b.

## 5. Gates and review

All gates, including `pnpm check-coverage` (both sets: the explorer file is all `todo`, which passes) and a VSCodium
run with every launch green (the agent's naming change touches every plain launch). PR title
`tools, tests: the explorer gate's tooling (card coverage-25a, #644)`. themis or triton reviews; athena gives the design
check of §2.2 and §3.

## 6. Open rows (stop and report on #644)

1. An explorer launch without `REMOTE_OSS_ACCEPTANCE_WINDOWS` after #609 is merged.
2. `seed-coverage` can't read a remote-explorer issue with `gh` from the builder's room: report it. daedalus seeds
   the file.
3. A criterion line that `acceptanceCriteriaOf` misses or doubles for a remote-explorer issue, against the issue's
   AC count in `docs/architecture/catalogue.tsv` (`acCount`): report the difference. Don't edit the seeded file by hand.
