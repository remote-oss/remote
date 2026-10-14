# Task card coverage-39: F-2411's Kill VS Code Server acceptance rows

Issue: #727. Release 0.2, gating (D-86 puts F-2411, `remote-oss/remote-ssh#56`, into 0.2). #722 seeds F-2411. Its
"Needs an acceptance row" table lists 26 criteria; F-2411 AC-16 and AC-17 from the "harness capability missing" table
are also written here, since the `password-ask` alias (D-85) gives what they need. Plus the feature's wiring row.
Builder: task:claude. Size: M–L (about 3 agent-days). **Depends on:**
- #722 merged;
- connect-43 (#681), which registers Kill Current (`opensshremotes.cleanCurrentRemoteServer`), for the rows marked
  **KC**. Write the other rows first. If connect-43 hasn't merged when they pass, open the PR without the KC rows, leave
  their criteria `todo`, and add them in a second PR;
- coverage-14's harness helpers `waitFor`, `userSettings` and `connectionHelpers` (#568 §1). If that build hasn't
  merged, add them as #568 §1 says.

## 1. The file and its setup

A new file `tests/acceptance/windows/kill.test.ts`, in the `windows` launch. It uses only its own windows, with the
folders `x1`, `x2` and `x3`. Before it runs, it closes the windows of the files before it and waits until no
connection helper runs, as coverage-14 does.

**Helpers** (in the file, unless coverage-14 or coverage-40 already put the same one in `windows/harness.ts`; move a
helper both files need into the harness):
- `serverProcesses()`: the process ids, on the host, of the user `harness` whose command line contains
  `/home/harness/.vscodium-server-insiders/` (`onHost('pgrep', '-u', 'harness', '-f', '.vscodium-server-insiders/')`).
  Measure first what a running server shows there, and write it into the PR;
- `killOnHost(window)`: `inWindow(window, 'opensshremotes.cleanRemoteServer')`;
- `killCurrent(window)`: `inWindow(window, 'opensshremotes.cleanCurrentRemoteServer')`;
- `logins()`: the count of `Accepted publickey for harness` lines in the container's log, read as `acceptedPasswords()`
  reads its lines (generalise that function to take the line it counts, and keep its callers).

**Connected** and **no message** mean what they mean in coverage-14 §2.

## 2. The rows

Names start with `F-2411 AC-<n>:`. Script entries are appended before each row, naming the window that answers.

| # | Steps | Assertions | AC |
|---|---|---|---|
| 1 | open `x1` on `harness` (a server runs) | connected; `serverProcesses()` isn't empty | — (setup) |
| 2 | in the `local` window, Kill on Host, `hostPick` → `dismiss` | the `hostPick` line: question `Select configured SSH host or enter user@host`; `items` are the run's `ssh_config` hosts in file order, then `$(plus) Add New SSH Host...`, then `Configure SSH Hosts...`; no other line; `serverProcesses()` unchanged | AC-2, AC-4 |
| 3 | append `Host kill-new` / `HostName 127.0.0.1` / … (a copy of the `harness` block under a new name) to `<run>/ssh_config`; Kill on Host, `hostPick` → `dismiss` | the `items` now hold `kill-new` in its place. Then remove the block again | AC-3 |
| 4 | in `local`, Kill on Host, `hostPick` → `{label: 'harness'}`, `notice` → `dismiss` | within 2 s of the pick's answer a `notice` line `Killed VS Code Server on harness.` with `buttons` `['Open Logs']`, and no `progress` line between the pick and it; within 10 s `serverProcesses()` is empty | AC-5 |
| 5 | — | `x1` is not changed by the kill in `local`: then within 30 s `x1`'s record has core's reconnect state (measure what the agent sees: `windowState('x1')` and the `deactivated`/`activated` events), and a `reloadWindow('x1')` makes it connected again | AC-10 |
| 6 | the `local` window after row 4 | `windowState('local')` has the same folders and no authority, as before row 4 | AC-9 |
| 7 | in `local`, Kill on Host, `hostPick` → `{label: 'harness'}`, `notice` → `{button: 'Open Logs'}` | the log channel is shown: `acceptance.agent.state` reports the visible output channel (add `visibleOutputChannel` to its report if it has none; the channel's name is the extension's log channel) | AC-8 (S085) |
| 8 | Kill on Host, `hostPick` → `{label: 'refused'}`, `notice` → `{button: 'Open Logs'}` | within 2 s of the answer a `notice` line `Failed to kill VS Code Server on refused.` with `['Open Logs']`; the channel is shown | AC-14, AC-8 (S076) |
| 9 | Kill on Host, `hostPick` → `{label: 'nowhere'}`, `notice` → `dismiss` | no line until the notice; the notice line `Failed to kill VS Code Server on nowhere.` with `['Open Logs']` | AC-13 |
| 10 | Kill on Host, `hostPick` → `{label: 'Configure SSH Hosts...'}`, `filePick` → `dismiss`; then `hostPick` → `{label: '$(plus) Add New SSH Host...'}`, `textInput` → `dismiss` | no `notice` line in either run; `serverProcesses()` unchanged | AC-12 |
| 11 | Kill on Host, `hostPick` → `{typed: 'harness@127.0.0.1:<the host's port>'}` with a server running (open `x2` on `harness` first, then close it) | a `notice` `Killed VS Code Server on 127.0.0.1.`; the server is gone | AC-11 (the wiring row of the typed target) |
| 12 | Kill on Host, `hostPick` → `{label: 'password'}`, `maskedInput` → `dismiss`; then again with `maskedInput` → `{text: <hostPassword()>}` | the first gives `Failed to kill VS Code Server on password.`; the second `Killed VS Code Server on password.` | AC-15 |
| 13 | delete `<run>/known_hosts_password_ask`; Kill on Host, `hostPick` → `{label: 'password-ask'}`, the host-key `pick` → `dismiss` | `Failed to kill …`; the file doesn't exist (or is byte for byte as before). Then again with the `pick` → `yes` and the password: `Killed …` | AC-17 |
| 14 | write a wrong key for the `password-ask` host into `<run>/known_hosts_password_ask` (a fresh ed25519 key's public line under the host's name and port); Kill on Host, `hostPick` → `{label: 'password-ask'}` | `Failed to kill VS Code Server on password-ask.` with no `pick` or `maskedInput` line. Then delete the file | AC-16 |
| 15 | `onHost('rm', '-rf', '/home/harness-nofwd/.vscodium-server-insiders')`, so the `noforward` account has no server (an earlier row may have connected it); Kill on Host, `hostPick` → `{label: 'noforward'}` | `Killed VS Code Server on noforward.`; `onHost('test', '-e', '/home/harness-nofwd/.vscodium-server-insiders')` fails | AC-18 |
| 16 | `userSettings({'remote.SSH.path': '<run>/no-such-ssh'})`; Kill on Host on `harness` | `Killed VS Code Server on harness.` and no other line. Then reset the setting | AC-30 |
| 17 | Kill on Host on `blackhole` (not awaited) in `local`, then at once Kill on Host on `harness` in a second local window: an agent runs its commands one at a time. `blackhole` is the run's alias of `192.0.2.1` (TEST-NET-1, never routed), as coverage-19 §1 defines it; `nowhere` fails at once at name resolution, so it never waits | the `harness` notice comes before the `blackhole` notice | AC-31 |
| 18 | open `x1`; record `logins()`; Kill on Host on `harness` from `local`; then with `userSettings({'remote.SSH.useLocalServer': false})`, open `x2` on `harness` and Kill on Host on `harness` from `x2` | each kill adds exactly one `Accepted` line, and within 5 s of each notice no `sshd: harness` session of the kill remains (`onHost('pgrep', '-u', 'harness', '-f', 'sshd: harness')` counts only the windows' sessions). Reset the setting | AC-33 |
| 19 | copy the settings file's bytes before rows 4, 8 and 10 | after each, the settings file is byte for byte the same | AC-23 |
| 20 | `userSettings({'remote.SSH.useExecServer': false})`; open `x1` (the server is installed under `bin/`); Kill on Host on `harness` | `onHost('test', '-e', '/home/harness/.vscodium-server-insiders/bin')` fails; opening `x1` again records an install `progress` line. Reset the setting | AC-7 |
| 21 | after row 20, open `x1` | connected, and its server's process id differs from the one before the kill | AC-28 |
| 22 | `userSettings({'remote.SSH.remoteServerListenOnSocket': true})`; open `x1`; Kill on Host on `harness` | `Killed …`; `serverProcesses()` is empty within 10 s. Reset | AC-32 (Kill on Host) |
| 23 | open `x1` (default mode); in `x1`, Kill on Host, `hostPick` → `{typed: 'harness@harness'}` | `Killed VS Code Server on harness.`; `x1` stays remote (`windowState`), and later shows core's reconnect state as in row 5 | AC-25 |
| 24 **KC** | open `x1` (default mode, no dirty editor); Kill Current in `x1` | within 1 s `x1` is an empty local window (`windowState`: no authority, no folders), no new window opened, and `serverProcesses()` is unchanged | AC-19 |
| 25 **KC** | the same with `userSettings({'remote.SSH.useLocalServer': false})` | a `notice` `Killed VS Code Server on harness.`; `serverProcesses()` empty within 10 s; `x1` remote until core's reconnect state | AC-20 |
| 26 **KC** | in each mode, Kill on Host from `x1` picking `harness` | the outcome of row 24, then of row 25 | AC-21 |
| 27 **KC** | in `local`, and in `x3` opened on `refused` (failed), run Kill Current with `inWindow` (as a keybinding does) | no `notice`; the settings file unchanged; both windows still answer `acceptance.agent.state` | AC-22 |
| 28 **KC** | open `x1` and `x2` on `harness` (default mode); Kill Current in `x1` | `x2` has no `failureDialog` line and is still connected. Core's reconnection progress in `x2` is allowed: "silent" doesn't forbid it (athena, 2026-10-14) | AC-26 |
| 29 **KC** | open `x1`; type into an untitled editor without saving (agent command, as coverage-38 row 13); Kill Current; core's save prompt is answered with Cancel, then (again) Don't Save | Cancel: `x1` stays remote and the text is kept, and a `notice` `Killed …` line was written; Don't Save: `x1` is local. The server keeps running in both. If the agent can't answer core's save prompt, stop and report (§5) | AC-29 |
| 30 **KC** | socket mode as row 22; open `x1`; Kill Current in `x1` | `Killed …`; `x1` stays remote until core's reconnect state | AC-32 (Kill Current) |

Rows 13 and 14 use the `password-ask` alias's own `known_hosts` file, which only these rows and coverage-21 touch.
Each deletes the file at its end. coverage-21 (#598) recreates what it needs.

## 3. The catalogue

In `coverage-slice1.tsv`, F-2411 AC-2, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 23, 25, 28, 30, 31, 32 and 33
go to `acceptance`. The KC rows add AC-19, 20, 21, 22, 26 and 29. AC-24 (a fish login shell) stays `todo`: the VSCodium
run's host has no fish account. List it in the PR under "harness capability missing". List as core halves: the
notice's source; core's "Cannot reconnect" modal (AC-10, 25; athena, 2026-10-14: row 5 proves our half, the failed
re-resolve and the reload reconnecting); and the window title and indicator (AC-9).

## 4. Gates and review

All gates, and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium` green. Paste its summary.

- **PR title:** `tests: F-2411's Kill VS Code Server rows (card coverage-39, #727)`.
- **Review:** themis or triton reviews; athena gives the tag check.

## 5. Open rows (stop and report on #727)

1. The agent can't see core's reconnect dialog or state (rows 5, 23, 25, 30). Report what `windowState` and the
   events show, and daedalus moves that half to "core halves".
2. The agent can't answer core's save prompt (row 29).
3. A notice text, a timing bound or a host outcome differs from the row. Don't change the row: report it.
