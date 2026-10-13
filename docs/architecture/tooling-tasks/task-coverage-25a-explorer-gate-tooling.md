# Task card coverage-25a: the explorer gate's tooling

Issue: #644. Release 0.3 (#43), explorer slice 1, item S8, part a. Why: the eight gate rows of slice 1 (brief
`docs/architecture/l3/windows-and-explorer/brief-remote-explorer.md`, "The slice-1 gate") need four things beyond
tooling-30 (#633):
- a name for an empty remote window apart from the local window;
- window titles that tell those two apart;
- the notification toasts a window shows;
- a coverage file for the explorer's slice-1 criteria.

coverage-25b writes the rows, and coverage-25c tags the criteria. Builder: selene. Size: about 1.5 agent-days.
**Depends on:** tooling-30 merged (`tests/acceptance/windows/renderer.ts`, the three explorer launches).

## 1. Files

| File | Change |
|---|---|
| `tests/acceptance/window-agent/src/window-name.ts` | `windowNameOf(firstFolderPath, remoteName)`: §2.1 |
| `tests/acceptance/window-agent/src/extension.ts` | `windowName()` passes `vscode.env.remoteName` as the second argument |
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts`, `packages/remote-ssh/src/extension.ts` | remote-ssh's own `windowNameOf`, which names the window in its record lines and matches script entries, changes the same way, and `extension.ts` passes `vscode.env.remoteName`. Otherwise the record would call a window `local` that the agent calls `empty-ssh-remote`. This is the harness adapter only: it runs under `REMOTE_OSS_ACCEPTANCE` alone |
| `tools/acceptance-launches.ts` | `EXPLORER_LAUNCH.settings` becomes `{'window.title': '[${rootName}]${remoteName}'}` (§2.2) |
| `tests/acceptance/windows/renderer.ts` | `isWindowTitled` for the new names (§2.2), and the new `notifications(name)` (§2.3) |
| `tools/check-coverage.ts`, `tools/spec-acceptance-criteria.ts`, `tools/seed-coverage.ts` | the coverage sets of §3 |
| `docs/architecture/catalogue/coverage-explorer-slice1.tsv` | new: seeded by `node tools/seed-coverage.ts explorer` (§3.3), every line `todo` |
| the matching `*.test.ts` of each changed tools file, and `packages/remote-ssh/test/unit/scripted-adapters.test.ts` for `windowNameOf` (the agent's copy has no unit file; the VSCodium run exercises it) | the rows of §4 |

Nothing else in `packages/` changes.

## 2. Windows

### 2.1 The name of an empty remote window

`windowNameOf(firstFolderPath: string | undefined, remoteName: string | undefined): string`:
- with a folder, the last segment of its path, as today;
- with no folder: `local` when `remoteName` is `undefined`, else `empty-<remoteName>` (for example `empty-ssh-remote`).

A window whose folder-less connect fails is still `empty-ssh-remote`, since the editor sets `remoteName` from the
authority. The only change for the existing launches is that an empty remote window is no longer called `local`.
Before writing, search `tests/acceptance` for rows that open an empty remote window and then use `local`, and list
them in the PR. There should be none: `no-proposals`' `opensshremotes.openEmptyWindow` opens a new window and then
uses only the result of the command. If one exists, stop (§6).

### 2.2 Titles

In the explorer launches the window title is `[${rootName}]${remoteName}`. It reads `[]` for the local empty window,
`[]SSH: harness` for an empty window on `harness`, `[smoke]` for a local folder, and
`[k1 [SSH: harness]]SSH: harness` for a remote folder (core's own label). `isWindowTitled(title, name)` becomes:
- `local`: `title === '[]'`;
- a name starting with `empty-`: `title.startsWith('[]')` and `title !== '[]'`;
- any other name: `title === `[${name}]`` or `title.startsWith(`[${name} [`)`.

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
| tooling coverage-25a | (each) `windowNameOf('/home/harness/k1', 'ssh-remote')`, `windowNameOf(undefined, undefined)`, `windowNameOf(undefined, 'ssh-remote')`, `windowNameOf('/', undefined)` | `k1`, `local`, `empty-ssh-remote`, `local` |
| tooling coverage-25a | `launchesOf(...)`'s explorer launches | each has `settings` `{'window.title': '[${rootName}]${remoteName}'}` (replace tooling-30's row) |
| tooling coverage-25a | (each) `isWindowTitled` for (`'[]'`, `local`), (`'[]SSH: harness'`, `empty-ssh-remote`), (`'[]'`, `empty-ssh-remote`), (`'[]SSH: harness'`, `local`), (`'[k1 [SSH: harness]]SSH: harness'`, `k1`), (`'[k10]'`, `k1`) | true, true, false, false, true, false. Export `isWindowTitled` for the row, and keep knip green |
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
check of §2.1 and §3.

## 6. Open rows (stop and report on #644)

1. A row on main that opens an empty remote window and then addresses it as `local`.
2. `seed-coverage` can't read a remote-explorer issue with `gh` from the builder's room: report it. daedalus seeds
   the file.
3. A criterion line that `acceptanceCriteriaOf` misses or doubles for a remote-explorer issue, against the issue's
   AC count in `docs/architecture/catalogue.tsv` (`acCount`): report the difference. Don't edit the seeded file by hand.
