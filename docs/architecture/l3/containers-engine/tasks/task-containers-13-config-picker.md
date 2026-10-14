# Task card containers-13: C4, configuration discovery, the picker and the validation dialogs

Issue: #883. Milestone 0.4. Containers release 1, increment 1b (brief `brief-release-1.md` §2, the F-0301 row;
components.md C4; contracts.md §4). Builder: `task:claude`. Size: M (about 2 agent-days).

**Depends on:** containers-07 (#766) **merged**. This card replaces its interim configuration rule (§4.2 step 5 and
§4.3) and moves its `config-candidates.ts` into C4. If containers-07 hasn't merged, wait for it. Also containers-04
(`CliBridge.readConfiguration`) and containers-03 (`EngineDialogPort`, `executableOf`), both on main.

## 1. What this card builds, and what it leaves

**Builds (F-0301's release-1 half):**
- discovery: the three locations, exact-case names, links followed but not resolved, locale collation (5.0 step 1,
  BR-1, BR-2);
- the picker for two or more configurations, with its labels, descriptions and "Open File" button (5.0 step 4, BR-3,
  BR-12, BR-15);
- the checks the CLI lacks, before anything reloads: an unreadable file (7.E1, 7.E9's preferred outcome), a missing
  container source (7.E2), and a relative `workspaceFolder` (7.E10's preferred outcome);
- the one function every open command calls: `chooseConfiguration` (§3.6). This card wires Reopen in Container to it.
  containers-14 (rebuild, #884) and containers-17 (Flow B) call it as they are.

**Leaves:**
- **No configuration at all** (6.2, AC-7, AC-49): the add-configuration wizard is F-0801, in increment 2 (brief §2).
  Until then `chooseConfiguration` shows a short notice of ours and answers `noConfiguration` (athena on #890; §3.4,
  §3.6 step 1). The notice is removed when F-0801's wizard replaces it, and the release notes list it as release 1's
  interim behaviour. The catalogue keeps AC-7 and AC-49 deferred.
- **"Use Template" on the 7.E2 dialog** (STR:S389) opens F-0801's wizard, so it comes with F-0801 too. Release 1 shows
  the S113 warning with core's Cancel only (§3.5).
- **The dialogs of a configuration the CLI rejects** (7.E3, 7.E5: Edit, More Actions..., Retry) are C8's, in
  containers-11 (#881). `chooseConfiguration` hands the failure back (`readFailed`). Until containers-11 merges, C6
  keeps containers-07's warn line for it.
- **Out of release 1:** the discovery notification and its suppression (F-0402), "Open Container Configuration File"
  (F-0812), multi-root workspaces (6.5), virtual workspaces (6.6), Compose (7.E4, 7.E6), Windows and macOS.

## 2. Files

All under `packages/remote-containers/`:

| File | What |
|---|---|
| `src/config/configuration-text.ts` | pure: decoding, the tolerant parse, the label rule, the source check (§3.2, §3.3) |
| `src/config/discovery.ts` | pure over the `ConfigFiles` port: the candidates in order (§3.1) |
| `src/config/choose-configuration.ts` | the flow (§3.6), its ports (§3.5), and `CONFIG_TEMPLATES` |
| `src/config/config-ports.ts` | the `vscode` adapters of the ports (§3.5), covered through fakes as containers-07's `reopen-ports.ts` is |
| `src/open/reopen.ts` | calls `chooseConfiguration` in place of its steps 5 and 7 (§4) |
| `src/open/config-candidates.ts` and its test | **deleted**: `discovery.ts` takes them over |
| `l10n/bundle.l10n*.json` | the strings of §3.4 |
| `test/unit/configuration-text.test.ts`, `discovery.test.ts`, `choose-configuration.test.ts`, `reopen.test.ts` | the rows of §6 |
| `tests/acceptance/windows/renderer.ts`, `tests/acceptance/containers/picker.test.ts` | the acceptance rows of §6.5 |

## 3. The design

### 3.1 Discovery (`discovery.ts`; F-0301 5.0 step 1, BR-1, BR-2)

```ts
/** A place a configuration is found: the root dotfile, the root `.devcontainer/devcontainer.json`, or a subfolder. */
export type CandidatePlace =
  | {kind: 'dotfile'}
  | {kind: 'main'}
  | {kind: 'subfolder'; name: string};

/** One configuration file found in the folder. */
export interface Candidate {
  /** Absolute, through any link, never resolved. */
  file: string;
  /** Relative to the folder, with `/` separators: `.devcontainer/a/devcontainer.json`. */
  relative: string;
  place: CandidatePlace;
}

/** contracts §4's `ConfigFiles`, as C4 uses it. `exists` isn't needed: `list` reports each entry's kind. */
export interface ConfigFiles {
  /** The entries of a folder; `[]` when it doesn't exist or can't be listed. A link counts as what it points to. */
  list(folder: string): Promise<readonly {name: string; kind: 'file' | 'folder' | 'other'}[]>;
  /** The file's bytes, or `unreadable` when it can't be opened (permission denied, gone). */
  read(file: string): Promise<Uint8Array | 'unreadable'>;
}

export function discoverConfigurations(
  folder: string,
  files: ConfigFiles,
  compare: (left: string, right: string) => number,
): Promise<Candidate[]>;
```

**The rules:**
1. `list(folder)`: an entry named exactly `.devcontainer.json` of kind `file` is the dotfile.
2. An entry named exactly `.devcontainer` of kind `folder`: `list` it. An entry `devcontainer.json` of kind `file` there
   is `main`. Each entry of kind `folder` there is listed once more, and holds a candidate when it has an entry
   `devcontainer.json` of kind `file`. Nothing deeper is looked at.
3. **Order:** the dotfile, then `main`, then the subfolders sorted by `compare` on their names. When `compare` gives 0,
   the code-unit order of the names decides, so the order is total.
4. **Names are matched exactly** (`===`), so `DevContainer.json` is never a candidate, whatever the file system
   (AC-33).
5. **Links:** the adapter's `list` maps `vscode.workspace.fs.readDirectory`'s `FileType` flags: `Directory` set →
   `folder`; else `File` set → `file`; else `other`. A link to a folder carries `Directory | SymbolicLink`, so it's a
   folder, and the candidate keeps the link's own path (BR-1, AC-34). A dangling link is `other` and is never a
   candidate (beyond the boundary, §15).
6. **Hidden subfolders** (`.hid`) are scanned like any other.
7. **`compare`** is, in the adapter, `new Intl.Collator(undefined, {sensitivity: 'accent'}).compare`: the extension
   host's own locale, case-insensitive, accent-sensitive and non-numeric (BR-2). Rows inject `'en'` and `'sv'`
   collators.

### 3.2 Reading a candidate (`configuration-text.ts`; BR-9, BR-12, BR-14)

```ts
/** The text of a configuration file: UTF-8, with a leading byte-order mark of UTF-8, UTF-16 LE or UTF-16 BE decoded. */
export function decodeConfiguration(bytes: Uint8Array): string;

/** The tolerant read: the JSONC object, or undefined when no object can be read at all. */
export function parseConfiguration(text: string): Record<string, unknown> | undefined;
```

- **Decoding:** `EF BB BF` → UTF-8 of the rest; `FF FE` → UTF-16 LE of the rest; `FE FF` → UTF-16 BE of the rest
  (swap each byte pair, then decode as UTF-16 LE); otherwise UTF-8. Use `TextDecoder` with `fatal: false`. This is BR-14's
  **preferred** outcome: a UTF-16 file's `name` labels its row, and the file is used (AC-39).
- **Parsing:** `jsonc-parser`'s `parse(text, errors, {allowTrailingComma: true})`. `jsonc-parser` is already a
  dependency of the package (containers-04's pre-pass). The errors are ignored, and the parse gives what precedes a
  cut: a missing closing brace still gives the object (AC-31), and a file cut after `"image": ` gives `name` (AC-30).
  The result counts only when it's a plain object (not `null`, not an array). Otherwise `undefined`, which an empty
  file gives (7.E1).

### 3.3 Labels and the source check (`configuration-text.ts`; BR-3, 7.E2)

```ts
/** The picker label of a candidate: its `name`, or the fallback of its place. */
export function labelOf(place: CandidatePlace, parsed: Record<string, unknown> | undefined, translate: Translate): string;

/** Whether the configuration names a container source: `image`, `dockerFile`, `build.dockerfile` or `dockerComposeFile`. */
export function hasContainerSource(parsed: Record<string, unknown>): boolean;
```

- **The label:** `parsed.name` when it's a string other than `''`, verbatim, `${…}` unsubstituted (BR-10, AC-25's
  picker half). Otherwise: `dotfile` → S280 `Project Root`; `main` → S224 `Main`; a subfolder → its name (AC-4, AC-47,
  AC-76). A whitespace-only `name` is kept as it is; a non-string `name` takes the fallback (both are beyond the
  boundary, §15, and this is the simplest rule).
- **The source check:** true when any of `image`, `dockerFile` or `dockerComposeFile` is present with a value other
  than `undefined`, or when `build` is an object whose `dockerfile` is present. A present but wrong-typed value
  (`"image": 42`) counts as present: the CLI rejects it (7.E3), and that dialog is C8's.

### 3.4 Strings (`CONFIG_TEMPLATES` in `choose-configuration.ts`, and the l10n bundle)

| Id | English template | Spec |
|---|---|---|
| S303 | `Select a devcontainer.json file.` | F-0301 3.4, the picker's placeholder |
| S224 | `Main` | F-0301 BR-3 |
| S280 | `Project Root` | F-0801 3.4 (owner), used by F-0301 BR-3 |
| S257 | `Open File` | F-0108 3.4 (owner), the row button's tooltip (F-0301 5.0 step 6) |
| S181 | `Failed to read Dev Container configuration '{0}' file.` | F-0301 7.E1 |
| S113 | `Dev Container configuration '{0}' file is missing image information. You can add this manually or overwrite with a template.` | F-0801 3.4 (owner), F-0405 7.E8, F-0301 7.E2 |
| S411 | `Workspace folder in devcontainer.json must be an absolute path.` | F-0301 3.4, 7.E10 |
| S049 | `Cancelled container configuration selection.` | F-0301 3.4: the log only, never shown (6.3) |
| `noConfiguration` (ours, no S-id; ADR-0008) | `No dev container configuration was found in this folder. Add a .devcontainer/devcontainer.json file, then run the command again.` | athena on #890: release 1's interim notice for F-0301 6.2, until F-0801 |

The `noConfiguration` text is an invented string with no reference counterpart. Add it to the invented list kept on
remote-containers' identity decision issue (F-1406, binding rulings "Naming invented identifiers"), and comment there
with the template and #890.

`S324` `Show Log` is containers-03's (`ENGINE_TEMPLATES`): import it, and don't define it twice (dupes). Add the
English templates as keys of `l10n/bundle.l10n.json`, and the same keys in every locale bundle, as containers-03 did.
`check-string-tables` checks them.

### 3.5 Ports (`choose-configuration.ts`)

```ts
/** One row of the picker. */
export interface PickerRow {
  label: string;
  /** The relative path. */
  description: string;
}

/** What the user did with the picker. */
export type PickerAnswer =
  | {kind: 'picked'; index: number}
  | {kind: 'openFile'; index: number}
  | {kind: 'dismissed'};

/** The editor surfaces C4 uses. */
export interface ConfigSurfaces {
  /** Shows the single-select picker: no title, `placeholder`, rows in order with one "Open File" button each. */
  pick(rows: readonly PickerRow[], placeholder: string, openFileTooltip: string): Promise<PickerAnswer>;
  /** containers-03's `EngineDialogPort.showError` and `revealLog`, reused as they are. */
  dialogs: Pick<EngineDialogPort, 'showError' | 'revealLog'>;
  /** A modal warning with its detail and buttons; undefined when the user cancelled. */
  showWarning(message: string, detail: string, items: readonly string[]): Promise<string | undefined>;
  /** Opens the file in a preview editor tab. */
  openPreview(file: string): Promise<void>;
  /** A non-modal information message with no buttons; not awaited (`window.showInformationMessage`). */
  showInformation(message: string): void;
}

/** Everything `chooseConfiguration` needs. */
export interface ConfigurationPorts {
  files: ConfigFiles;
  surfaces: ConfigSurfaces;
  cli: Pick<CliBridge, 'readConfiguration'>;
  compare: (left: string, right: string) => number;
  translate: Translate;
  logger: Logger;
}
```

**The `vscode` adapters (`config-ports.ts`):**
- **`pick`:** `window.createQuickPick()`:
  - no `title`, the `placeholder`, `canSelectMany: false`, `matchOnDescription: false` and `matchOnDetail: false`, so
    filtering is on the label alone (BR-15, AC-40);
  - each item has `buttons: [{iconPath: new ThemeIcon('go-to-file'), tooltip: openFileTooltip}]`;
  - the first item is active, and nothing is remembered between runs (AC-3);
  - `onDidTriggerItemButton` → `openFile` with the item's index, hiding the pick;
  - `onDidAccept` with one selected item → `picked`; with none selected (the filter hid every row) → `dismissed`
    (6.3 step 3);
  - `onDidHide` before an answer → `dismissed` (Escape, or focus moved away: `ignoreFocusOut` stays false);
  - the pick is disposed in every case.
- **`showWarning`:** `window.showWarningMessage(message, {modal: true, detail}, ...items)`.
- **`openPreview`:** `window.showTextDocument(Uri.file(file), {preview: true})`. A file core can't open shows core's
  own state; the adapter swallows the rejection and logs at warn.

### 3.6 The flow (`chooseConfiguration`; F-0301 5.0 steps 4–6, 7.E1, 7.E2, 7.E9, 7.E10)

```ts
/** What an open command asks of C4: the host folder and the engine the CLI is to use. */
export interface ConfigurationRequest {
  /** The host folder, absolute (the window's folder, or Flow B's target). */
  folder: string;
  /** The Docker executable `executableOf` gave. */
  dockerPath: string;
  cancellation: AbortSignal;
}

/** How choosing ended. */
export type ConfigurationChoice =
  /** A configuration was chosen and read: the file and the folder to open in the container. */
  | {kind: 'chosen'; configFile: string; workspaceFolder: string}
  /** The folder holds no configuration (increment 2 hands this to F-0801's wizard). */
  | {kind: 'noConfiguration'}
  /** The user ended it: Escape, an empty filter, focus away, "Open File", or a cancelled CLI read. */
  | {kind: 'dismissed'}
  /** C4 showed its own dialog (7.E1, 7.E2 or 7.E10); nothing more is to be shown. */
  | {kind: 'rejected'}
  /** The CLI couldn't read the chosen configuration; C8 presents it (containers-11). */
  | {kind: 'readFailed'; configFile: string; failure: CliFailure};

export function chooseConfiguration(
  request: ConfigurationRequest,
  ports: ConfigurationPorts,
): Promise<ConfigurationChoice>;
```

**In order:**
1. `candidates = discoverConfigurations(folder, files, compare)`. With none, log at info
   `no dev container configuration in <folder>`, call `surfaces.showInformation(<noConfiguration>)` once, and answer
   `noConfiguration`. No other surface is called, and nothing is opened.
2. **One candidate:** it's chosen, with no picker (BR-4, AC-1, AC-2).
3. **Two or more:** for each candidate, `read` it. `unreadable` gives the fallback label (7.E9's preferred outcome:
   it's listed, AC-42). Otherwise `labelOf(place, parseConfiguration(decodeConfiguration(bytes)))`. The reads are
   independent, so run them with `Promise.all`. Then `pick(rows, S303, S257)`:
   - `openFile` → `openPreview(candidate.file)`, then `dismissed` (5.0 step 6, AC-15);
   - `dismissed` → log at info `Cancelled container configuration selection.` (S049's English text), then
     `dismissed`. Nothing is shown (6.3, AC-8);
   - `picked` → that candidate.
4. **Read the chosen file again** (its content may have changed since the picker opened), decode and parse it:
   - **`unreadable`, or `parseConfiguration` gives `undefined` (7.E1, 7.E9's preferred outcome, AC-9, AC-43, AC-53):**
     - first `openPreview(file)` (the file is open behind the dialog), not awaited before the dialog;
     - then `dialogs.showError('', S181 with {0} = relative, [S324])`. The message line is empty and the text is the
       detail, as 7.E1 observes, and as C8's dialogs do;
     - if the answer is S324, `dialogs.revealLog()`;
     - answer `rejected`.
   - **`!hasContainerSource(parsed)` (7.E2, AC-10, AC-54's Cancel half, AC-70's first half):**
     - `showWarning('', S113 with {0} = relative, [])`. Core adds Cancel, and Escape is Cancel;
     - when it closes, `openPreview(file)`. No editor is open while the warning shows;
     - answer `rejected`.
5. **The CLI read:** `cli.readConfiguration(target, undefined, event => logger.debug(…), cancellation)`, with `target`
   = `{workspaceFolder: folder, configFile: file, dockerPath, idLabels: [], mountWorkspaceGitRoot: true, mounts: [],
   logLevel: 'info'}` (containers-07 §4.2 step 7's target, unchanged):
   - `{kind: 'cancelled'}` → `dismissed`;
   - any other `CliFailure` → log at warn with its kind, then `readFailed` with the file and the failure.
6. **The workspace folder (7.E10's preferred outcome, decision F-0301 Q10, AC-44):**
   - when the **substituted** `configuration.workspaceFolder` the CLI gives is a string that doesn't start with `/`,
     show `dialogs.showError(S411, '', [S324])`; on S324, `revealLog()`. Answer `rejected`;
   - a value that substitution made absolute passes. An absent value passes: the CLI gives the default
     `/workspaces/<basename>`.
7. Answer `{kind: 'chosen', configFile: file, workspaceFolder: result.workspaceFolder}`.

**Nothing is written** to any file at any step (BR-8). `chooseConfiguration` never throws for a file or a CLI
problem: every such problem is one of the answers above.

## 4. Reopen in Container uses it (`reopen.ts`, containers-07 §4.2)

The flow becomes, after containers-07's steps 1–4 (re-entry, context, trust, the engine check):
- **step 5** is containers-07's step 6: `executableOf` gives the Docker file;
- **step 6** is `chooseConfiguration({folder, dockerPath: <file>, cancellation: <a fresh AbortSignal>}, ports)`:
  - `chosen` → containers-07's steps 8–10 with `configFile` and `workspaceFolder`;
  - `noConfiguration` → log at info `Reopen in Container found no configuration in <folder>`, and return;
  - `dismissed` or `rejected` → return;
  - `readFailed` → containers-07's warn line with the failure's kind, and return. containers-11 replaces this line with
    C8's dialog.
- The re-entry flag (step 1) covers the picker and the dialogs: a second call while the picker is open does nothing.

`ReopenPorts` loses `files`, and gains `config: Omit<ConfigurationPorts, 'cli' | 'logger'>`. The command passes its own
`cli` and `logger`.

## 5. What containers-14 and containers-17 call

Both call `chooseConfiguration` exactly as §4 does, with their own `folder` (Flow B: the folder the user picked) and
react to the five answers the same way. Neither re-implements discovery or the dialogs.

## 6. Rows

### 6.1 `configuration-text.test.ts` (pure)

| Cite | Given | Expected |
|---|---|---|
| BR-14 | `{"name":"N"}` as UTF-8; with a UTF-8 BOM; as UTF-16 LE with a BOM; as UTF-16 BE with a BOM | each decodes to the same text |
| BR-9, AC-26 | a `//` comment and a trailing comma | the object, with its `name` |
| AC-31 | `{"name":"Delta","image":"img"` (no closing brace) | the object with both members |
| AC-30 | `{ "name": "Gamma", "image": ` | an object whose `name` is `Gamma` |
| 7.E1 | `''`; `   `; `[1]`; `42`; `null` | `undefined` |
| BR-3, AC-4, AC-47 | no `name`, for each place: dotfile, main, subfolder `a` | `Project Root`, `Main`, `a` |
| BR-3, AC-76 | `name` `''` in subfolder `e` | `e` |
| BR-10, AC-25 | `name` `Config-${localEnv:USER}-A` | that text, unchanged |
| BR-3 (boundary) | `name` 5 in subfolder `x` | `x` |
| 7.E2 | (each) `image`; `dockerFile`; `dockerComposeFile`; `build: {dockerfile: "D"}`; `image: 42` | true |
| 7.E2, AC-10 | (each) `{"name":"x"}`; `build: {}`; `build: "D"` | false |

### 6.2 `discovery.test.ts` (over a fake `ConfigFiles`)

| Cite | Given | Expected |
|---|---|---|
| BR-2, AC-47 | the dotfile, main, and subfolder `a` | the three, in that order, with relatives `.devcontainer.json`, `.devcontainer/devcontainer.json`, `.devcontainer/a/devcontainer.json` |
| BR-2, AC-32 | subfolders `B a c 10 9 .hid _u lnk y`, collator `en` | `_u .hid 10 9 a B c lnk y` |
| BR-2, AC-74 | subfolders `a z ä o ö`, collators `en` then `sv` | `a ä o ö z`; `a o z ä ö` |
| BR-2 | subfolders `a` and `A` (a case-sensitive file system), collator `en` | `A` before `a` (the code-unit tie-break), the same on every run |
| BR-1, AC-33 | `.devcontainer/x/DevContainer.json` beside `a` | only `a` |
| BR-1, AC-49 | `src/devcontainer.json` and `.devcontainer/a/b/devcontainer.json` only | `[]` |
| BR-1, AC-34 | `lnk` listed as `folder` (a link to `a`), `y` holding `devcontainer.json` as `file` (a link) | `a`, `lnk`, `y`, each with its own path through the link |
| BR-1 | a `devcontainer.json` of kind `other` (a dangling link) | not a candidate |
| 6.2 | no `.devcontainer`, no dotfile; and an empty `.devcontainer` | `[]` both times |
| BR-1 | `.devcontainer` of kind `file` | `[]` (beyond the boundary, §15: the simplest outcome) |

### 6.3 `choose-configuration.test.ts` (over fakes that record each call)

| Cite | Given | Expected |
|---|---|---|
| BR-4, AC-1 | one candidate, a valid `image` configuration; the CLI gives `workspaceFolder` `/workspaces/p` | no `pick`; one `readConfiguration` with containers-07's target; `chosen` with the file and `/workspaces/p` |
| 5.0 step 4, AC-3, AC-5 | candidates `a` "Alpha", `b` "Beta" | `pick` once, with rows `[Alpha, .devcontainer/a/devcontainer.json]`, `[Beta, …/b/…]`, the placeholder S303 and the tooltip S257, translated through `translate` |
| AC-30, BR-12 | `a` "Alpha", `b` empty, `c` cut after `"image": ` | rows `Alpha`, `b`, `Gamma`; picking `b` → the S181 dialog; picking `c` → the S113 warning |
| 7.E9 (preferred), AC-42 | `a` valid, `c` `unreadable` | rows `a`, `c` (fallback); picking `a` goes on; picking `c` → `openPreview(c)` and the S181 dialog naming `.devcontainer/c/devcontainer.json` |
| AC-43 | the only candidate `unreadable` | no `pick`; the S181 dialog; `rejected`; no `readConfiguration` |
| 7.E1, AC-9, AC-53 | an empty single file; the dialog answers S324 | `openPreview` was called before `showError('', <S181 with the relative path>, [S324])`; `revealLog` once; `rejected` |
| 7.E1 | the same, answered Cancel (undefined) | no `revealLog`; `rejected` |
| 7.E2, AC-10, AC-54, AC-70 | `{"name":"x"}` | `showWarning('', <S113 with the relative path>, [])`, and `openPreview` only after it settles; `rejected`; no `readConfiguration` |
| 6.3, AC-8 | `pick` answers `dismissed` | the info line with S049's text; no dialog, no preview, no `readConfiguration`; `dismissed` |
| 5.0 step 6, AC-15 | `pick` answers `openFile` on row 2 | `openPreview` with row 2's file; no `readConfiguration`; `dismissed` |
| 6.2 (athena on #890) | no candidate | `noConfiguration`; exactly one `showInformation` with the `noConfiguration` text; no `pick`, dialog, warning or preview; the info line |
| 7.E10 (preferred), AC-44 | (each) the CLI's substituted `workspaceFolder` `src`; `relative/sub/dir` | `showError(<S411>, '', [S324])`; `rejected` |
| 7.E10 | the configuration's `workspaceFolder` `${localWorkspaceFolder}/x`, which the CLI gives as `/w/p/x` | `chosen` |
| contracts §6 | `readConfiguration` gives `configurationFailed` | the warn line with the kind; `readFailed` with the file and that failure; no dialog of C4's |
| contracts §6 | `readConfiguration` gives `cancelled` | `dismissed` |
| BR-8 | every row above | the fake `ConfigFiles` has no write method, and nothing outside it was called to write |

### 6.4 `reopen.test.ts` (containers-07's rows, updated)

- The **main row** now records `executableOf`, then `chooseConfiguration` (faked), then `currentContext`, then the
  open.
- **(each) `noConfiguration`, `dismissed`, `rejected`:** nothing opened; for `noConfiguration`, its info line.
- **`readFailed`:** nothing opened; the warn line with the kind.
- containers-07's two "interim" rows (zero and two candidates) are **deleted**. Their cases are §6.3's now.

### 6.5 Acceptance (`tests/acceptance/containers/picker.test.ts`, in containers-09's `containers` launch)

**Renderer helpers (`renderer.ts`):**
- `quickPickOf(name)` gives `{placeholder, rows: [{label, description, buttons: string[]}], active: number}` for the
  visible quick input, or `undefined`. Measure the selectors in the pinned build: the widget is `.quick-input-widget`
  while shown; the placeholder is its input's `placeholder` (or `aria-label`); the rows are `.quick-input-list
  .monaco-list-row`; the label is `.label-name`, the description `.label-description`, and the buttons' tooltips are
  the `.action-label` `aria-label`s. Write the selectors into the PR.
- `waitForQuickPick(name)` polls `quickPickOf` up to the harness's usual 60 s.
- `pressKey(name, 'Escape')`, if no such helper exists yet: dispatch the key to the quick input's `input`.

**Rows** (each folder written with containers-09 §4.1's helper, and each window trusted as in containers-09's rows):

| Name | Given | Expected |
|---|---|---|
| `F-0301 AC-47, AC-3: the picker lists the dotfile, Main and a subfolder, the first focused` | `.devcontainer.json` and `.devcontainer/devcontainer.json`, both without `name`, and `.devcontainer/b/devcontainer.json` named `Bee`, all `image` configurations; `remote-containers.reopenInContainer` sent to the window (not awaited) | `waitForQuickPick`: placeholder `Select a devcontainer.json file.`; rows `Project Root`/`.devcontainer.json`, `Main`/`.devcontainer/devcontainer.json`, `Bee`/`.devcontainer/b/devcontainer.json`, each with one button `Open File`; `active` 0 |
| `F-0301 AC-8: Escape closes the picker and changes nothing` | the same picker, then Escape | within 5 s `quickPickOf` is `undefined`; `windowState(<name>).remoteName` is `null`; `devContainersOf(<folder>)` is `[]`; no notification and no dialog |
| `F-0301 AC-9: an empty configuration shows S181 with Show Log` | only `.devcontainer/devcontainer.json`, empty; send the command | `waitForDialog`: its text holds `Failed to read Dev Container configuration '.devcontainer/devcontainer.json' file.`, and its buttons are `Show Log` and `Cancel` (write the DOM order into the PR); `answerDialog(…, 'Cancel')`; then `remoteName` `null`, and `devContainersOf` `[]` |
| `F-0301 AC-44: a relative workspaceFolder is refused before any reload` | an `image` configuration with `"workspaceFolder": "src"` | the dialog holds `Workspace folder in devcontainer.json must be an absolute path.`; after Cancel, the window's `activated` count is unchanged, `remoteName` `null`, and `devContainersOf` `[]` |

The rows need an engine only for the first check (containers-07 step 4), which the runner's Docker passes. No container
is ever created.

## 7. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- **`unit`:** F-0301 AC-4, AC-5, AC-15, AC-26, AC-30, AC-31, AC-32, AC-33, AC-34 (its picker half; the container half
  is named in the PR), AC-39 (the preferred outcome), AC-40 (`matchOnDescription: false`; the filtering is core's),
  AC-42, AC-43, AC-74, AC-76 (the label half).
- **`acceptance`:** AC-3, AC-8, AC-9, AC-44, AC-47.
- **Partial, stay `todo`, with the reason "containers release 1: increment 2 (authoring)" in the PR:** AC-10 and AC-54
  (Use Template), AC-53 (the log is our output channel; the spec's log terminal is F-0104's).
- **Deferred `containers release 1: later (multi-root)`:** AC-23, AC-24, AC-51, AC-52, AC-61, AC-67, AC-71.
- **Deferred `containers release 1: later (Open Container Configuration File, F-0812)`:** AC-19, AC-57, AC-65.
- **Deferred `containers release 1: later (virtual workspaces)`:** AC-27.
- Leave the rest for the cards that own them: AC-11, AC-16, AC-55, AC-56, AC-60 (containers-11); AC-59
  (containers-12); AC-72 (containers-14); AC-62, AC-66, AC-68, AC-75 (containers-17); AC-1, AC-2, AC-13, AC-14,
  AC-25, AC-69, AC-70 and AC-73 (the gate-rows card).

## 8. Gates and review

- Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-string-tables,
  check-consumed, check-coverage and coverage. Run the `containers` launch of the VSCodium run as well.
- New files must be at 100 %; `config-ports.ts` is covered through fakes, as containers-07's `reopen-ports.ts` is.
- PR title: `remote-containers: C4, configuration discovery, the picker and the validation dialogs (card containers-13,
  #883)`.
- Request athena only; hermes assigns the peer.

## 9. Open rows (stop and report on #883)

1. The CLI's `read-configuration` gives a relative `workspaceFolder` in a form other than §3.6 step 6 expects (for
   example already joined to `/workspaces`). Report its output for `"src"` and `"relative/sub/dir"`, and check
   `result.workspaceFolder` instead only if athena agrees.
2. The custom dialog of `showErrorMessage('', {modal: true, detail})` renders an empty bold line that the S181 row's
   `dialogOf` can't tell apart from a missing message. Report what it reads; don't change the empty message.
3. `vscode.workspace.fs.readDirectory` in the pinned build reports a link to a folder without `FileType.Directory`.
   Report the flags it gives, and use `stat` on each entry only if athena agrees.
