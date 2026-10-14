# Task card coverage-30: the Add New SSH Host and server maintenance rows

Issue: #713. Why: the 0.2 gate's acceptance rows. connect-22 (#531) built "Add New SSH Host..." and connect-23 built
"Kill VS Code Server on Host..." and "Uninstall VS Code Server from Host...", but no acceptance row runs them. These
rows run them in the windows suite:
- F-2201 (`remote-oss/remote-ssh#28`): writing into the custom file, an unparsable file, and a host only the custom
  file defines;
- F-2102 (`#20`): the Kill Local picker's Add New row;
- F-2305 (`#38`): Kill VS Code Server on an unknown host key.

Builder: iris or hestia. Size: M, about 1.5 agent-days. **Depends on coverage-14 (#568)** for `userSettings` and
`connectionHelpers`. If coverage-14 hasn't merged, add them to `windows/harness.ts` as coverage-14 §1 says, and tell
iris on #568.

## 1. The file and its rules

A new file `tests/acceptance/windows/maintenance.test.ts`, in the `windows` launch. It uses the `local` window and its
own window `mt1`.

**Before the file:**
- close every window of the earlier files that is still open;
- wait until no connection helper of the run runs (`connectionHelpers()` is empty, bounded at 60 s);
- keep the bytes of `<run>/ssh_config` (`variable('HARNESS_SSH_CONFIG')`) and of the user settings.

**After the file:** write both files back byte for byte, whatever failed. Then open `mt1` on `harness`, wait until it's
connected, and close it. The Kill and Uninstall rows end the harness account's server, so this puts a server back on
the host for the files after this one.

**Terms:**
- `P` is the `Port` of the `Host harness` block of `<run>/ssh_config`;
- "the AC-19 error" is one of two outcomes, and the row passes on either:
  - the command failed (`inWindow` rejects, naming the command), and its message holds the reader's text for the
    file's problem;
  - a `notice` line of `local` whose question holds `An error occurred while parsing the local SSH configuration file`
    (STR:S010).

  Take the reader's text from lib-ssh's public reader, run in the test over the same file text, so it isn't copied.
  Record in the PR which of the two outcomes the build shows (F-2201 Q1);
- "no host pick" means no `hostPick` line of `local` since the step began.
- a log line is compared as the log writes it: through `redact(line, [])` from lib-log, as `client.test.ts`'s
  `logged` does, since the run folder's name can hold a run of characters the log redacts (coverage-11, #696).

**The agent's state** gains `activeTab`: `{uri: string; preview: boolean}` for
`vscode.window.tabGroups.activeTabGroup.activeTab`, when its `input` is a `vscode.TabInputText` (`uri` is
`input.uri.toString()`, `preview` is `isPreview`), and `null` otherwise. `AgentEvent` and `windowState` carry it.

**Every answer is a script entry** for the window that asks (`window: 'local'` or `'mt1'`), appended before the step
(`appendScript`). A notice is answered `dismiss` unless the row says otherwise.

## 2. The rows

Each row's name starts with its cite.

| Cite | Setup and steps | Assertions |
|---|---|---|
| F-2201 AC-15 | In `local`, run `opensshremotes.addNewSshHost`. Script: `textInput` `Enter SSH Connection Command` → `{text: 'ssh harness@added-one'}`; `filePick` → `{label: <run>/ssh_config}` (the configured file's row is its path as written); `notice` `Host added!` → `{button: 'Open Config'}` | `<run>/ssh_config` is exactly `Host added-one\n  HostName added-one\n  User harness\n\n` followed by the bytes it had before. The `notice` line's question is `Host added!`, and its `buttons` are `["Open Config", "Connect"]` |
| F-2201 AC-16, AC-39 | the same step, after the notice | `windowState('local').activeTab` is `{uri: <file URI of <run>/ssh_config>, preview: true}`. Then close the editor (`workbench.action.closeActiveEditor` in `local`) and write `<run>/ssh_config` back |
| F-2201 AC-19 | Write `<run>/broken_config`: `Host "unterminated` then `  HostName 127.0.0.1`. `userSettings({'remote.SSH.configFile': <run>/broken_config})`. In `local`, run each of `opensshremotes.openEmptyWindow`, `opensshremotes.openEmptyWindowInCurrentWindow`, `opensshremotes.cleanRemoteServer`, `opensshremotes.cleanDevBox` and `opensshremotes.cleanLocalServer`, with a `hostPick` → `dismiss` entry ready for each | for each command: no host pick, and the AC-19 error |
| F-2201 AC-20 | the same setting. In `local`, run `opensshremotes.addNewSshHost`. Script: `textInput` → `{text: 'ssh harness@added-two'}`; `filePick` → `{label: <run>/broken_config}` | a `filePick` line of `local`; the AC-19 error; `<run>/broken_config` unchanged byte for byte; no `notice` line `Host added!`. Then put `remote.SSH.configFile` back |
| F-2201 AC-33 | In `local`, run `opensshremotes.cleanRemoteServer`. Script: `hostPick` → `{label: 'harness'}`; `notice` `Killed VS Code Server on harness.` → `dismiss` | the `notice` line's question is `Killed VS Code Server on harness.` and its `buttons` are `["Open Logs"]`. `connectionLog()` since the step holds `configFileLine(<run>/ssh_config)` (the builder from `log-content.ts`). `harness` is a host only the run's file defines |
| F-2201 AC-33 (Uninstall) | In `local`, run `opensshremotes.cleanDevBox`. Script: `hostPick` → `{label: 'harness'}` | the command resolves. `connectionLog()` since the step holds `configFileLine(<run>/ssh_config)`. `onHost('ls', '/home/harness/.vscodium-server-insiders/bin')` lists no server folder (or the folder is gone) |
| F-2102 AC-18 | Open `mt1` on `harness`, wait until it's connected, and note `connectionHelpers()`. In `mt1`, run `opensshremotes.cleanLocalServer`. Script for `mt1`: `hostPick` → `{label: '$(plus) Add New SSH Host...'}` (the label as coverage-14 row 2's `items` show it); `textInput` → `dismiss` | a `textInput` line of `mt1` whose question is `Enter SSH Connection Command`; the helpers are the same processes as before; `mt1` is still connected. Close `mt1` |
| F-2305 AC-32 | Append a block to `<run>/ssh_config`: `Host kill-ask`, `HostName 127.0.0.1`, `Port <P>`, `User harness`, `IdentityFile <run>/id_ed25519`, `IdentitiesOnly yes`, `IdentityAgent none`, `StrictHostKeyChecking ask`, `UserKnownHostsFile <run>/known_hosts_kill_ask`. No `BatchMode`: it would turn the question off. Delete `<run>/known_hosts_kill_ask`. In `local`, run `opensshremotes.cleanRemoteServer`. Script: `hostPick` → `{label: 'kill-ask'}`; `pick` `fingerprint` → `no` (Cancel); `notice` → `dismiss` | a `pick` line of `local` with the fingerprint question; a `notice` line `Failed to kill VS Code Server on kill-ask.` with `buttons` `["Open Logs"]`; `<run>/known_hosts_kill_ask` is missing or empty |
| F-2305 AC-36 | The same block, the known file deleted. The same command. Script: `hostPick` → `{label: 'kill-ask'}`; `pick` `fingerprint` → `yes` (Continue); `notice` → `dismiss` | `<run>/known_hosts_kill_ask` has exactly one line, whose key type and key (its last two fields) are those of `onHost('cat', '/etc/ssh/ssh_host_ed25519_key.pub')`. A `notice` line `Killed VS Code Server on kill-ask.` follows: the command went on to its own result |

**Order:** the rows run in the table's order. The two AC-33 rows and the F-2305 rows end the harness account's server.
`mt1` (F-2102 AC-18) opens on a fresh server, which is why the file's last step reconnects once.

**Measure first** and write what you saw into the PR:
- the reader's text for `Host "unterminated`;
- which AC-19 outcome the build gives;
- the label of the configured file's row in the `filePick` line's `items`;
- that the client's question is the pick, not the masked input (the run's OpenSSH, as coverage-21 §1 notes).

## 3. The catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, these go from `todo` to `acceptance`:
- F-2201 AC-15, 16, 19, 20, 33 and 39;
- F-2305 AC-32 and 36.

**F-2102 AC-18** goes to `acceptance` too: its Configure half is coverage-14's row 12. If coverage-14 hasn't merged,
leave AC-18 `todo` and say on #568 that its Add New half is here.

**Core halves** (list them in #142):
- the notice's primary button (AC-15);
- the preview editor's look (AC-39);
- core's "Command '<title>' resulted in an error" frame (AC-19, when that's the outcome).

**Halves that rest on unit rows** (name them in the PR):
- the `info` level of AC-32's notice: `maintenance-commands.test.ts`'s rows on `showInformation`;
- the masked-input route of AC-36, which the run's client never takes.

## 4. Done when

The repository's gates pass, and `pnpm test:acceptance:vscodium` passes with the new file. Paste the `windows`
summary. If a row fails because the extension does something else, don't change the row: report it on #713.

## 5. Review

PR title `tests: the Add New SSH Host and server maintenance rows (card coverage-30, #713)`. themis or triton reviews;
athena gives the tag check.

## 6. Open rows (stop and report on #713)

1. Add New SSH Host writes anything other than the block at the top followed by one blank line. Paste the file's diff.
2. The Kill or Uninstall log doesn't name the configuration file in use. Report the log's lines for the step.
3. The client asks the host-key question as a masked input. AC-36's pick row can't run then; report `ssh -V`.
