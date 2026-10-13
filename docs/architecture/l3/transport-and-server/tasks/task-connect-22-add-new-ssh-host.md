# Task card connect-22: Add New SSH Host..., registered (F-2204)

Issue: #531. Why: the user put the slice-3 commands without a handler into 0.2 (hermes, 2026-10-13, on #42 and
#299). `opensshremotes.addNewSshHost` (F-2204, `remote-oss/remote-ssh#31`, 40 ACs) is declared in the manifest, and
connect-21's picker hands over to it, but nothing registers it. Builder: hestia (after connect-21, same registration
file) or iris. Size: M. Depends on connect-21 (#529).

## 1. What exists

| Part | Where |
|---|---|
| parse the typed `ssh …` command into a host block, or a problem | lib-ssh `config/add-host.ts` `parseAddHostCommand` |
| write the block into a file's text | lib-ssh `config/writer.ts` `writeHostBlock` |
| the configuration-file pick (user, system, configured) | remote-ssh `config/file-choice.ts` `buildFileChoice`, `narrowFileChoice` |
| create a missing file, with its mode | remote-ssh `config/new-file.ts` `planCreation` |
| the `configFile` check | lib-ssh `configFilePath` (and ssh-37's rule) |

## 2. What this card builds

`src/config/add-host-command.ts`, a handler over ports, registered in `register-connect.ts` as connect-21's are. The
flow is F-2204 §5 and §6, step for step:
1. the input (5.0 step 2): title `Enter SSH Connection Command` (STR:S063), the spec's placeholder, an empty value,
   and no prompt of our own;
2. the parse, with a problem shown as the spec says;
3. the file pick;
4. the write (create when missing, as `planCreation` says);
5. the information notice (5.0 step 6), shown at once: `Host added!` (STR:S078) with two buttons, in this order:
   `Open Config` (STR:S099, primary) and `Connect` (STR:S025). Pressing either removes the notice; that is core's
   doing once the button resolves the promise. It goes through `NoticePort.showInformation`;
6. `Open Config` (step 7): the file just written opens in the **current** window as a preview editor
   (`vscode.window.showTextDocument(uri, {preview: true})` with no selection, so the cursor isn't moved);
7. `Connect` (step 8): a **new** window opens on `ssh-remote+<alias>`, where `<alias>` is the `Host` value just written,
   encoded as F-2301 encodes authorities, through connect-21's open-in-new-window path.

Follow the spec's strings by id, and ask on #142 for anything the spec leaves open.

**The text input's title.** tooling-24 (#552, merged) built `TextInputPort.showInputBox({prompt?, placeholder?})`, and
the scripted adapter matches `prompt ?? placeholder`. This input has a title and no prompt. This card adds `title?` to
the request; the editor adapter passes it to `showInputBox`. The scripted adapter matches and records
`title ?? prompt ?? placeholder` as the line's `question`. A unit row for each adapter covers it.

## 3. Rows

- **Unit rows,** one per step and each error path, over fakes (a recording file port, a scripted input and pick, a
  recording opener), named by F-2204's ACs where an AC states the case.
- **Acceptance rows:** the F-2204 ACs observable through the harness (tooling-24's `textInput` and `notice` surfaces,
  merged in #552):
  - the file's content after the command;
  - the `textInput` line's question `Enter SSH Connection Command`;
  - the `notice` line `Host added!` with `buttons` `["Open Config", "Connect"]`;
  - `Open Config` taken: the active editor in the current window is the written file, as a preview;
  - `Connect` taken: a new window on `ssh-remote+<alias>`. This needs tooling-20's windows suite (#544, merged); write
    the row there.

## 4. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `remote-ssh: Add New SSH Host..., registered (card
connect-22)`. athena, themis or triton.
