# Task card coverage-14: F-2102's Kill and window-lifecycle rows on a key host (batch 7a of #142's acceptance rows)

Issue: #568. Why: #142's acceptance rows, batch 7a. F-2102 (`remote-oss/remote-ssh#20`) is the shared local connection
server: one connection helper per host for every window, its lifetime, and "Remote-SSH: Kill Local Connection Server For
Host...". These rows prove it on the key-login host in tooling-20's windows suite. The password-host rows (the shared
login, the waiting window) are batch 7b, and the ControlMaster rows are batch 7c. Builder: iris. Size: about 2
agent-days. **Depends on:**
- connect-21 (#540), which registers `opensshremotes.cleanLocalServer`;
- tooling-25 (#566), which lets the script answer its host pick and the configuration-file pick;
- coverage-13's `Host 127.0.0.1` block of the run's `ssh_config` (#556 §1.3). If coverage-13 hasn't merged, add the
  same block here.

## 1. The file and its setup

A new file `tests/acceptance/windows/local-server.test.ts`, in the `windows` launch (one editor, every window driven by
the agent). It uses only its own windows, whose folders are `k1`, `k2` and `k3`, so its agent files never mix with
`two-windows.test.ts`'s `b` and `c`.

**Before the file:**
- close every window of `two-windows.test.ts` that is still open (`closeWindow`);
- wait until no connection helper of the run runs (`connectionHelpers()` below is 0, bounded at 60 s);
- append this file's script entries to the launch's script file (`<run>/windows-script.json`), each naming its window.

A window reads the script at its first question, so the entries must be in the file before the window that answers
them opens. Write them all in the `before` hook. Keep the entries already there.

**Helpers** (in `windows/harness.ts`, with unit rows in `tools/` where they parse):
- `connectionHelpers()`: the process ids of the connection helpers of the run's extensions folder, with the pattern of
  `two-windows.test.ts`. Move that function into the harness;
- `sshChildren(helperId)`: the ids of the `ssh` processes whose parent is `helperId` (`pgrep -P <id> -x ssh`);
- `waitFor(description, check, milliseconds)`: polls `check` every 100 ms until it holds, failing with the description
  after `milliseconds`;
- `kill(window)`: `inWindow(window, 'opensshremotes.cleanLocalServer')`. Its `hostPick` answer is already in the
  script;
- `userSettings(change)`: rewrites `<run>/user-data/User/settings.json` with `change` applied to its JSON, which the
  editor picks up as a file change. Then waits 1 s.

## 2. The rows, in order

Each row's name starts with `F-2102 AC-<n>:`. "Connected" means `windowState(w).remoteName` is `ssh-remote` and
`inWindow(w, 'acceptance.agent.writeFile', 'probe.txt', w)` puts `w` into `/home/harness/<w>/probe.txt`. "No message"
means the record has no `notice`, `failureDialog`, `pick` or `maskedInput` line of any window between the step's start
and its end.

| # | Steps | Assertions | AC |
|---|---|---|---|
| 1 | open `k1` on `harness` | connected; one helper | — (setup) |
| 2 | in `k2` (opened on `harness`), Kill, with `hostPick` → `dismiss` | the `hostPick` line of `k2`: question `Select configured SSH host or enter user@host`; `items` are the run's `ssh_config` `Host` names in file order (each word of a `Host` line without `*`, `?` or `!`), then `Add New SSH Host...` and `Configure SSH Hosts...`. The helper is the same process, and there's no message | AC-4, AC-5 |
| 3 | in `k2`, Kill, `hostPick` → `{label: 'harness'}` | no message. The helper of step 1 and its `ssh` children are gone within 2 s, and a new helper runs within 5 s | AC-6, AC-29 |
| 4 | — | within 5 s of step 3, `k1` and `k2` are connected again, and no `maskedInput` or `pick` line was written after step 3 | AC-7 |
| 5 | reload `k1`, the window that started the helper | after the reload, the helper is the same process and `k2` is connected | AC-14 (reload) |
| 6 | close `k1` | the helper is the same process and `k2` is connected | AC-14 (close) |
| 7 | in `k2`, run `workbench.action.remote.close` | within 5 s no helper runs | AC-15 (Close Remote Connection) |
| 8 | in `k3`, opened on `harness`, then closed | within 5 s of the close no helper runs | AC-15 (close) |
| 9 | with no helper running and no window on the host, in the `local` window, Kill, `hostPick` → `{label: 'harness'}` | no message; still no helper; no window's state changed (`k1`–`k3` closed, `local` local) | AC-16 |
| 10 | open `k1` on `harness`; in `k1`, Kill, `hostPick` → `{typed: 'harness@127.0.0.1'}` | the helper is the same process; `k1` is connected | AC-17 |
| 11 | open `k2` on the authority Connect to Host gives for the typed `harness@127.0.0.1`: `ssh-remote+` and lib-authority's `sshRemoteCodec.encode({kind: 'host', hostName: '127.0.0.1', user: 'harness'})`. In `k2`, Kill, `hostPick` → `{typed: 'harness@127.0.0.1'}` | `k2`'s helper (the newest helper process, distinct from `k1`'s) is gone within 2 s, a new one runs within 5 s, and `k2` is connected again within 5 s. `k1`'s helper is the same process | AC-31 |
| 12 | in `k1`, Kill, `hostPick` → `{label: 'Configure SSH Hosts...'}`, then `filePick` → `dismiss` | a `filePick` line of `k1` with the question `Select SSH configuration file to update`; `k1`'s helper is the same process | AC-18 (Configure) |
| 13 | close `k1` and `k2`; wait for no helper | — | — (teardown) |
| 14 | open `k1` on `harness`; end its helper with `kill -9` (its record stays); reload `k1` | no message; a new helper runs; `k1` is connected. Then, in `k1`, Kill, `hostPick` → `{label: 'harness'}`: the new helper is gone within 2 s | AC-33 |
| 15 | close `k1`, wait for no helper. `userSettings({'remote.SSH.useLocalServer': false})`; open `k1` and `k2` on `harness` | no helper runs while both are connected (per-window mode) | — (setup of AC-21) |
| 16 | in `k1`, Kill (run by `inWindow`, as a keybinding runs it), `hostPick` → `{label: 'harness'}` | no message; no helper; `k1` and `k2` connected; `<run>/ssh_config` and the user settings unchanged, byte for byte | AC-21 |
| 17 | close `k1` and `k2`; `userSettings` back to `true`; open `k1` on `harness` (a helper starts); `userSettings({'remote.SSH.useLocalServer': false})`; in `k1`, Kill, `hostPick` → `{label: 'harness'}` | the helper is gone within 2 s; `k1` is connected again within 10 s, and no helper runs (per-window mode) | AC-22 |
| 18 | close `k1`; `userSettings` back to the run's base | — | — (teardown) |

The `local` window answers its own `hostPick` entry in step 9 (`window: 'local'`).

Kill's `hostPick` entries are written in the order the steps run, one per Kill, each naming the window that runs it.
The step 12 `filePick` entry names `k1`.

## 3. The catalogue

In `docs/architecture/catalogue/coverage-slice1.tsv`, F-2102 AC-4, 5, 6, 7, 14, 15, 16, 17, 21, 22, 29, 31 and 33 go to
`acceptance`. AC-7's "shows `SSH: <host>`" is core's rendering of our label: list it under "Core halves". AC-18 stays
`todo` until connect-22 (#531) builds "Add New SSH Host..."; this card proves its Configure half. List that half
under "Needs an acceptance row".

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file in the `windows` launch; paste its summary. The repository's
gates pass. If a row fails because the extension does something else, don't change the row: report it on the issue.

## 5. Review

PR title `tests: F-2102's Kill and window-lifecycle rows (card coverage-14, #142)`. themis or triton reviews; athena
gives the tag check.
