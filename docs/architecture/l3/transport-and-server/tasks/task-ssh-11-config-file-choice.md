# Task card ssh-11: the SSH configuration file picker (rows, placeholder, typed-text filter) (pure)

> Amended 2026-10-10 (#249): the model carries string IDS (`StringRef`, as card remote-ssh-02's picker model does), never
> English text — the ids are F-2203 §3's: S126/S047 placeholders, S131/S166 the Settings row, S077/S162 the Help row;
> the surface resolves them from the package's string table. `narrowFileChoice` matches the file rows' paths and the
> fixed rows by their ids' resolved text is NOT its job: it filters file rows by substring and always keeps the two fixed
> rows (the editor's own filter does the rest). Rows that quoted English now quote the ids.

Brief: slice 3 (#42). Specs: F-2203 (`remote-oss/remote-ssh#30`, "Open SSH Configuration File..."), F-2204 (`#31`, the
same picker for "Add New SSH Host..."). Reviewing coder: `remote-coding-worker-1`. Depends on nothing;
`packages/remote-ssh/src/config/` does not exist on main.

## 1. Package and file boundary

`packages/remote-ssh/src/config/file-choice.ts`, test `packages/remote-ssh/test/unit/file-choice.test.ts`. Neither exists on main.
Pure: no `vscode`, no file system. The module does not touch `host-picker.ts` or `src/report/`. Nothing else changes.

## 2. Contract

```ts
export interface FileChoiceInput {
  configFile: string;     // remote.SSH.configFile as written; '' or whitespace only means unset
  userFile: string;       // the absolute user file, e.g. /home/u/.ssh/config
  systemFile: string;     // e.g. /etc/ssh/ssh_config
}
import type {StringRef} from '../connect/picker-model.ts';   // {id, values}; the surface resolves ids (R-29: no English in models)
export type FileChoiceItem =
  | { kind: 'file'; label: string; role: 'user' | 'system' | 'configured' }                     // the path as written
  | { kind: 'settings'; label: StringRef; description: StringRef }   // label {id:'S131'}, description {id:'S166'}
  | { kind: 'help'; label: StringRef; description: StringRef };      // label {id:'S077'}, description {id:'S162'}
export interface FileChoice {
  placeholder: StringRef;    // {id:'S126'} when remote.SSH.configFile is unset, {id:'S047'} when set (F-2203 §3)
  items: readonly FileChoiceItem[];
}
export function buildFileChoice(input: FileChoiceInput): FileChoice;
export function narrowFileChoice(items: readonly FileChoiceItem[], typed: string): readonly FileChoiceItem[];
// the first element is the focused row
```

`buildFileChoice`: configFile unset: placeholder `Select SSH configuration file to update`, items user file, system
file, settings, help. Set: placeholder `Edit custom SSH configuration file`, items the value exactly as written
(role `configured`, no trimming, no `~` expansion), settings, help.

`narrowFileChoice`: `typed` empty: the items unchanged. Otherwise a row matches when its label contains `typed`,
ignoring case. Result: the matching rows in their original order, then the non-matching `settings` and `help` rows in
their original order; non-matching file rows are dropped.

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-2203.AC-2 | configFile `''`, user `/home/u/.ssh/config`, system `/etc/ssh/ssh_config` | placeholder `Select SSH configuration file to update`; items in order: user file, system file, settings, help |
| F-2203.BR-1 | configFile `'   '` | same as unset |
| F-2203.BR-2 | the user row | label is `userFile` exactly (absolute) |
| F-2203.BR-3 | any input | the last two items are `settings` then `help`, with the descriptions of the contract |
| F-2203.AC-11 | configFile `~/ssh/mine` | placeholder `Edit custom SSH configuration file`; items `~/ssh/mine` (role `configured`), settings, help |
| F-2203.AC-11 | configFile `relative/cfg` | the label `relative/cfg` (not normalised); no user or system row |
| F-2204.AC-32 | configFile `/etc/x/config` | same placeholder and rows as the previous custom rows (the add flow uses this function too) |
| F-2203.AC-2 | default items, typed `''` | the four items unchanged |
| F-2203.AC-29 | default items, typed `zzz` | `settings`, `help` |
| F-2203.AC-29 | default items, typed `ssh_config` | system file, `settings`, `help` |
| F-2203.AC-29 | default items, typed `/etc` | system file, `settings`, `help` |
| F-2203.AC-29 | default items, typed `elp` | `help`, `settings` |
| F-2203.AC-29 | default items, typed `SSH_CONFIG` | system file, `settings`, `help` (case ignored) |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: configuration file picker model (card ssh-11)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. Matching is VS Code core's (F-2203 5.0 step 2): the card states a case-insensitive substring of the label. Typed text
   that core would match by gaps (`sshcfg`) is not tested.
2. The descriptions of the `settings` and `help` rows in the custom-file picker are read from F-2203 6.3 step 1
   ("steps 1-2 of 5.0"): the same as in the default picker. Confirm.
