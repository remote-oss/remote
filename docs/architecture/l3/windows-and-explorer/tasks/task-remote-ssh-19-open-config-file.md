# Task card remote-ssh-19: "Remote-SSH: Open SSH Configuration File..." (F-2203)

Why: #397, a 0.2 blocker under #299. The "More Actions..." picker's item "Open SSH Configuration File" (F-2602,
#382) runs `opensshremotes.openConfigFile`, and nothing serves that command. F-2203 (`remote-oss/remote-ssh#30`) is
the command. Its pure parts exist: the picker model (`config/file-choice.ts`, card ssh-11) and the creation plan and
template (`config/new-file.ts`, card ssh-12). This card builds the command over them: the picker, the creation of a
missing file with its modes, opening the editor, inserting the template as a snippet, and the registration. The
same command id serves Remote Explorer's "Open SSH Config File" (F-3906 rule 10) and, later, the Connect pickers'
"Configure SSH Hosts..." row (F-2301). Owner: B's `ssh.config-flows` (windows-and-explorer components.md).
Reviewing coder: `remote-coding-worker-1`.

**Out of this card:** BR-9's save watch (a save re-reads the configuration and fires the host-list change). It belongs
to F-2202 and to F-3906 rule 7 (`remote-internal.sshHostsChanged`), which have no host-list consumer in this package
yet; AC-26 is left to that card. The Connect pickers' row (F-2301) is also left out.

**Two rows wait on the spec** (asked on `remote-oss/remote-ssh#30`): F-2203 Q1 (a relative `remote.SSH.configFile`)
and Q2 (a missing system file in a writable folder). Until metis answers, the card fixes the behaviour the question
proposes, and those two rows say so (section 6).

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/config/open-config-file.ts` | new: `openConfigFileHandler` over its ports (section 2.1) |
| `packages/remote-ssh/src/config/config-file-editor.ts` | new: the editor and file adapters, `vscode` and `node:fs` imported (section 2.2) |
| `packages/remote-ssh/src/config/new-file.ts` | `NewFileInput.role` gains `'system'` (section 2.3) |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | the ids S047, S077, S126, S131, S162, S166 in `FailureStringId` and `FAILURE_TEMPLATES` (section 2.4) |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | the six texts as keys |
| `packages/remote-ssh/src/register-connect.ts` | no change |
| `packages/remote-ssh/src/activation.ts` | serves `openConfigFile` beside the help commands (section 2.5) |
| `packages/remote-ssh/src/extension.ts` | passes the editor ports (section 2.5) |
| `docs/remote-ssh/ssh-config.md` | new: our page about SSH configuration files, the Help row's target (section 2.6) |
| `packages/remote-ssh/test/unit/open-config-file.test.ts` | new (section 3.1) |
| `packages/remote-ssh/test/unit/config-file-editor.test.ts` | new, over a fake editor and a temporary folder (section 3.2) |
| `packages/remote-ssh/test/unit/new-file.test.ts`, `activation.test.ts`, `failure-strings.test.ts`, `strings.test.ts`, `skeleton.test.ts` | rows changed or added (section 3.3) |
| `tests/acceptance/suite/remote-ssh.test.ts` | one row (section 3.4) |

## 2. Contract

### 2.1 `openConfigFileHandler` (pure, no `vscode`, no `node:fs`)

```ts
import type {CommandHandler} from 'lib-identifiers';
import type {FileChoice, FileChoiceItem} from './file-choice.ts';
import type {Template} from './new-file.ts';

/** What the command needs of the editor. */
export interface ConfigFileEditor {
  /**
   * Shows the file picker: no title, single selection, the first row focused, open when the focus moves away
   * (F-2203 AC-28). Gives the chosen row, or nothing on Escape.
   */
  pickFile(choice: FileChoice): PromiseLike<FileChoiceItem | undefined>;
  /** Opens the local file as a preview editor in the active group, or reveals it when it is open (BR-7). */
  open(file: string): PromiseLike<void>;
  /** Inserts `template` as a snippet at the start of the file's editor (BR-6); the editor adjusts its indentation. */
  insertTemplate(file: string, template: Template): PromiseLike<void>;
}

/** What the command needs of the client's files. */
export interface ConfigFiles {
  exists(path: string): PromiseLike<boolean>;
  /** The missing folders on the path to `file`, outermost first. */
  missingFolders(file: string): PromiseLike<readonly string[]>;
  /** Makes one folder with `mode`; a failure rejects with the system error. */
  makeFolder(path: string, mode: number): PromiseLike<void>;
  /** Creates one empty file with `mode`, failing if it exists; a failure rejects with the system error. */
  createFile(path: string, mode: number): PromiseLike<void>;
}

/** Where the command looks. */
export interface ConfigFilePlaces {
  homeFolder: string;
  /** The user file, `<home>/.ssh/config` with the platform's separators. */
  userFile: string;
  /** The system file, `/etc/ssh/ssh_config`. */
  systemFile: string;
}

/** The two fixed rows' actions. */
export interface ConfigFileActions {
  /** "Settings": the Settings editor with the query of F-2203 6.4 step 2. */
  openSettings(query: string): PromiseLike<unknown>;
  /** "Help": the external browser on our page. */
  openHelp(): PromiseLike<unknown>;
}

export function openConfigFileHandler(
  editor: ConfigFileEditor,
  files: ConfigFiles,
  actions: ConfigFileActions,
  places: ConfigFilePlaces,
  /** `remote.SSH.configFile` as written, read at each run (BR-1). */
  configFile: () => string,
  /** The extension and its pack, for the Settings query. */
  extension: {id: string; pack: readonly string[]},
): CommandHandler;
```

`execute()`, per run:

1. `choice = buildFileChoice({configFile: configFile(), userFile: places.userFile, systemFile: places.systemFile})`.
2. `picked = await editor.pickFile(choice)`. Nothing picked: return (F-2203 6.6, AC-16: nothing created, nothing
   opened).
3. `picked.kind === 'settings'`: `actions.openSettings('@ext:<id>,<pack…> config file')`, the ids joined by `,` with no
   spaces (6.4 step 2; the help commands' filter with ` config file` appended). Return.
4. `picked.kind === 'help'`: `actions.openHelp()`. Return.
5. `picked.kind === 'file'`: the path to open is:
   - role `user` or `system`: the label as it is (already absolute);
   - role `configured`: the label with a leading `~/` (or `~\` on Windows) replaced by `<homeFolder>/`, and a relative
     value resolved against `homeFolder` (section 6, Q1). `path.resolve(homeFolder, value)` does both after the `~`
     step.
6. `exists = await files.exists(path)`. Then `plan = planCreation({file: path, role, exists, missingFolders: exists ? []
   : await files.missingFolders(path)})`, where `role` is the row's role (`'system'` takes the configured modes, section
   2.3).
7. Run `plan.steps` in order: a `folder` step is `files.makeFolder(path, mode)`, a `file` step `files.createFile(path,
   mode)`. A rejection is not caught: the command's promise rejects, and the editor shows its "Command '…' resulted in
   an error" dialog with the system error (F-2203 7.E1, 7.E5, AC-21, AC-30).
8. `await editor.open(path)`.
9. `plan.insertTemplate`: `await editor.insertTemplate(path, starterTemplate({insertSpaces: true, tabSize: 4}))`. The
   editor's snippet insertion normalises the indentation to the user's settings ([oss]
   `src/vs/editor/contrib/snippet/browser/snippetSession.ts`, `adjustWhitespace` → `normalizeIndentation`), so a
   four-space indent becomes two tabs at `tabSize` 2 without spaces and stays four spaces with spaces (BR-6, AC-25).

It writes no setting and no state (BR-8).

### 2.2 `config-file-editor.ts` (the adapters; `vscode` as a type, the editor passed in)

```ts
export function configFileEditorOf(editor: Pick<typeof vscode, 'window' | 'workspace' | 'Uri' | 'SnippetString' | 'Position'>, translate: Translate): ConfigFileEditor;
export const nodeConfigFiles: ConfigFiles;
```

- `pickFile`: a quick pick (`createQuickPick`) with `placeholder` the translated `choice.placeholder`, no title,
  `ignoreFocusOut: true` (AC-28), single selection, items from `choice.items` in order: a file row's label is its path,
  a fixed row's label and description are its ids translated (`textOfId`). The first item is active. It resolves the
  chosen `FileChoiceItem`, or `undefined` on hide without accept. Disposed after. The fixed rows stay listed whatever is
  typed (5.0 step 2, AC-29): give them `alwaysShow: true`.
- `open(file)`: `editor.window.showTextDocument(editor.Uri.file(file), {preview: true})`. An open document is revealed
  by the editor itself (BR-7, AC-4).
- `insertTemplate(file, template)`: the visible text editor whose document's `uri.fsPath` is `file` gets
  `insertSnippet(snippetOf(template), new editor.Position(0, 0))`. `snippetOf` builds the `SnippetString` from
  `template.text` with the tab stops as `${1:alias}`, `${2:hostname}`, `${3:user}` and the final `$0` (the four
  `tabStops` in order; `SnippetString`'s own escaping for the rest of the text).
- `nodeConfigFiles`: over `node:fs/promises`. `exists` is `stat` succeeding; `missingFolders` walks up from
  `path.dirname(file)` while a folder does not exist and returns the missing ones, outermost first; `makeFolder` is
  `mkdir(path, {mode})` then `chmod(path, mode)` (the umask must not change the mode, F-2203 6.1 step 3); `createFile`
  is `open(path, 'wx', mode)`, `close`, then `chmod(path, mode)`.

### 2.3 `new-file.ts`

`NewFileInput.role` becomes `'user' | 'configured' | 'system'`. The `system` role takes the configured modes (0755 for
folders, 0644 for the file): F-2203 Q2 option (a), section 6. Nothing else changes.

### 2.4 Strings

| Id | Text (F-2203 §3.4) |
|---|---|
| S047 | `Edit custom SSH configuration file` |
| S077 | `Help` |
| S126 | `Select SSH configuration file to update` |
| S131 | `Settings` |
| S162 | `about SSH configuration files` |
| S166 | `specify a custom configuration file` |

In id order in `FailureStringId` and `FAILURE_TEMPLATES`, and as keys of every bundle.

### 2.5 Registration

`activation.ts` serves `openConfigFile` with the help commands (the command needs no proposal, F-2203 3.1:
"Always"). `ActivationInputs` gains `openConfigFile: CommandHandler`, built by `extension.ts`:
`openConfigFileHandler(configFileEditorOf(vscode, translate), nodeConfigFiles, {openSettings: help.openSettings,
openHelp: () => help.openExternal(CONFIG_HELP_ADDRESS)}, places, () => textOf(host, 'configFile'), extension)`, where
`places` is `{homeFolder: homedir(), userFile: path.join(homedir(), '.ssh', 'config'), systemFile:
'/etc/ssh/ssh_config'}`, and `CONFIG_HELP_ADDRESS` is the page of section 2.6, a named constant in `extension.ts`.
`table.commands` gains `openConfigFile`; the served list gains it, so six registered commands become seven.

### 2.6 `docs/remote-ssh/ssh-config.md`

Our page, linked from `docs/remote-ssh/README.md`'s settings section. It says, in our own words: which files the
extension reads (`~/.ssh/config`, `/etc/ssh/ssh_config`, or only `remote.SSH.configFile`), how to open one ("Remote-SSH:
Open SSH Configuration File..."), the starter entry's three keywords (`Host`, `HostName`, `User`), and a link to
OpenSSH's `ssh_config(5)` manual. The Help row opens
`https://github.com/remote-oss/remote/blob/main/docs/remote-ssh/ssh-config.md` (R-31: our page, no Microsoft URL).

## 3. Test table

One assertion per `it`; the cite starts the name.

### 3.1 `open-config-file.test.ts` (fakes for all four ports; the fake files hold a set of paths and record each step)

| Cite | Given | Expected |
|---|---|---|
| F-2203 AC-2 | `configFile` empty | `pickFile` got the four rows of `buildFileChoice` with `S126` |
| F-2203 AC-11 | `configFile` `/x/my_config` | `pickFile` got its three rows with `S047` |
| F-2203 BR-1 | `configFile` changes between two runs | the second run's rows show the new value |
| F-2203 AC-16 | the pick is dismissed | nothing created, nothing opened, no action |
| F-2203 AC-3 | the user file exists | opened; no step run; no template |
| F-2203 AC-5 | user file and `~/.ssh` missing | steps: folder `<home>/.ssh` 0o700, file `<home>/.ssh/config` 0o600, in that order; then opened |
| F-2203 AC-31 | `~/.ssh` exists, the file missing | one step: the file 0o600 |
| F-2203 AC-6 | a created file | `insertTemplate` got `starterTemplate({insertSpaces: true, tabSize: 4})`, after `open` |
| F-2203 AC-9 | the file exists and is empty | no template |
| F-2203 AC-10 | the system file exists | opened, nothing created |
| F-2203 Q2 | the system file missing in an existing folder | one step: the file 0o644; template inserted |
| F-2203 AC-12 | `configFile` `/x/a/b/my_config`, `/x` exists | folders `/x/a` then `/x/a/b` 0o755, the file 0o644, then opened with the template |
| F-2203 AC-13 | `configFile` `~/cfg/my_config` | the path opened is `<home>/cfg/my_config`; no folder named `~` |
| F-2203 Q1, AC-23 | `configFile` `relcfg/rel_config` | the path created and opened is `<home>/relcfg/rel_config`, one and the same |
| F-2203 AC-21, AC-30 | `createFile` rejects with `EACCES` | `execute` rejects with that error; nothing opened |
| F-2203 AC-14 | the Settings row | `openSettings('@ext:remote-oss.remote-ssh,remote-oss.remote-ssh-edit,remote-oss.remote-explorer config file')`; nothing created |
| F-2203 AC-15 | the Help row | `openHelp` called once; nothing created |
| F-2203 BR-8 | any run | no setting or state written (the fakes have no such member; the row asserts the recorded calls of one full run) |

### 3.2 `config-file-editor.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2203 AC-2 | `pickFile` of the default choice over a fake editor | placeholder translated; labels in order (two paths, `Settings`, `Help`); the two fixed rows have their descriptions and `alwaysShow` true; no title |
| F-2203 AC-28 | the same | `ignoreFocusOut` true |
| F-2203 5.0 step 3 | the user accepts the second row | resolves that `FileChoiceItem` |
| F-2203 6.6 | hidden without accept | resolves `undefined`, and the pick was disposed |
| F-2203 BR-7 | `open('/h/.ssh/config')` | `showTextDocument` got the file URI with `preview: true` |
| F-2203 BR-6 | `insertTemplate` | `insertSnippet` got `# Read more about SSH config files: https://linux.die.net/man/5/ssh_config\nHost ${1:alias}\n    HostName ${2:hostname}\n    User ${3:user}$0` at (0, 0) |
| F-2203 AC-5 | `nodeConfigFiles` over a temporary folder: `makeFolder(…, 0o700)` and `createFile(…, 0o600)` under umask 0o022 | the modes on disk are 0o700 and 0o600 |
| F-2203 AC-31 | `missingFolders` of a file whose parent exists | `[]` |
| F-2203 AC-12 | `missingFolders` of `<tmp>/a/b/f` with only `<tmp>` existing | `[<tmp>/a, <tmp>/a/b]` |
| F-2203 AC-21 | `createFile` where the parent is a regular file | rejects with `ENOTDIR` |
| F-2203 AC-9 | `createFile` on an existing file | rejects (`wx`), and the file is unchanged |

### 3.3 Other files

| File | Row |
|---|---|
| `new-file.test.ts` | F-2203 Q2: a missing `system` file plans its folders 0o755 and the file 0o644, and inserts the template |
| `failure-strings.test.ts` | the key list gains the six ids in order |
| `strings.test.ts` | the default bundle gains the six texts |
| `activation.test.ts` | the existing "registers six" rows become seven, with `opensshremotes.openConfigFile` |
| `skeleton.test.ts` | unchanged (the command is in the manifest already) |

### 3.4 Acceptance (`tests/acceptance/suite/remote-ssh.test.ts`)

| Cite | Expected |
|---|---|
| F-2203 AC-1, #397 | after activation, `vscode.commands.getCommands(true)` includes `opensshremotes.openConfigFile` |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet. `config-file-editor.ts` is tested over a fake editor and a
real temporary folder (not excluded from coverage).

## 5. Gates and review

PR title `remote-ssh: Open SSH Configuration File (card remote-ssh-19, F-2203, #397)`.

## 6. Open rows

- **F-2203 Q1 (a relative `remote.SSH.configFile`):** this card resolves it against the home folder for both steps,
  as proposed on `remote-oss/remote-ssh#30`. If metis rules (a), reject with a message: the row changes and a string is
  added. If (c), reproduce the reference: that is not allowed under AC-23. Any change comes as an amendment.
- **F-2203 Q2 (a missing system file in a writable folder):** this card creates it with the configured modes and the
  template, option (a) as §17 recommends and as proposed on #30. If metis rules (b), the `system` role plans no steps
  and opens an untitled editor instead: an amendment.
- **macOS and Windows (Q3, Q4):** the rows assume Linux paths and modes. Windows waits on D-60.
