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
1. the input "Enter SSH Connection Command";
2. the parse, with a problem shown as the spec says;
3. the file pick;
4. the write (create when missing, as `planCreation` says);
5. the notification the spec gives, with its button, which opens the host through connect-21's flow.

Follow the spec's strings by id, and ask on #142 for anything the spec leaves open.

## 3. Rows

- **Unit rows,** one per step and each error path, over fakes (a recording file port, a scripted input and pick, a
  recording opener), named by F-2204's ACs where an AC states the case.
- **Acceptance rows:** F-2204's ACs observable through the harness: the file's content after the command, and the
  notification and its button. They need tooling-24's `textInput` and `notice` surfaces; until tooling-24 merges, list
  them in the PR as open.

## 4. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `remote-ssh: Add New SSH Host..., registered (card
connect-22)`. athena, themis or triton.
