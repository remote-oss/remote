# Task card connect-87: the pre-connection script runs, asked for and remembered (F-2108)

Release 0.2, slice 3. Size: L. Builder: `task:claude`. Spec: remote-oss/remote-ssh#26 (F-2108, `spec:reviewed`, 42
criteria), with athena's rulings there on Q3, Q4, Q5 and Q7 (2026-10-20). Brief: `docs/architecture/build-order.md`,
"Slice 3", F-2108. **Depends on coverage-47 (#1215)** (the F-2108 lines in `coverage-slice1.tsv`).

Two places where this card corrects the brief, from the code and the spec:
- The spawn goes through **lib-ssh's** process port (`ProcessSpawner`, `machine.spawner` in `connect-ports.ts`):
  lib-host has no local process port.
- **Cancel is a skip**, not F-2304's cancel. F-2108 6.2 and AC-10 make "Skip", "Cancel", Escape and "X" behave the
  same, and a modal `showWarningMessage` can't tell the last three apart anyway.

## 1. On main

- `pipeline/preconnect-step.ts` is a stub. With no script it goes on, and when one applies it fails with
  `preconnectFailed` and a warning.
- `pipeline/connect.ts` runs `steps.preconnect` on attempt 1 only. It's bounded by `PRECONNECT_MILLISECONDS` (5 min,
  `bounds.ts`) and fails `{kind: 'preconnectFailed'}` on the bound. This bound is AC-42's and stays as it is.
- `host-settings.ts` `preconnectScriptFor(setting, alias)` returns the path, or `undefined`.
- The setting comes from `connect-ports.ts` (`preconnect: () => valueOf(settings, 'preconnect')`).

## 2. The value (host-settings.ts)

Replace `preconnectScriptFor` with `preconnectChoiceOf(setting: unknown, alias: string): PreconnectChoice`:

```ts
/** What `remote.SSH.preconnect` asks of a connect to the alias. */
export type PreconnectChoice =
  | {kind: 'none'}
  | {kind: 'script'; path: string}
  | {kind: 'notAPath'; valueKind: 'number' | 'boolean' | 'object' | 'list'};
```

- A string: `''` gives `none`, any other string gives `script`.
- A plain object (`isMap`): `exactEntry(setting, alias)`.
  - A missing entry, `''` or `null` gives `none`.
  - A non-empty string gives `script`.
  - A number, a boolean, an array or an object gives `notAPath` with `number`, `boolean`, `list` or `object`.
- Anything else at the top level (`true`, a number, an array, `null`) gives `none` (6.6 step 2, AC-41).
- The match is `exactEntry`'s: exact and case-sensitive, with no patterns (BR-2). `hostAlias(input.target)` stays the
  key. Its BR-2 cases (the alias as written, `host` alone for `user@host:port`, the name used) get unit rows here.
  Change nothing in `hostAlias` unless a row fails. If one does, stop and comment.
- Q7's fifth word, "null", can't be reached (a per-host `null` is no script, 6.5 step 4), so it gets no id.

## 3. The runner (new folder `src/preconnect/`, component `ssh.preconnect-runner`)

### 3.1 Ports (`src/preconnect/ports.ts`)

```ts
/** What the pre-connection step needs of the machine and of the editor. */
export interface PreconnectPorts {
  /** The file's bytes; rejects with the system's error (its `message` is shown as it is). */
  readFile(file: string): Promise<Uint8Array>;
  /** Whether anything exists at the path (a file, a folder, anything `lstat` sees). */
  exists(file: string): Promise<boolean>;
  spawner: ProcessSpawner;
  /** The editor's environment, given to the script as it is. */
  environment: Readonly<Record<string, string>>;
  /** The editor process's working directory, which a relative path resolves against. */
  workingDirectory: string;
  /** The home folder `~/` expands to: the `HOME` the editor runs with. */
  home: string;
  approvals: PreconnectApprovals;
  dialog: PreconnectDialog;
  logger: Logger;
}
```

Wire the Node side in `connect-ports.ts`:
- `readFile` is `fs/promises` `readFile`;
- `exists` is `lstat` resolving true, and false on `ENOENT`;
- `spawner` is `machine.spawner`;
- `environment` is the `process.env` strings, `workingDirectory` is `process.cwd()`, and `home` is `os.homedir()`.

### 3.2 Paths (`src/preconnect/script-path.ts`)

- `expandedPath(configured, home)`: a path starting with `~/` becomes `home` + the rest. Any other path is returned
  as is.
- The expanded path is what the dialog shows (S002's `{0}`), what the log names, what the approval key holds, and what
  the not-found detail names (relative ones as written, Q5).
- `programPath(expanded, workingDirectory)`: `path.resolve(workingDirectory, expanded)`. Only the spawn and its
  `EACCES` detail use it, so a relative name is never looked up on `PATH` (BR-3).

### 3.3 Approvals (`src/preconnect/approvals.ts`)

```ts
export interface PreconnectApprovals {
  /** The stored content hash for the path, or nothing. */
  hashFor(expandedPath: string): string | undefined;
  remember(expandedPath: string, hash: string): Promise<void>;
}
export function approvalsOf(state: AcceptanceState): PreconnectApprovals; // the memento port of acceptance-store.ts
export function contentHashOf(bytes: Uint8Array): string; // lowercase hex SHA-256 (node:crypto)
```

- Key: `preconnectScriptConfirmed:` + `Buffer.from(expandedPath, 'utf8').toString('base64')`, standard alphabet with
  padding (BR-8, AC-11).
- Value: the hex string.
- `hashFor` gives back a stored value only when it's a string.
- Use `context.globalState`. Never add the key to `setKeysForSync` (the brief: not synced). Nothing ever removes an
  entry.

### 3.4 The dialog (`src/surfaces/preconnect-dialog.ts`, modelled on `licence-modal.ts`)

```ts
export type PreconnectAnswer = 'allow' | 'allowAlways' | 'skip';
export interface PreconnectDialog {
  /** Asks about the script; `changed` picks S108's message. 'skip' also for Cancel, Escape and X; 'aborted' when `cancellation` fires first. */
  ask(path: string, changed: boolean, cancellation: AbortSignal): Promise<PreconnectAnswer | 'aborted'>;
}
export interface PreconnectDialogPort {
  /** A modal warning message with the detail and the extension's items; the editor adds Cancel. */
  showModal(message: string, detail: string, buttons: readonly string[]): PromiseLike<string | undefined>;
}
```

- Templates, translated with `filled`:
  - `S068: 'Execute pre-connection script?'`
  - `S108: 'Pre-connection script has changed since last confirmation'`
  - `S002: "'{0}' will be executed on your local machine."`
  - `S007: 'Allow'`
  - `S008: "Allow and Don't Ask Again"`
  - `S133: 'Skip'`
- Buttons in that order: S007, S008, S133.
- A dialog that can't be shown counts as `skip`.
- The real port, in `editor-adapters.ts` beside `licenceDialogOf`: `window.showWarningMessage(message, {modal: true,
  detail}, ...buttons.map(title => ({title})))`.
- The scripted port, `scripted-adapters.ts`, a new surface:
  `{surface: 'preconnectDialog'; match: string; answer: {button: string} | 'dismiss'}`.
  - `match` is against the message.
  - The record line carries `buttons` and `detail`, as the licence modal's does.
  - Add the surface to `SCRIPT_SURFACES`.

### 3.5 The step (`pipeline/preconnect-step.ts`, rewritten)

`preconnectStep({setting, ports, onRunning, prompting})` returns `ConnectSteps['preconnect']`:
- `onRunning` tells the new phase.
- `prompting` is wiring's wrapper, which tells `promptShown` before the dialog.

Order, for one call:

1. `preconnectChoiceOf(setting(), hostAlias(input.target))`.
   - `none`: return done. Nothing is logged and no phase is told (AC-2, AC-41).
2. `onRunning()`: the progress shows S118 from here until the step ends, also under the dialog (5.0 step 2, AC-3).
3. `notAPath`: fail with `reason: {id: 'preconnectNotAPath', values: [alias, {id: <valueKind id>, values: []}]}`.
   There's no dialog (7.E5, AC-27).
4. `expanded = expandedPath(path, home)`. When `approvals.hashFor(expanded)` is set, the file is read first (BR-6):
   - the read fails: fail with the error's `message` as the detail (7.E9 a, AC-35). There's no dialog, and the entry
     stays;
   - the hash equals the stored one: go to 6 with no dialog (6.3 step 4, AC-12, AC-39);
   - it differs: log `the pre-connection script's contents have changed since the last confirmation`, then ask with
     `changed: true` (6.4).
5. With no stored hash, ask with `changed: false`, and don't check the path first (BR-6, AC-26). Then by answer:
   - `aborted`: return failed `preconnectFailed`, without running anything. The bound has already answered the connect,
     and an "Allow" that comes later runs nothing.
   - `skip`: log `the user skipped the pre-connection script`, and return done (6.2, AC-10). Nothing is stored or
     removed.
   - `allowAlways`: read the file. When the read fails, fail with its message, store nothing and don't run (7.E9 b,
     AC-36). Otherwise `remember(expanded, contentHashOf(bytes))` **before** running (6.3 steps 2–3, AC-23), then
     run.
   - `allow`: run. Nothing is stored (BR-7).
6. Run:
   - `exists(programPath)` false: fail with `script not found: ${expanded}`, and no path line (7.E4, AC-18, AC-26).
   - Otherwise log `running the pre-connection script ${expanded}`.
   - `spawner({program: programPath, programArguments: [], environment})`, then `endInput()` at once, so a read gets
     end of input (BR-10, AC-38).
   - A spawn rejection fails with its `message`, which is Node's `spawn <absolute path> EACCES` for a file that isn't
     executable or for a folder (7.E3, AC-25).
   - Each stdout chunk is logged as one info line `[preconnect] ${chunk}`, and each stderr chunk as
     `[preconnect (stderr)] ${chunk}`. One trailing `\n` is cut, and nothing else is split (BR-12). The spawner already
     decodes UTF-8. The logger's masking applies as to any line.
   - Exit 0: done. No exit line is logged.
   - Exit `n`: fail with `non-zero exit code ${n}` (7.E1).
   - Exit `undefined` (a signal): fail with `ended by a signal` (7.E2 allows our own detail).
7. Every failure above has `{kind: 'preconnectFailed', reason: {text: detail}}`, except 3, which has its id. It logs
   two error lines: `the pre-connection script failed: ${detail}`, then the summary line
   `[PreconnectScriptFailure]: The pre-connect script has failed (${detail})`. That line is S141 as literal text. The
   log isn't translated (7.E1, AC-21). For 3, the detail in both lines is the English text of the reason.
8. When `cancellation` fires while the script runs, log `the pre-connection step stopped waiting; the script is left
   to finish`, return failed, and **don't kill the process**. 6.8 step 4 doesn't end a running script, and the bound
   ends only the wait (7.E8). Ending it would need a new decision.

Wiring (`pipeline/wiring.ts`): `preconnect: preconnectStep({setting: ports.settings.preconnect, ports:
ports.preconnect, onRunning: () => onPhase({kind: 'runningPreconnectScript'}), prompting})`.

### 3.6 The failure's reason (failure-strings.ts, l10n)

Add these to `FAILURE_TEMPLATES` and `FailureStringId`:
- `preconnectNotAPath: 'The value of remote.SSH.preconnect for "{0}" is {1}, not the path of a script.'`
- `preconnectValueNumber: 'a number'`
- `preconnectValueBoolean: 'a boolean'`
- `preconnectValueObject: 'an object'`
- `preconnectValueList: 'a list'`

The id is provisional, from Q7's proposal on #26, until the spec records it. Each English text goes into
`l10n/bundle.l10n.json` and into every locale's bundle as the English text (`node tools/string-tables.ts remote-ssh`
must pass). `KIND_MAY_RECOVER.preconnectFailed` stays `false`.

### 3.7 The progress (lib-authority, remote-ssh)

- `lib-authority/src/resolver/host.ts` `PhaseName` gains `'runningPreconnectScript'`. remote-containers' table isn't
  exhaustive, so it doesn't change.
- `pipeline/connect.ts` `PhaseEvent` gains `{kind: 'runningPreconnectScript'}`. `phaseOf` gives it no details link
  and doesn't make it quiet. `progressLine` stays generic (`Progress: runningPreconnectScript`).
- `surfaces/progress-titles.ts`: `runningPreconnectScript: 'S118'`. `phaseTitleOf` gives S118 the value
  `[show log](command:opensshremotes.showLog "Show log")` (the command id from `identifiers.generated.ts`). Neither
  "show log" nor "Show log" is translated (3.4, last paragraph). Add `S118: 'Running pre-connection script ({0})'` to
  the templates and the bundles.
- Core shows `Setting up SSH Host <alias>: Running pre-connection script (show log)` (AC-3).

## 4. Rows

### Unit (`packages/remote-ssh/test/unit/`)

- `host-settings.test.ts`, `F-2108.AC-15`, `AC-16`, `AC-33`, `AC-41`, `AC-27`: every branch of §2 is a row, named
  after its criterion.
- `preconnect-approvals.test.ts`, `F-2108.AC-11`:
  - the key for `/a b/ü.sh` and for a relative `s.sh`, with padding `=` and `==` (pick paths that give both);
  - the hash of a known content;
  - a non-string stored value counts as none.
- `preconnect-dialog.test.ts`, `F-2108.AC-4`, `AC-13`:
  - the message, detail and buttons in order, plus S108 when changed;
  - each answer, with `undefined` giving skip and a rejection giving skip;
  - an abort gives `aborted`.
- `preconnect-step.test.ts` (rewrite the stub's file and keep its no-script rows; `host-settings.test.ts`'s `F-2108 BR-1`/`6.5` rows move to the new function's names), one row per branch of §3.5, each
  named after its AC: AC-2, 3, 6, 7, 10, 11, 12, 13, 14, 17 (`~/` expansion against `home`), 18, 19, 23, 24, 25, 26,
  27, 35, 36, 37, 38, 39, 42 (abort while asking, abort while running: no kill, an "Allow" after the abort runs
  nothing).
- `progress-titles.test.ts`, `F-2108.AC-3`, `AC-31`: the S118 text with the link, and the link's command.
- `connect.test.ts` probably already has the attempt-1-only row (`F-2108.AC-30`) and the bound row. Rename them to
  those cites if they carry others, and add them if they're missing.
- `slice-*`/`connector` tests: the new phase reaches the window, has no details link, and isn't quiet.

### Acceptance (new plain launch `preconnect`, suite `tests/acceptance/preconnect/`)

The launch is `{label: 'preconnect', kind: 'plain', suite: 'preconnect'}` in `tools/acceptance-launches.ts`, with its
unit row beside the others. The rows use `../windows/harness.ts`:
- `userSettings` / `restoreUserSettings` in `finally`;
- `openWindow`, `reloadWindow`, `closeWindow`;
- `appendScript` with the `preconnectDialog` surface, `recordLines`, `connectionLog`, `signal` and `onHost`.

Each row writes its fixture scripts under `path.join(variable('HARNESS_RUN_FOLDER'), 'f2108')`. A script writes a marker file (its arguments count, `pwd`, `[ -t 0 ]`, one
variable of the launch's environment, its pid) so a row can tell what ran.

Rows, named `F-2108 AC-n (<case>)`:

| AC | Case |
|---|---|
| 2 | unset: no `preconnectDialog` line, and no S118 in the progress lines |
| 3, 4 | the S118 progress line, then the dialog's message, detail and buttons |
| 5 | a held answer (`after`) for 120 s: still open, no marker, no failure dialog; then signal Allow |
| 6, 7 | Allow: marker (0 args, not a tty, the editor's cwd, the variable), `[preconnect] ` and `[preconnect (stderr)] ` lines, connected, all `[preconnect]` lines before the client lookup's first line |
| 8 | a 150 s script: connected after it (allow 200 s) |
| 9 | Allow once, reload: the dialog again |
| 10 | Skip, and dismiss: no marker, the skip line, connected, no notice |
| 11, 12 | Don't Ask Again; a new window to another alias of the harness config runs it with no dialog; `settings.json` unchanged |
| 13, 14 | content changed: S108; Allow keeps asking; Don't Ask Again stops it |
| 15 | an object keyed `harness` runs; one keyed `Harness` or `*` asks nothing |
| 18 | relative missing: `script not found: f2108-missing.sh` |
| 19, 21 | exit 1: `failureDialog` line `Could not establish connection to "harness": non-zero exit code 1.` with Retry, More Actions..., Close Remote; the log's output, error and summary lines |
| 22, 23 | Retry asks again; after Don't Ask Again with a failing script, Retry runs it with no dialog |
| 24 | `kill -9 $$`: the failure dialog with `ended by a signal` |
| 25 | mode 644, and a folder: `spawn <path> EACCES`, no marker |
| 26 | missing absolute path: the dialog first, then `script not found: <path>` |
| 27 | `{harness: 7}`: no dialog, the failure with Q7's text naming `harness` and "a number" |
| 29 | an executable `.py` file with an `sh` interpreter line runs |
| 30 | after a run, `cutHostNetwork`/`restoreHostNetwork` reconnects with no new marker; "Kill VS Code Server on Host..." runs no marker |
| 32 | the setting in a local `.code-workspace` file, and in the remote folder's `.vscode/settings.json` on the second load: the dialog shows |
| 34 | reload while a 60 s script runs: its pid is alive after the reload and ends on its own; Allow after the reload starts a second pid |
| 35 | confirmed, then deleted: no dialog, `ENOENT: no such file or directory, open '<path>'`, and (Don't Ask Again on a new file at the path) it asks no more, so the entry stayed |
| 36 | Don't Ask Again on a missing path, a folder and a mode-000 file: the three file-read details, no marker, and the next connect asks again |
| 37 | a path with a space: the detail shows it unchanged, and it runs |
| 38 | a script that runs `read line` and then exits 0: connected |
| 39 | confirmed, `touch`ed: no dialog, runs |
| 40 | two windows at once: two dialog lines (`window` names), answering one leaves the other held, two pids |
| 42 | a `sleep 400` script: the failure dialog within 5 min 30 s of the S118 line, and the script's pid still alive |

AC-34 and AC-42 leave processes running. Kill them by pid at the end of the row, in `finally`.

### Coverage (`docs/architecture/catalogue/coverage-slice1.tsv`)

- Tag `acceptance`: 2–15, 18, 19, 21–27, 29, 30, 32, 34–40 and 42. A row of a mixed criterion (24, 25, 27, 35)
  covers everything outside the troubleshooting row, which is F-2605's (its own lines are deferred under D-86).
- Tag `unit`: 1 (if coverage-47 found no manifest row, add `F-2108.AC-1` beside the other manifest rows of
  `docs.test.ts`/the manifest test), 16, 17, 31, 33 and 41.
- Tag `deferred`: 20 with `D-86: only clearAllSessionHints of F-2605 is in 0.2`, and 28 with `D-60: Windows client`.

## 5. Done when

- The remote-ssh unit tests pass, with `src/preconnect/*`, `preconnect-step.ts`, `preconnect-dialog.ts` and
  `host-settings.ts` at 100 %.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches preconnect` passes. Paste the summary line.
  Also run `windows`, which `phaseOf` and the progress touch.
- The whole diff is linted, and `pnpm dupes`, `pnpm dead`, `node tools/check-coverage.ts` and
  `node tools/string-tables.ts` are clean.
- `release-0.2-notes.md` lists two choices, the signal detail and the bound's leaving the script running.
- PR title: `remote-ssh: the pre-connection script runs, asked for and remembered (card connect-87, #1216)`.
  Request athena only, and tell proteus the new launch's name for CI.
