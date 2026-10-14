# Task card coverage-41: F-2302's Connect Current Window to Host acceptance rows

Issue: #729. Release 0.2, gating (D-86 puts F-2302, `remote-oss/remote-ssh#35`, into 0.2). #722 seeds F-2302 and lists
these criteria under "Needs an acceptance row": AC-4, 5, 7, 8, 9, 10, 17–23, 25, 27, 28, 29, 31, 32 and 33. This card
writes rows for all 20 and tags 19 of them: AC-32's listing half needs #722's defect 1 fixed first. AC-26 (a
trust-enabled launch) isn't here.
Builder: task:claude. Size: M (about 2 agent-days). **Depends on:** #722 merged; coverage-14's helpers (#568 §1) and
coverage-39's `serverProcesses()` and `logins()` (#727), added here if neither has merged.

## 1. The file and its setup

A new file `tests/acceptance/windows/current-window.test.ts`, in the `windows` launch, with the folder windows `c1`,
`c2` and `c3`. Use coverage-39's setup (§1). `switchTo(window)` is
`inWindow(window, 'opensshremotes.openEmptyWindowInCurrentWindow')`, and its `hostPick` entry is appended for that
window first.

**The same window.** The command reloads the window it runs in. A folder window that switches comes back as an empty
window under a new name (README, "Several windows"). So a switch is observed as follows:
- `nextEmptyWindow(() => switchTo(w))` returns the new name;
- `w`'s events end with `deactivated`;
- no other window activated: the editor's window count is unchanged.

**Measure first** how to count the editor's windows: for example, the renderer processes of the run's user-data folder
(`pgrep -f -- '--type=renderer.*<run>/user-data'`). Write what you measured into the PR. If neither the count nor the
deactivation can tell a switch from a new window, stop and report (§5).

## 2. The rows

Names start with `F-2302 AC-<n>:`.

| # | Steps | Assertions | AC |
|---|---|---|---|
| 1 | open folder window `c1` locally (`acceptance.agent.openWindow` with a local folder of the run); `switchTo('c1')`, `hostPick` → `dismiss` | the `hostPick` line: question `Select configured SSH host or enter user@host`, the hosts, `$(plus) Add New SSH Host...`, `Configure SSH Hosts...`; `c1` unchanged; no window opened | AC-4, AC-20 |
| 2 | `switchTo('c1')`, `hostPick` → `{label: 'harness'}` | a switch (§1) within about 2 s; the new name's `windowState` has the authority `ssh-remote+harness` and no folder; connected | AC-5 |
| 3 | open `c2` locally; `switchTo('c2')`, `hostPick` → `{typed: 'harness@127.0.0.1:<port>'}` | a switch; the authority is `ssh-remote+` and lib-authority's `sshRemoteCodec.encode({kind: 'host', hostName: '127.0.0.1', user: 'harness', port: <port>})`; the `progress` line names `127.0.0.1` | AC-7 |
| 4 | open folder window `c3` on `harness` (`openWindow('harness', 'c3')`); `switchTo('c3')`, `hostPick` → `{label: 'password'}` and the password | a switch to `ssh-remote+password` with no folder, though `/home/harness-pw/c3` exists (create it first) | AC-8 |
| 5 | with `c3`'s switch of row 4 the only window on `harness`, wait 10 s | no `ssh` process of the run's to the harness port for user `harness` remains on the client (`pgrep -f` on the `harness` alias), and `serverProcesses()` is not empty | AC-9 |
| 6 | open `c1` and `c2` on `harness`; `switchTo('c1')` to `password` | `c2` has no new record line and is still connected (`acceptance.agent.state` answers with its authority) | AC-10 |
| 7 | a window on `harness`; `switchTo` it, `hostPick` → `{label: 'harness'}` | a switch back to `ssh-remote+harness`, connected, with no folder and no `notice` line | AC-17 |
| 8 | the `local` (empty) window: `switchTo('local')` to `harness` | a switch; connected | AC-18 |
| 9 | a window on `refused` (opened with `acceptance.agent.openWindow`; its `failureDialog` → `dismiss`); `switchTo` it to `harness` | a switch; connected | AC-19 |
| 10 | in a local folder window, `inWindow(w, 'opensshremotes.openEmptyWindowInCurrentWindow')` with no argument, then `'harness'`, then `{host: 'harness'}` | a `hostPick` line each for the first two (answered `dismiss`); the third switches with no `hostPick` line | AC-21 |
| 11 | the same with `{host: 'harness@127.0.0.1:22'}` | no `hostPick` line; a switch to an `ssh-remote+` authority (any encoding) | AC-27 |
| 12 | a local folder window switches to `password`, `maskedInput` → a wrong text three times | the new window's `failureDialog` line is `Could not establish connection to "password": Permission denied` (measure the exact reason text, which F-2601 decides) | AC-22 |
| 13 | a local folder window, `switchTo`, `hostPick` → `{typed: 'nohost.invalid'}`, `failureDialog` → `{button: 'More Actions...'}`, `mitigationPick` → `dismiss` | the `failureDialog` line holds `Could not resolve hostname`; the `mitigationPick` line's question is `Pick an action to help resolve the problem.` | AC-23 |
| 14 | copy the bytes of the settings file and the extension's global state (`acceptance.agent.state` reports `globalState` keys, or add it) before rows 2–8 | after them: the settings file is the same; the global state has no key beyond those F-2302 BR-5 lists (name them in the PR from the spec) | AC-25 |
| 15 | a local folder window, `switchTo`, `hostPick` → `{label: '$(plus) Add New SSH Host...'}`, `textInput` → `{text: 'cw-added'}`, `filePick` → `{label: <the run's ssh_config path>}`, `notice` → `{button: 'Connect'}` | one new empty window on `ssh-remote+cw-added` opens (close it and dismiss its failure); the first window keeps its folder and has no `deactivated` event. Then remove `Host cw-added` from `<run>/ssh_config` | AC-28 |
| 16 | the same with `hostPick` → `{label: 'Configure SSH Hosts...'}`, `filePick` → `{label: <ssh_config path>}` | the window's active editor is `<run>/ssh_config` (agent `state`, as coverage-38 row 4), and it keeps its folder with no `deactivated` event | AC-29 |
| 17 | a local multi-root workspace window (write a `.code-workspace` with two run folders and open it with `acceptance.agent.openWindow`); `switchTo` to `harness` | a switch; the new window has no folder and no workspace | AC-31 |
| 18 | `openWindow` on `nowhere` (connecting for 15 s); at once, `inWindow(<it>, 'opensshremotes.openEmptyWindowInCurrentWindow', {host: 'harness'})` | the window switches to `ssh-remote+harness` and connects, with no `failureDialog` line of `nowhere` after the switch | AC-32 (the keybinding half) |
| 19 | `userSettings({'remote.SSH.useLocalServer': false})`; a window on `harness` only; `switchTo` to `password`, then back to `harness` | within 10 s of the first switch no client `ssh` to `harness` remains; after the switch back, `logins()` grew by exactly one | AC-33 |

## 3. The catalogue

In `coverage-slice1.tsv`, F-2302 AC-4, 5, 7, 8, 9, 10, 17, 18, 19, 20, 21, 22, 23, 25, 27, 28, 29, 31 and 33 go to
`acceptance`. AC-32 stays `todo` until #722's defect 1 is fixed: its fix card adds the listing half. List as core
halves: the title and indicator (AC-5, 7), and the failure dialog's look (AC-22, 23).

## 4. Gates and review

All gates, and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium` green. Paste its summary.

- **PR title:** `tests: F-2302's Connect Current Window rows (card coverage-41, #729)`.
- **Review:** themis or triton reviews; athena gives the tag check.

## 5. Open rows (stop and report on #729)

1. Nothing tells a switch of the same window from a new window (§1).
2. The agent's `state` can't report the active editor or the global-state keys, and adding them needs more than a
   field of its report.
3. Any outcome differs from the row. Don't change the row: report it.
