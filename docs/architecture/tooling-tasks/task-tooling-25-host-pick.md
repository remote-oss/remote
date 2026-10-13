# Task card tooling-25: the harness answers the host pick and the configuration-file pick

Issue: #566. Why: the connect commands of connect-21 (#540) ask through a host pick:
- `opensshremotes.openEmptyWindow` and its two siblings;
- `opensshremotes.cleanLocalServer`, which takes no argument and always asks.

The pick is a real quick pick (`connect/connect-editor.ts`, `pickHost`), which the scripted adapters can't answer.
Without a scripted answer, no acceptance row can drive Kill (F-2102 AC-4–7, 14–18, 29, 31, 33) or Connect to Host...
(F-2301, batch 3). The configuration-file pick of `config/config-file-editor.ts` (`pickFile`, behind Open SSH
Configuration File..., Configure SSH Hosts... and Add New SSH Host...) is a real quick pick too, so F-2102 AC-18, F-2203
and F-2204 can't be driven either. Builder: hestia or iris (hermes assigns). Size: S. **Depends on connect-21 (#540).**

## 1. The surface

**`hostPick`:** `ScriptEntry {surface: 'hostPick'; match: string; answer: {label: string} | {typed: string} |
'dismiss'}`, matched on the pick's placeholder (`Select configured SSH host or enter user@host`, the model's own
`placeholder`, filled). An entry may name a `window`, as tooling-20 allows.

- **`{label}`:** the row of the initial model whose shown label is `label`; a fixed row (`Add New SSH Host...`,
  `Configure SSH Hosts...`) is matched by its translated text. No such row fails closed.
- **`{typed}`:** the `typed` row (`➤ <text>`) of `modelOf(typed)`. F-2301 6.1 step 2 says the row focused after typing
  is the first one after core's filter and match sort. `modelOf` is unfiltered and lists the hosts first, so its first
  row can be a host such as `harness` for `harness@127.0.0.1`. The script doesn't model core's filter: a `{typed}`
  answer always takes the typed row, and fails closed when there's none (athena on #567).
- **`'dismiss'`:** nothing, as Escape gives.

**The record line:** `question` is the placeholder; `answer` is the label taken, the typed text, or `dismiss`; `items`
is the initial model's shown labels, in order. A test reads the hosts and the two fixed rows from `items`.

**`filePick`:** `ScriptEntry {surface: 'filePick'; match: string; answer: {label: string} | 'dismiss'}`, matched on
the placeholder (`Select SSH configuration file to update`, or `Edit custom SSH configuration file` when one is
configured). The run always sets `remote.SSH.configFile` to its `ssh_config`, so in the run the pick is always the
custom-file one: S047 `Edit custom SSH configuration file`, with the rows [the configured file, `Settings`, `Help`].
`{label}` takes the row with that shown label: a file's path, `Settings` or `Help`. The record line is like
`hostPick`'s: placeholder, answer and `items`. `config-file-editor.ts`'s `pickFile` goes through a `FilePickPort` with
an editor adapter (today's `pickOne` call, moved) and a scripted one.

## 2. Files

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/host-pick.ts` (new) | `HostPickPort { pick(initial: PickerModel, modelOf: (typedText: string) => PickerModel): Promise<PickerItem \| undefined> }`, with no logic of its own |
| `packages/remote-ssh/src/connect/connect-editor.ts` | `pickHost` becomes the editor adapter of `HostPickPort` (unchanged behaviour). `labelOf` is exported for the scripted adapter. `connectCommandEditorOf` takes a `HostPickPort` instead of building the pick |
| `packages/remote-ssh/src/surfaces/editor-adapters.ts`, `scripted-adapters.ts` | the `hostPick` adapter of each kind; `EditorAdapters` gains `hostPick` |
| `packages/remote-ssh/src/extension.ts` / `register-connect.ts` | pass `adapters.hostPick` to `connectCommandEditorOf` |
| `packages/remote-ssh/src/config/config-file-editor.ts`, `surfaces/editor-adapters.ts`, `scripted-adapters.ts`, `extension.ts` | `FilePickPort` and its two adapters; `configFileEditorOf` takes the port |
| `tests/acceptance/suite-local/script.ts`, `tests/acceptance/windows/harness.ts` | the `hostPick` and `filePick` entries and the `items` field mirrored |
| `tests/acceptance/README.md` | the surface, in the record's list |

## 3. Rows

Unit rows in `scripted-adapters.test.ts` and `connect-editor.test.ts`:
- a `{label}` answer gives the host row;
- a `{label}` answer gives a fixed row by its translated text;
- a `{typed}` answer gives `modelOf(typed)`'s `typed` row even when a host row comes first (`harness@127.0.0.1` with
  `harness` listed);
- a `{typed}` answer whose model has no typed row fails closed;
- `dismiss` gives nothing;
- an unknown label fails closed and records `matched: false`;
- the record line carries `items`;
- the editor adapter keeps today's rows, moved;
- `filePick` answered by a path, by `Settings`, and by `dismiss`, with the record line's `items`.

Two capability rows in `tests/acceptance/windows/two-windows.test.ts`:

| Name | Expected |
|---|---|
| `D-85: the configuration-file pick of Open SSH Configuration File... is answered from the script` | with the entry `{surface: 'filePick', match: 'Edit custom SSH configuration file', answer: 'dismiss', window: 'c'}`, `inWindow('c', 'opensshremotes.openConfigFile')` resolves; the record has one `filePick` line of window `c` whose `items` include the run's `<run>/ssh_config` path, `Settings` and `Help` |
| `D-85: the host pick of Kill Local Connection Server is answered from the script` | with the entry `{surface: 'hostPick', match: 'Select configured SSH host', answer: 'dismiss', window: 'c'}`, `inWindow('c', 'opensshremotes.cleanLocalServer')` resolves; the record has one `hostPick` line of window `c` whose `items` include `harness`, `Add New SSH Host...` and `Configure SSH Hosts...` |

remote-ssh stays at 100/100/100.

## 4. Review

PR title `tests: the harness answers the host pick and the configuration-file pick (card tooling-25)`. themis or triton reviews; athena checks the port.
