# Task card tooling-44: scripted adapters per surface, and the windows harness split by area

Issue: #804. Release 0.2 (gate throughput). From athena's brief, family 5, and the data's `windows/harness.ts`. Size: M
(about 2 agent-days). Builder: unassigned (task:claude). Track C, in parallel with tooling-40 (#800): this card keeps
`extension.ts`'s imports as they are. The data is in tooling-38 §0: `tests/acceptance/windows/harness.ts` changed on
both sides of 5 merges, and `src/surfaces/scripted-adapters.ts` of 3 (hermes: #612, #694).

Behaviour doesn't change, and no row's name changes.

## 1. `scripted-adapters.ts` → one module per surface, behind a hand-written index

**Today:** one file holds:
- the shared machinery: switch and variables, `entriesOf`, `answeredOf`, and inside `scriptedAdapters` the functions
  `record`, `signalExists`, `untilSignal` and `answerFrom`;
- the `ScriptEntry` union and `RecordLine`;
- `SCRIPT_SURFACES`;
- `scriptedAdapters`, whose returned object has one block per adapter: `prompts`, `hostPick`, `filePick`,
  `failureDialog`, `licenceDialog`, `platformPick`, `mitigationPick`, `textInput`, `notice`.

A card that adds a surface edits the union, the record, the surface table and the returned object, all in this file.

**What answers what** (dike, from the code):
- the adapter `prompts` answers two entry surfaces, `pick` and `maskedInput`, both through `answerFrom` (lines 453 and
  463);
- the adapter `licenceDialog` answers the entry surface `licenceModal`;
- each other adapter answers the entry surface of its own name;
- `SCRIPT_SURFACES` is keyed by **entry** surface, so one module can contribute two.

**After:**
1. **`src/surfaces/scripted/entries.ts`, a leaf module:** the `ScriptEntry` union, every member as today, and
   `RecordLine`, moved unchanged. It holds types only, so it's a coverage exclusion, "types only; no executable code".
   - It's a leaf because `answerFrom` needs the full `Extract<ScriptEntry, {surface: Kind}>` union, and `RecordLine`'s
     `surface` is `ScriptEntry['surface']`. Keeping them in the index would make a type cycle through the surface
     modules.
   - Adding a surface adds one member here: one line, in the union's order.
2. **`src/surfaces/scripted/script-core.ts`:**
   - `entriesOf`, `answeredOf`, the switch and variable constants, moved unchanged;
   - `scriptCoreOf(scriptFile, recordFile, real, files, windowName, signalsFolder, sleep): ScriptCore`. It builds the
     closure that today's `scriptedAdapters` opens with: `record`, `signalExists`, `untilSignal` and `answerFrom`,
     moved unchanged.
   - `ScriptCore` exposes `record`, `answerFrom`, `real` (the real terminals and download progress) and `windowName`.
     A surface module needs nothing else; the builder confirms that against each block.
3. **One module per adapter** in `src/surfaces/scripted/`, named for the adapter: `prompts.ts`, `host-pick.ts`,
   `file-pick.ts`, `failure-dialog.ts`, `licence-dialog.ts`, `platform-pick.ts`, `mitigation-pick.ts`,
   `text-input.ts` and `notice.ts`. Each exports:
   ```ts
   export const SURFACE = {
     adapter: 'prompts',                      // the key of EditorAdapters it provides
     answers: ['pick', 'maskedInput'],        // the entry surfaces it answers, for SCRIPT_SURFACES
     build: (core: ScriptCore): EditorAdapters['prompts'] => ({…}),   // today's block, moved
   } as const;
   ```
4. **`src/surfaces/scripted/index.ts`, written by hand** (athena):
   - one import and one array entry per module, sorted by file name;
   - it exports `SCRIPTED_SURFACES`, the array, and `SCRIPT_SURFACES`, built from every module's `answers` and checked
     with `satisfies Record<ScriptEntry['surface'], boolean>` as today.
   - A tools row, `tooling-44: the scripted index lists every surface module, sorted, with unique names`, reads the
     folder and the index's import lines. It fails on a module the index lacks, an unsorted entry, or two modules with
     the same `adapter`.
5. **`scripted-adapters.ts`** keeps `scriptedAdapters`, `adaptersFor`, `progressFor`, `channelPortFor` and the
   window-name functions.
   - `unusedEntries`, which reads `entriesOf` and `answeredOf`, moves into `ScriptCore`, and `scriptedAdapters`
     returns `core.unusedEntries` as today's `unusedEntries`.
   - `scriptedAdapters` builds one `ScriptCore` and maps `SCRIPTED_SURFACES` over it.
   - It checks with `satisfies` that every key of `EditorAdapters` it replaces is present.
   - `extension.ts`'s imports are unchanged.
6. **Adding a surface** is one new module, one sorted index line and one union member in `entries.ts`. Two cards
   conflict only when they add neighbours.
   - **The harness too** (athena, ruling C): the acceptance suites' own copies of the entry types go.
     `tests/acceptance/suite-local/script.ts` (its `ScriptEntry` and `RecordLine`) and the windows harness's
     `RecordLine` and `WindowScriptEntry` (`windows/record.ts` after §2) become
     `import type {RecordLine, ScriptEntry} from '../../../packages/remote-ssh/src/surfaces/scripted/entries.ts'`,
     with `WindowScriptEntry` an alias of `ScriptEntry`.
     - Acceptance code already imports from `packages/remote-ssh/src`, for example `suite-client/client.test.ts` and
       `suite-remote/remote-window.test.ts`. A type import is erased when the suites are bundled, so the bundles don't
       change.
     - A harness copy that holds a field the product's type lacks, such as a test-only field, is an open row (§5).
     - So adding a surface is one module, one index line and one `entries.ts` member, for the harness as well.
7. **`test/unit/scripted-adapters.test.ts`** splits:
   - each surface's rows go to `test/unit/scripted/<module>.test.ts`;
   - the core's rows (`record`, signals, `answerFrom`) go to `test/unit/scripted/script-core.test.ts`;
   - the rows of `progressFor`, `channelPortFor` and the window-name functions stay in `scripted-adapters.test.ts`;
   - a shared `test/unit/scripted/scripted.fixture.ts` holds the helpers.
   - **Names:** every `it` name is unchanged; check-coverage reads `it` names. The `describe` titles change to the
     module's name, which changes mocha's full titles; nothing reads those. The PR lists the `it` count per file
     before and after, and the totals must be equal.

## 2. `tests/acceptance/windows/harness.ts` → one file per area

Its exports move unchanged into these files:

| File | Exports |
|---|---|
| `windows/shared.ts` | `variable`, and the private helpers several areas use: `agentFolder`, `agentFile`, `waitUntil`, `send`, `execFileAsync`, `WAIT_MILLISECONDS`. They're exported from here for the area files |
| `windows/record.ts` | `RecordLine`, `WindowScriptEntry`, `windowEvents`, `countOf`, `scriptEntries`, `recordLines`, `connectionLog`, `heldLines`, `signal`, `appendScript` |
| `windows/agent.ts` | `AgentEvent`, `inWindow`, `openWindow`, `emptyWindows`, `nextEmptyName`, `nextEmptyWindow`, `windowNameOrder`, `reloadWindow`, `closeWindow`, `windowState`, `isTrusted`, `trustSettled` |
| `windows/host.ts` | `onHost`, `hostPassword`, `acceptedPasswords`, `fingerprintOf`, `agentKeys`, `agentAdd`, `agentClear` |
| `windows/processes.ts` | `connectionHelpers`, `sshChildren`, `waitFor`, `kill` |
| `windows/settings.ts` | `readUserSettings`, `restoreUserSettings`, `userSettings`, `settingIn` |

- Exports added on main before the build go to the area they belong to, and are listed in the PR.
- A private helper used by one area only goes to that area's file.
- **`countOf` goes to `record.ts`, next to `windowEvents`, which it calls.** So `shared.ts` imports nothing from an area
  file, and the area files import `shared.ts` only: no cycle. The cycle lint rule covers only `packages/**`, so it
  wouldn't catch one here, and the builder checks the import graph by hand and says so in the PR.
- `harness.ts` is deleted.
- **No barrel:** a re-exporting `harness.ts` would bring the shared appends back. Every suite imports from the area
  files.
- **The importers to update:** the files that import `windows/harness.ts`, 17 at cb544167, by dike's count. List them
  with `grep -rlnE "windows/harness\.ts'" tests/acceptance` plus the files under `tests/acceptance/windows/` that
  import `'./harness.ts'`. Don't use a bare `harness.ts'` grep: it also finds the 10 importers of the unrelated
  `suite/harness.ts`. The README lines that name `windows/harness.ts` name the area files instead.

## 3. Gates and review

All gates:
- `pnpm test:unit` and the `windows` launch filtered, both with the same row counts as before; paste them;
- the full VSCodium run once, green;
- the index row of §1.4 in `tools/`, at 100 %.

PR title `remote-ssh, tests: scripted adapters per surface, and the windows harness split by area (card tooling-44,
#804)`. Request athena only.

## 4. Land when

Right after a quiet window, telling hermes when it merges. Every harness card in flight touches one of these files.
- **The live collisions** (at main 7dd735ac; #753 has merged, so its changes are on main):
  - **#779** (coverage-12) changes `scripted-adapters.ts`, its test and `suite-local/script.ts`. Its `script.ts` type
    edit moves into the surface's module and `entries.ts`, since the copy is gone.
  - **#797** (coverage-16) and **#807** (coverage-39) change `windows/harness.ts`. Their new helpers move into their
    area files.

  Before starting, the builder refreshes this list from GitHub (the open PRs touching these files) and names it in the
  PR. Land this card after them, or have their builders merge it right after, with the rules below.

An in-flight branch resolves like this:
- **A new surface:** it moves into a module, with an index line and an `entries.ts` member.
- **An edit to an existing surface's block:** it moves to that surface's module.
- **An edit to the core** (`record`, `answerFrom`, signals) or a new `real` pass-through: it goes to
  `script-core.ts`.
- **New or changed `scripted-adapters.test.ts` rows:** they go to the matching per-module test file, with their `it`
  names unchanged.
- **New or changed harness helpers:** they go to their area file. `harness.ts` is deleted on main, so git reports
  modify/delete, and the branch takes the deletion.

## 5. Open rows (stop and report on #804)

1. Two surface blocks share state other than through the core (a variable both read and write). Name it.
2. A harness copy of the entry types (`suite-local/script.ts`, `windows/harness.ts`) holds a field or a surface
   that the product's types lack. Name it; athena decides whether it joins the product type or stays a harness-only
   extension declared in the harness file.
3. A surface block reads something from the closure that §1.2's `ScriptCore` doesn't expose. Name it, and the
   builder adds it to `ScriptCore` only if it's shared, never a surface's own state.
