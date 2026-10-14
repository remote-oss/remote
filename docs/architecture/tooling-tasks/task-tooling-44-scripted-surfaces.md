# Task card tooling-44: scripted adapters per surface, and the windows harness split by area

Issue: #804. Release 0.2 (gate throughput). From athena's brief, family 5, and the data's `windows/harness.ts`. Size: M
(about 2 agent-days). Builder: unassigned (task:claude). Track C: lands after tooling-40 (#800), which also changes
`extension.ts`'s use of the adapters. The data is in tooling-38 §0: `tests/acceptance/windows/harness.ts` changed on
both sides of 5 merges, and `src/surfaces/scripted-adapters.ts` of 3 (hermes: #612, #694).

Behaviour doesn't change, and no row's name changes.

## 1. `scripted-adapters.ts` → one module per surface, behind a generated index

**Today:** one 736-line file holds:
- the shared machinery: switch and variables, `record`, `entriesOf`, `answeredOf`, the held-entry signals;
- the `ScriptEntry` union;
- `SCRIPT_SURFACES`;
- `scriptedAdapters`, whose returned object has one block per surface (`prompts`, `hostPick`, `filePick`,
  `failureDialog`, `licenceDialog`, `platformPick`, `mitigationPick`, `textInput`, `notice`).

A card that adds a surface edits the union, the record, the surface table and the returned object, all in this file.

**After:**
1. **`src/surfaces/scripted/script-core.ts`:** the shared machinery, moved unchanged. It exports the `ScriptCore`
   object a surface uses: `record`, `answered`, `entriesFor(surface)`, the held-entry wait, `windowName`, and `real`
   (the real terminals and download progress).
2. **One module per surface** in `src/surfaces/scripted/`, named for it (`host-pick.ts`, `file-pick.ts`,
   `failure-dialog.ts`, …). Each exports:
   ```ts
   export type Entry = {surface: 'hostPick'; match: string; answer: {label: string} | {typed: string} | 'dismiss'};
   export const SURFACE = {
     name: 'hostPick',
     adapter: (core: ScriptCore): EditorAdapters['hostPick'] => ({…}),   // today's block, moved
   } as const;
   ```
   - A module whose adapter answers no script entry has no `Entry`, and its `SURFACE` is marked `scripted: false`:
     `prompts`, for example, records but has its own entries. Check each block, and state it in the PR.
3. **`tools/module-index.ts`, new.** For each folder holding a `module-index.json` marker, it writes
   `<folder>/index.generated.ts`, which is git-ignored like the identifier tables. The file:
   - imports every module of the folder, in file-name order;
   - exports `type ScriptEntry = (A.Entry | B.Entry | …) & {window?: string; after?: string}`;
   - exports `SCRIPTED_SURFACES`, the array of their `SURFACE`s;
   - exports the `SCRIPT_SURFACES` record of the scripted ones.

   It throws, naming the file, on a module without `SURFACE`, or on two modules with the same `name`. The marker in
   `src/surfaces/scripted/` is `{"export": "SURFACE", "entryType": "Entry"}`.
4. **`scripted-adapters.ts`** keeps `scriptedAdapters`, `adaptersFor`, `progressFor`, `channelPortFor`, the window-name
   functions and `RecordLine`. It builds the adapters by mapping `SCRIPTED_SURFACES` over one `ScriptCore`, and checks
   with `satisfies` that every key of `EditorAdapters` it replaces is present.
5. **Running the generator:** every script that runs `node tools/identifiers.ts` (and tooling-41's
   `tools/locale-tables.ts`, if it has landed) also runs `node tools/module-index.ts`. `.gitignore` gains
   `packages/*/src/**/index.generated.ts`. Coverage and knip treat it as they treat `identifiers.generated.ts`.
6. **Adding a surface** is then one new module, with no edit to a shared file.
7. **`test/unit/scripted-adapters.test.ts`** splits the same way, into `test/unit/scripted/<surface>.test.ts`, over a
   shared `scripted.fixture.ts`. The core's rows go to `script-core.test.ts`.

## 2. `tests/acceptance/windows/harness.ts` → one file per area

Its exports move unchanged into these files:

| File | Exports |
|---|---|
| `windows/variables.ts` | `variable` |
| `windows/record.ts` | `RecordLine`, `WindowScriptEntry`, `windowEvents`, `scriptEntries`, `recordLines`, `connectionLog`, `heldLines`, `signal`, `appendScript` |
| `windows/agent.ts` | `AgentEvent`, `inWindow`, `openWindow`, `emptyWindows`, `nextEmptyName`, `nextEmptyWindow`, `windowNameOrder`, `reloadWindow`, `closeWindow`, `windowState`, `isTrusted`, `trustSettled` |
| `windows/host.ts` | `onHost`, `hostPassword`, `acceptedPasswords`, `fingerprintOf`, `agentKeys`, `agentAdd`, `agentClear` |
| `windows/processes.ts` | `connectionHelpers`, `sshChildren`, `waitFor`, `kill` |
| `windows/settings.ts` | `readUserSettings`, `restoreUserSettings`, `userSettings`, `settingIn` |

- Exports added on main before the build go to the area they belong to, and are listed in the PR.
- `harness.ts` is deleted.
- **No barrel:** a re-exporting `harness.ts` would bring the shared appends back. Every suite imports from the area
  file.
- Non-exported helpers go with their only user, or to `variables.ts` when several areas use them.

## 3. Gates and review

All gates:
- `pnpm test:unit` and the `windows` launch filtered, both with the same row counts as before; paste them;
- the full VSCodium run once, green;
- `tools/module-index.ts` at 100 %, with tools rows for a missing `SURFACE`, a duplicate name and the generated text
  for two fixture modules.

PR title `remote-ssh, tests: scripted adapters per surface, and the windows harness split by area (card tooling-44,
#804)`. Request athena only.

## 4. Land when

After tooling-40, and right after a quiet window. Every harness card in flight touches one of these files. Tell
hermes when it merges.
- **A branch that added a surface:** moves it into a module.
- **A branch that added a harness helper:** moves it into its area file.

## 5. Open rows (stop and report on #804)

1. Two surface blocks share state other than through the core (a variable both read and write). Name it.
2. esbuild's bundle of `extension.ts` can't resolve the git-ignored `index.generated.ts` in the build, so `pnpm build`
   order matters. Report the failing step, and don't commit the generated file.
