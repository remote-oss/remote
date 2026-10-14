# Task card coverage-38: F-2204's Add New SSH Host acceptance rows

Issue: #726. Release 0.2, gating (D-86 puts F-2204, `remote-oss/remote-ssh#31`, into 0.2). #722 seeds F-2204 and lists
19 criteria under "Needs an acceptance row", plus the feature's wiring row. This card writes them. Builder: task:claude.
Size: M (about 2 agent-days). **Depends on:**
- #722 merged;
- coverage-14's harness helpers `waitFor` and `userSettings` (#568 §1). If that build hasn't merged, add them as #568
  §1 says, in `windows/harness.ts`, and coverage-14's builder reuses them.

## 1. The launch: a client home of its own

The add flow writes `~/.ssh/config` of the user who runs the editor. A run must never touch the runner's own home, so
these rows run in a new plain launch whose editor has a home folder of its own:

| File | Change |
|---|---|
| `tools/acceptance-launches.ts` | `PlainLaunch` gains `clientHome?: true`. `launchesOf` gains `add-host` after `explorer-no-proposals`: `kind: 'plain'`, `clientHome: true`, `settings: {'remote.SSH.configFile': ''}`, suite folder `add-host`. `CONFIG_FILE_LAUNCHES` becomes `['add-host']` |
| `tools/acceptance-plain.ts` | for a launch with `clientHome`, the run creates an empty `<run>/<label>-home` (mode 0755) before the editor starts and sets `HOME` to it in the launch's environment |
| `tests/acceptance/add-host/add-host.test.ts` | new: the rows of §2 |
| `tests/acceptance/add-host/tsconfig.json`, `tests/acceptance/tsconfig.json`, `knip.jsonc` | the suite folder, as the README's "To add a launch" says |
| `tests/acceptance/windows/harness.ts` | `WindowScriptEntry`'s `surface` also takes `textInput` (`answer: {text} \| 'dismiss'`) and `notice` (`answer: {button} \| 'dismiss'`), as the extension's `ScriptEntry` has them |
| `tests/acceptance/README.md` | the `add-host` launch in the list of labels, and one sentence on `clientHome` |
| `tools/acceptance-launches.test.ts`, `tools/acceptance-plain.test.ts` | tools rows: only `add-host` has `clientHome` and sets `remote.SSH.configFile`; its editor's environment has `HOME=<run>/add-host-home`, and the folder exists before the start |

**Measure first:**
- The extension host reads `HOME` (`os.homedir()`). Write the `HOME` that `acceptance.agent.state` reports, or a log
  line, into the PR. If the editor doesn't start, or `os.homedir()` isn't the launch's folder, stop and report (§6).
- What the `textInput` record line holds as its question (the scripted adapter takes the request's `title`).

## 2. The rows

They're in `add-host.test.ts`, in this order, and every row starts from the `local` window. `home` is
`<run>/add-host-home`, and `userFile` is `${home}/.ssh/config`.

**Script entries:** each row appends its own entries (`appendScript`) before it runs the command, naming
`window: 'local'` unless the row says otherwise. The run's command is `inWindow('local', 'opensshremotes.addNewSshHost')`.

**What "no line" means:** the record has no line of any surface between the row's start and its end.

| # | Script and steps | Assertions | AC |
|---|---|---|---|
| 1 | `textInput` → `dismiss`; run | one `textInput` line, with the question `Enter SSH Connection Command` and no other line; `home/.ssh` doesn't exist | AC-2 (title), AC-3 |
| 2 | `textInput` → `{text: '   '}`; run | one `textInput` line and no other; `home/.ssh` doesn't exist | AC-4 |
| 3 | `textInput` → `{text: 'host1'}`, `filePick` → `{label: userFile}`, `notice` → `dismiss`; run | the `filePick` line: question `Select SSH configuration file to update`, `items` `[userFile, '/etc/ssh/ssh_config', <the Settings row's label>, <the Help row's label>]` (measure the two labels from the record and write them into the PR); `userFile` is exactly `Host host1\n  HostName host1\n`; `home/.ssh` is mode 0700 and `userFile` is 0600; the `notice` line is `Host added!` with `buttons` `['Open Config', 'Connect']` | AC-5, AC-6, AC-7, F-2204 wiring |
| 4 | `textInput` → `{text: 'ssh -p 2222 bob@alpha'}`, `filePick` → `{label: userFile}`, `notice` → `{button: 'Open Config'}`; run | `userFile` starts with `Host alpha\n  HostName alpha\n  Port 2222\n  User bob\n\nHost host1`; after the run, the window's active editor is `userFile` (`acceptance.agent.state` reports the active editor; if it doesn't, add `activeEditor` to the agent's `state` report and say so in the PR) | AC-8 |
| 5 | `textInput` → `{text: 'gamma'}`, `filePick` → `{label: userFile}`, `notice` → `{button: 'Connect'}`; run with `nextEmptyWindow` | exactly one new empty window, whose authority (`windowState`) is `ssh-remote+gamma`; the `local` window's state (folders, authority) is unchanged. The new window may fail to connect, because `gamma` isn't a real host: answer its `failureDialog` with `dismiss` (window: the new one) and close it | AC-9 |
| 6 | `chmod 0400 userFile`; `textInput` → `{text: 'delta'}`, `filePick` → `{label: userFile}`; run | `inWindow` fails with a message naming the permission failure (`EACCES`); `userFile` is byte for byte the text before the row; no `notice` line. Then `chmod 0600` | AC-26 |
| 7 | `filePick` → `{label: 'Settings'}` (the measured label), then a second run with `filePick` → `{label: 'Help'}`, then a third with `filePick` → `dismiss`; each with `textInput` → `{text: 'epsilon'}` | after each run `userFile` is unchanged and there's no `notice` line | AC-34 |
| 8 | `userSettings({'remote.SSH.configFile': '<run>/add-host-custom/a/b/config'})`; `textInput` → `{text: 'zeta'}`, `filePick` → `{label: <that path>}`, `notice` → `dismiss`; run | the `filePick` line's question is `Edit custom SSH configuration file` and its `items` are `[<that path>, <Settings>, <Help>]`; the folders `a` and `a/b` and the file exist, and the file is exactly `Host zeta\n  HostName zeta\n`. Then `userSettings` back to `''` | AC-32, AC-33 |
| 9 | `hostPick` → `{label: '$(plus) Add New SSH Host...'}` (the label the Connect pick records; measure it) after typing nothing, then `textInput` → `dismiss`; run `opensshremotes.openEmptyWindow` | the `hostPick` line's `items` list `Add New SSH Host...` after every host and before `Configure SSH Hosts...`; one `textInput` line follows; no second `hostPick` line; `userFile` unchanged | AC-27, AC-28 |
| 10 | — (no row) | the script answers a pick with a label, typed text or a dismissal, never typed text and then a fixed row, so AC-27's "empty even if text was typed" rests on the unit row `F-2204 AC-2` (the input's request has no value). Say so in the PR | AC-27 (empty input) |
| 11 | `hostPick` → `{label: <Add New>}`, `textInput` → `{text: 'eta'}`, `filePick` → `{label: userFile}`, `notice` → `{button: 'Connect'}`; run `opensshremotes.openEmptyWindowInCurrentWindow` with `nextEmptyWindow` | one new empty window on `ssh-remote+eta`; the `local` window is unchanged. Close the new window as in row 5 | AC-29 |
| 12 | open window `w1` on `harness`; `textInput` → `{text: 'theta'}`, `filePick` → `{label: userFile}` (window `w1`), `notice` → `dismiss`; run in `w1` | the `filePick` line of `w1` lists `userFile` (the client's); `userFile` holds `Host theta`; `onHost('ls', '-a', '/home/harness')` is unchanged from before the row | AC-31 |
| 13 | in `local`, open `userFile` in an editor and type a line without saving (`acceptance.agent.writeFile` doesn't save to it: add an agent command `acceptance.agent.typeInto(path, text)` that opens the file and inserts text with `editor.edit`, leaving it dirty, if none exists); `textInput` → `{text: 'iota'}`, `filePick` → `{label: userFile}`, `notice` → `dismiss`; run | the editor of `userFile` still holds the typed line (the agent's `state` reports the dirty documents' text, or add it), whether or not core asked; record what core showed in the PR | AC-35 |
| 14 | copy the bytes of `<run>/user-data/User/settings.json`; then rows 1, 3 (a success) and 6 (an error) again in short | `settings.json` is byte for byte the copy; the next `textInput` line's request had no value (as row 1) | AC-36 |
| 15 | `textInput` → `{text: 'kappa'}`, `filePick` held (a held entry that waits for `signal('second')`), then start a second run with `textInput` → `{text: 'lambda'}`, `filePick` → `{label: userFile}`, `notice` → `dismiss`; when the second run is done, `signal('second')` releases the first's pick with `dismiss` | `userFile` holds `Host lambda` and no `Host kappa`; the first run left no `notice` line | AC-40 |

Rows 9–11 need the run's `ssh_config` hosts in the Connect pick: the `add-host` launch has `remote.SSH.configFile` `''`,
so before row 9 copy `<run>/ssh_config` into `userFile`'s place as the first text of the file (keep what rows 3–8
wrote after it). Row 12 needs the same file to reach `harness`.

## 3. The catalogue

In `coverage-slice1.tsv`, F-2204 AC-2, 3, 4, 5, 6, 7, 8, 9, 26, 27, 28, 29, 31, 32, 33, 34, 35, 36 and 40 go to
`acceptance`. Each row's name starts with `F-2204 AC-<n>:` (several criteria: `F-2204 AC-5, AC-6, AC-7:`); row 3 is
also the feature's wiring row (the parsed block reaches the file), and row 4 shows a block with options. List in the PR
the core halves: the input's look (no Back button, no step counter), the notice's source and its staying in the
notification center, the preview tab.

## 4. Gates and review

All gates, the tools files at 100 %, and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium` green with the
new launch. Paste its summary.

- **PR title:** `tests: F-2204's Add New SSH Host rows in a launch with its own home (card coverage-38, #726)`.
- **Review:** themis or triton reviews; athena gives the tag check, and proteus checks that no run writes outside
  `<run>`.

## 5. Done when

The rows pass in the VSCodium run, the catalogue lines are tagged, and every gate passes. A row that fails because the
extension does something else is not changed: report it on #726.

## 6. Open rows (stop and report on #726)

1. The editor doesn't start with `HOME` set to the launch's folder, or the extension host's `os.homedir()` is
   elsewhere.
2. A row needs an agent command or `state` field that §2 doesn't name.
