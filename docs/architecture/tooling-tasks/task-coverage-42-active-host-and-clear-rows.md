# Task card coverage-42: F-2303's New Window on Active Host and F-2605's clear command acceptance rows

Issue: #730. Release 0.2, gating (D-86 puts F-2303, `remote-oss/remote-ssh#36`, and F-2605's clear command,
`remote-oss/remote-ssh#72`, into 0.2). #722 seeds both and lists these under "Needs an acceptance row":
- F-2303 AC-4, 5, 6, 7, 8, 9, 13–18, 20–23 and 26;
- F-2605 AC-20, 21 and 23.

This card writes them, plus F-2303's wiring row (the target decisions tagged `unit`: port 22 dropped, user and case
kept). Builder: task:claude. Size: M (about 2 agent-days). **Depends on:** #722 merged; coverage-14's helpers (#568
§1) and coverage-39's `logins()` (#727), added here if neither has merged.

## 1. The file and its setup

A new file `tests/acceptance/windows/active-host.test.ts`, in the `windows` launch, with the windows `a1`, `a2` and `a3`,
and coverage-39's setup (§1). `newWindowFrom(w)` is
`nextEmptyWindow(() => inWindow(w, 'opensshremotes.openEmptyWindowOnCurrentHost'))`: it returns the one new window's
name, and fails if none or several open.

## 2. The F-2303 rows

Names start with `F-2303 AC-<n>:`.

| # | Steps | Assertions | AC |
|---|---|---|---|
| 1 | open `a1` on `harness`; record `logins()`; `const n = await newWindowFrom('a1')` | `a1` wrote no record line and still has its folder and authority; `n` opened within 3 s, its authority is `ssh-remote+harness` with no folder; `n` is connected within 5 s, with no `progress` line and no question of `n`; `logins()` unchanged | AC-4, AC-5, AC-6, AC-7 |
| 2 | `const m = await newWindowFrom(n)` | `m` is on `ssh-remote+harness`, connected, and `logins()` unchanged | AC-8 |
| 3 | `closeWindow('a1')` | `n` and `m` still connected; `newWindowFrom(m)` still opens a window (close it) | AC-9 |
| 4 | open window `a2` on the typed `harness@127.0.0.1:<port>` (the authority Connect to Host gives it: `sshRemoteCodec.encode({kind: 'host', hostName: '127.0.0.1', user: 'harness', port: <port>})`); `newWindowFrom('a2')` | the new window's authority equals `a2`'s, and it connects with no new login | F-2303 wiring (AC-10's decision end to end) |
| 5 | open `a3` on `password` (the password through `maskedInput`); record `acceptedPasswords()`; `newWindowFrom('a3')` | the new window connects with no `maskedInput` line of its own; `acceptedPasswords()` unchanged | AC-13 |
| 6 | `userSettings({'remote.SSH.useLocalServer': false})`; `a3` on `password` again (reopen); `newWindowFrom('a3')` with the new window's `maskedInput` → the password | the new window's `progress` line `Setting up SSH Host password` (measure the exact title) and its `maskedInput` line `Enter password for harness-pw@<HostName>`; it connects; `acceptedPasswords()` grew by one | AC-14 |
| 7 | the same, the new window's `maskedInput` → `dismiss` | only the new window has a `failureDialog` line, `Could not establish connection to "password": Connecting was canceled.`; `a3` is still connected | AC-15 |
| 8 | in row 7's failed window, `failureDialog` → `{button: 'Retry'}`, then `maskedInput` → the password | it connects | AC-16 |
| 9 | open `a1` on `harness` (per-window mode); cut the host's network (README, "Cutting the host's network") and `newWindowFrom('a1')`, its `failureDialog` → `{button: 'Retry'}` after the network is back | the new window's first `failureDialog` line holds `No route to host` (measure the reason the cut gives; if it's another F-2601 reason, report it, §5); after Retry it connects. Reset `useLocalServer` | AC-17 |
| 10 | run `openEmptyWindowOnCurrentHost` with `inWindow` in: `local`; a window on `refused` (failed, dialog dismissed); a window still connecting to `nowhere`; and `a1` while the network is cut (reconnecting) | no new window in any case (`emptyWindows()` unchanged); the settings file unchanged; every window still answers `acceptance.agent.state` | AC-18 |
| 11 | copy the settings file and the global-state keys (agent `state`, as coverage-41 row 14) before row 1 | after row 1: the settings file is the same; the only changed global-state entry is the new window's session record (name its key in the PR) | AC-20 |
| 12 | a multi-root workspace window on `harness` (a `.code-workspace` on the host with two folders) with an untitled editor holding typed text (agent command, as coverage-38 row 13); `newWindowFrom` it | the new window has no folder, no workspace and no dirty editor; the first still shows its workspace and the dirty untitled editor | AC-21 |
| 13 | `userSettings({'remote.SSH.remoteServerListenOnSocket': true})`; open `a3` on `password`; `newWindowFrom('a3')` with its `maskedInput` → the password | the new window has its own `progress` and `maskedInput` lines, and `acceptedPasswords()` grew. Reset | AC-22 |
| 14 | `userSettings({'remote.SSH.enableDynamicForwarding': false})` (default mode); `a3` on `password`; `newWindowFrom('a3')` | no `maskedInput` line of the new window, connected, `acceptedPasswords()` unchanged. Reset | AC-23 |
| 15 | `userSettings({'terminal.integrated.hideOnStartup': 'always'})`; `newWindowFrom` a window on `harness` | once connected, the new window has no terminal (agent `state`'s terminals, or add them) | AC-26 |

## 3. The F-2605 rows (the clear command)

Names start with `F-2605 AC-<n>:`. `clear(w)` is `inWindow(w, 'opensshremotes.clearAllSessionHints')`.

**Measure first:** can the run seed the extension's global-state key `remote.ssh.hints` before the windows launch
starts? It is in the profile's `state.vscdb`: insert the row with `sqlite3` before the editor starts. If it can, row 16
seeds a value. If it can't, row 16 runs on an empty store too, and AC-20's "the store is deleted" stays with its unit
row `F-2605.AC-20: the store's key is the only update`. Write which into the PR.

| # | Steps | Assertions | AC |
|---|---|---|---|
| 16 | a window `a1` on `harness`, connected; `clear('a1')` | no record line; `a1` still connected; the other global-state keys of the extension unchanged; `remote.ssh.hints` absent | AC-20 |
| 17 | `clear('a1')` again (the store is empty now) | `inWindow` resolves; no record line | AC-21 |
| 18 | `userSettings({'remote.SSH.experimental.chat': false})`; `clear('a1')` | `inWindow` resolves with no record line; the settings file holds no key the row didn't write; `a1` still connected. Reset | AC-23 |

## 4. The catalogue

In `coverage-slice1.tsv`:
- F-2303 AC-4, 5, 6, 7, 8, 9, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23 and 26 go to `acceptance`;
- F-2605 AC-20, 21 and 23 go to `acceptance`.

List these as core halves: the new window's title rendering and the Explorer's empty view (AC-7), and the failure
dialog's look. AC-7's indicator text "SSH: <alias>" is ours, from the F-2502 formatter: cite `label-formatter.test.ts`'s
`F-2502 BR-2` rows in the PR.

## 5. Gates and review

All gates, and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium` green. Paste its summary.

- **PR title:** `tests: F-2303's New Window on Active Host rows and F-2605's clear command rows (card coverage-42, #730)`.
- **Review:** themis or triton reviews; athena gives the tag check.

## 6. Open rows (stop and report on #730)

1. A row's outcome differs: a new login where none is expected, a question in the wrong window, or a different failure
   reason. Don't change the row: report it.
2. The agent can't report terminals, dirty editors or global-state keys without more than a field of its `state`.
