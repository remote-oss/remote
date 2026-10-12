# Task card remote-ssh-20: Open SSH Configuration File, themis's three follow-ups (#408)

Why: #408, themis's three non-blocking findings on #407 (card remote-ssh-19, merged as 52e7fc6). Reviewing coder:
`remote-coding-worker-1`.

1. **`~` handling.** `open-config-file.ts`'s `pathOf` expands a leading `~/` or `~\` with its own pattern. A lone `~`
   becomes `<home>/~`, and on Linux `~\cfg\c` becomes `<home>/cfg\c` (the pattern accepts a backslash, but
   `path.join` does not split it). lib-ssh already has the rule the connection and the host list use, `expandHome`
   (a lone `~` is home; `~/` everywhere; `~\` only on Windows). The command uses it too, so all three read a `~` value
   the same way. **F-2203 Q1 does not change this:** Q1 is about a value that is still relative after the `~` step, and
   that part (`path.resolve(home, …)`) stays as it is until metis rules on `remote-oss/remote-ssh#30`.
2. **The template's editor.** `insertTemplate` looks for the editor by path in `visibleTextEditors`. If the editor
   that `showTextDocument` opened is not (yet) among them, the template is silently skipped. `open` gives back the
   editor it opened, and `insertTemplate` writes into that one.
3. **An unpinned plan input.** No row checks that `missingFolders` is not asked when the file exists.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/index.ts` | export `expandHome` (from `./arguments/invocation.ts`) |
| `packages/remote-ssh/src/config/open-config-file.ts` | `pathOf` uses `expandHome`; `ConfigFilePlaces.platform`; the editor port's `open` and `insertTemplate` (section 2) |
| `packages/remote-ssh/src/config/config-file-editor.ts` | `open` returns the editor; `insertTemplate` takes it (section 2.2) |
| `packages/remote-ssh/src/extension.ts` | `places` gains `platform: clientPlatformOf(process.platform)` (from `node-machine.ts`) |
| `packages/remote-ssh/test/unit/open-config-file.test.ts`, `config-file-editor.test.ts` | rows (section 3) |

Nothing else.

## 2. Contract

### 2.1 `open-config-file.ts`

- `ConfigFilePlaces` gains `platform: ClientPlatform` (from `lib-ssh`).
- `pathOf` for a `configured` row becomes `path.resolve(homeFolder, expandHome(label, homeFolder, platform))`. The
  `user` and `system` rows are unchanged. The hand-written `~` pattern goes.
- The port changes:

```ts
export interface ConfigFileEditor {
  pickFile(choice: FileChoice): PromiseLike<FileChoiceItem | undefined>;
  /** Opens the local file as a preview editor in the active group, or reveals it, and gives that editor. */
  open(file: string): PromiseLike<OpenedEditor>;
  /** Inserts `template` as a snippet at the start of `opened`; the editor adjusts its indentation. */
  insertTemplate(opened: OpenedEditor, template: Template): PromiseLike<void>;
}

/** The editor `open` opened; only the adapter reads it. */
export interface OpenedEditor {
  readonly file: string;
}
```

  The handler passes `open`'s result to `insertTemplate`.

### 2.2 `config-file-editor.ts`

- `open(file)` returns `{file, editor: shown}`, where `shown` is the `TextEditor` that `showTextDocument` resolved with.
  The adapter's own type extends `OpenedEditor` with that `editor` field.
- `insertTemplate(opened, template)` calls `insertSnippet` on `opened.editor` (the cast to the adapter's type is the
  only one, with a comment saying `open` made it). There is no search in `visibleTextEditors`, so nothing is skipped
  silently.

## 3. Test table

One assertion per `it`; the cite starts the name.

`open-config-file.test.ts` (the fake places get `platform: 'linux'` unless a row says otherwise):

| Cite | Given | Expected |
|---|---|---|
| #408 (1), F-2201 BR-4 | `configFile` `~` | the path opened is `<home>` |
| #408 (1) | `configFile` `~\cfg\c`, platform `linux` | the path is `<home>/~\cfg\c` (on Linux `~\` is not the home folder, as for `ssh -F`) |
| #408 (1) | `configFile` `~/cfg/c`, platform `linux` | the path is `<home>/cfg/c` (unchanged) |
| #408 (1) | `configFile` `rel/c` | the path is `<home>/rel/c` (unchanged; Q1 pending) |
| #408 (2) | a created file | `insertTemplate` got the very object `open` returned |
| #408 (3) | the file exists | `missingFolders` was not called |

`config-file-editor.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| #408 (2) | `open(f)` over a fake whose `showTextDocument` resolves an editor `E` | the result's `editor` is `E` |
| #408 (2) | `insertTemplate(opened, template)` where `opened.editor` is `E` and `visibleTextEditors` is empty | `E.insertSnippet` was called once (no visible editor is needed) |

Replace the two existing rows `F-2203 BR-6: the template is inserted as a snippet at the start of the editor of that
file` (keep its snippet assertion, now on `opened.editor`) and `F-2203 BR-6: no editor shows the file, so nothing is
inserted and nothing throws` (it describes the defect) with the two rows above. The fake's `visibleTextEditors`
setup then goes.

On Windows, a lone `~` and `~\cfg\c` follow `expandHome`'s Windows branch. lib-ssh's own rows cover that; this card adds
no Windows row (D-60).

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's and remote-ssh's 100/100/100 ratchets.

## 5. Gates and review

PR title `remote-ssh: Open SSH Configuration File, the three follow-ups (card remote-ssh-20, #408)`.

## 6. Open rows

None. F-2203 Q1 (a relative value) stays as card remote-ssh-19 built it until metis rules; the lib-ssh card that
resolves `-F`, the host list and this command in one place follows that ruling.
