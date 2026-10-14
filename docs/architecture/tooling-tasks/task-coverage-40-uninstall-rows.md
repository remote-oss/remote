# Task card coverage-40: F-2412's Uninstall VS Code Server acceptance rows

Issue: #728. Release 0.2, gating (D-86 puts F-2412, `remote-oss/remote-ssh#57`, into 0.2). #722 seeds F-2412 and lists
24 criteria under "Needs an acceptance row". This card writes them, plus the feature's wiring row, and AC-8, AC-9 and
AC-34 from the "harness capability missing" table, because the `password-ask` alias (D-85) and tooling-29's passphrase
account (#624) give what they need. Builder: task:claude. Size: M–L (about 3 agent-days).

**Depends on:**
- #722 merged;
- coverage-39 (#727) for the shared helpers `serverProcesses()` and `logins()`. Whichever card is built first puts
  them in `windows/harness.ts`;
- tooling-29 (#624) for row 22 (**T29**). If #624 hasn't merged, leave AC-34 `todo` and write it in a follow-up PR.

## 1. The file and its setup

A new file `tests/acceptance/windows/uninstall.test.ts`, in the `windows` launch, with the windows `u1`, `u2` and
`u3`. The setup is coverage-39's (§1). `uninstall(window)` is
`inWindow(window, 'opensshremotes.cleanDevBox')`. A failed uninstall makes `inWindow` fail with the handler's error:
**rejects** below means `inWindow` fails with a message that contains `Failed to run command`.

`dataFolder` is `/home/harness/.vscodium-server-insiders`: the product's server data folder in the VSCodium run, which
F-2412's `~/.vscode-server` stands for.

## 2. The rows

Names start with `F-2412 AC-<n>:`.

| # | Steps | Assertions | AC |
|---|---|---|---|
| 1 | in `local`, uninstall, `hostPick` → `dismiss` | the `hostPick` line: the question `Select configured SSH host or enter user@host`, the hosts, `$(plus) Add New SSH Host...`, `Configure SSH Hosts...`; no other line; `dataFolder` still exists | AC-2, AC-3 |
| 2 | append a `Host uninstall-new` block (a copy of `harness`) to `<run>/ssh_config`; uninstall, `hostPick` → `dismiss` | `items` list `uninstall-new`. Remove the block | AC-28 |
| 3 | open `u1` on `harness` and close it (a server runs and is installed); in `local`, uninstall, `hostPick` → `{label: 'harness'}` | no record line after the pick (no notice, progress or question); within 10 s `dataFolder` doesn't exist and `serverProcesses()` is empty; `windowState('local')` is as before | AC-4, AC-5, AC-6 |
| 4 | open `u1` on `harness` | the record has the install `progress` lines (`Downloading VS Code Server…` or the copy's, as the run installs) before `u1` is connected | AC-7 |
| 5 | uninstall, `hostPick` → `{typed: 'harness@harness'}` (a server installed first) | no line; `dataFolder` gone | AC-22 (the wiring row of the typed target) |
| 6 | uninstall, `hostPick` → `{label: 'refused'}` | **rejects** within 2 s of the answer; no `notice` line of ours | AC-12 |
| 7 | uninstall, `hostPick` → `{label: 'nowhere'}` (the run's `ConnectTimeout` is 10 s for `harness` blocks; `nowhere` has none, so 15 s) | **rejects** between 10 s and 20 s after the answer; no line before | AC-13 |
| 8 | the same as row 6, run with `inWindow` (as a keybinding runs it) | **rejects** with the same message (how core shows a rejected command run by a keybinding, a warning instead of a modal, is core's half) | AC-14 |
| 9 | `onHost('rm', '-rf', '/home/harness-nofwd/.vscodium-server-insiders')`; uninstall, `hostPick` → `{label: 'noforward'}` | no line; the folder still doesn't exist | AC-15 |
| 10 | open `u1` on `harness`; in `local`, uninstall `harness` | within 40 s `u1` loses its connection and shows core's reconnect state (as coverage-39 row 5 observes it); `reloadWindow('u1')` connects it | AC-16 |
| 11 | open `u1` (default mode); in `u1`, uninstall, `hostPick` → `{label: 'harness'}` | within 1 s `u1` is an empty local window; no line; `dataFolder` still exists | AC-17 |
| 12 | `userSettings({'remote.SSH.useLocalServer': false})`, no `remote.SSH.remotePlatform`; in `local`, uninstall `harness`, `platformPick` → `linux` | the `platformPick` line; no visible terminal (`window.terminals` of `local` as the agent reports them: none shown); `dataFolder` gone | AC-18 |
| 13 | after row 12, uninstall `harness` again in `local` (install first by opening and closing `u2`) | the `platformPick` line appears again; `remote.SSH.remotePlatform` is absent from the settings file | AC-29 |
| 14 | `userSettings` adds `remote.SSH.remotePlatform: {harness: 'linux'}`; uninstall `harness`; then `{'harness*': 'linux'}` with `uninstall-new` (row 2's block put back) | no `platformPick` line and `dataFolder` gone; then the same with the wildcard; an alias neither entry matches (`password`) still gets the pick (answer `dismiss`) | AC-30 |
| 15 | uninstall `harness`, `platformPick` → `dismiss` | no further line; `dataFolder` still exists; the settings file unchanged | AC-31 |
| 16 | uninstall `harness`, `platformPick` → `windows` | no line; `serverProcesses()` unchanged; `dataFolder` still exists | AC-32 |
| 17 | uninstall `harness`, `platformPick` → `macOS` | `dataFolder` gone and `serverProcesses()` empty | AC-33 |
| 18 | per-window mode: open `u1` on `harness`; in `local`, uninstall `harness` (`platformPick` → `linux`) | within about 20 s `u1` shows core's reconnect state; `reloadWindow('u1')` connects it with an install `progress` line. Reset `useLocalServer` | AC-36 |
| 19 | `userSettings({'remote.SSH.serverInstallPath': {harness: '/home/harness/custom'}})`; put a file `keep.txt` under `/home/harness/custom/`; make sure `dataFolder` exists (`mkdir -p` as `harness`) and a server runs; uninstall `harness` | `dataFolder` gone; `serverProcesses()` empty; `/home/harness/custom/keep.txt` still there. Reset | AC-20 |
| 20 | uninstall, `hostPick` → `{label: 'Configure SSH Hosts...'}`, `filePick` → `dismiss`; then `hostPick` → `{label: '$(plus) Add New SSH Host...'}`, `textInput` → `dismiss` | `dataFolder` still exists after both | AC-21 |
| 21 | copy the bytes of the settings file and of `<run>/user-data/User/keybindings.json` (if it exists) before rows 3, 6 and 15 | after each, both are byte for byte the same | AC-23 |
| 22 **T29** | uninstall the passphrase alias of tooling-29 (`harness-cert`'s alias; read its name from the README), `maskedInput` → `dismiss`; then again with the passphrase | the `maskedInput` line's question starts with `Enter passphrase for ssh key`; the first **rejects** and leaves its data folder; the second leaves no line and removes it | AC-34 |
| 23 | create `.vscode-server`, `.vscode-server-insiders`, `.vscode-remote` and `.vscode-server-oss` under `/home/harness`, each with a file `x`, besides `dataFolder`; uninstall `harness` | `dataFolder` gone; the four others still hold `x` | AC-26 (our data folder for `~/.vscode-server`, the four for its siblings) |
| 24 | delete `<run>/known_hosts_password_ask`; uninstall `password-ask`, the host-key `pick` → `yes`, the password | no line after the password; the file now holds the host's key; `/home/harness-pw/.vscodium-server-insiders` gone | AC-8 |
| 25 | delete the file again; uninstall `password-ask`, the `pick` → `dismiss`; then once more, the `pick` → `no` | both **reject**; the file doesn't exist | AC-9 |
| 26 | uninstall `password`, `maskedInput` → `dismiss`; then again with the password | the `maskedInput` line's question is `Enter password for harness-pw@<the alias's HostName>` (read the `HostName` from `<run>/ssh_config`; it is the alias's `User` and `HostName`, never the alias); the first **rejects**; the second leaves no line | AC-11 |

Row 23 also proves the process half of AC-27 for the uninstall that coverage-37 doesn't (the server tree stops): it
cites only AC-26.

## 3. The catalogue

In `coverage-slice1.tsv`, F-2412 AC-2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 26, 28, 29,
30, 31, 32, 33 and 36 go to `acceptance`, and AC-34 with row 22. Leave AC-10 (OpenSSH 10.2's wording: the runner's
client decides it), 19 and 37 (a trust-enabled launch), 24 (a fish account), 25 (terminal mode with an unknown key)
and 35 (host variants) `todo`. List them in the PR under "harness capability missing". List as core halves: the error
modal and its warning form (AC-12–14), the reconnect dialog (AC-16, 36), and the title and indicator (AC-6).

## 4. Gates and review

All gates, and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium` green. Paste its summary.

- **PR title:** `tests: F-2412's Uninstall VS Code Server rows (card coverage-40, #728)`.
- **Review:** themis or triton reviews; athena gives the tag check.

## 5. Open rows (stop and report on #728)

1. A failed uninstall doesn't reach `inWindow` as a failure with `Failed to run command`. Report what the agent got.
2. Row 23: the uninstall removes any of the four sibling folders. That is a defect: report it, and don't change the
   row.
3. Any timing bound or text differs from the row. Don't change the row: report it.
