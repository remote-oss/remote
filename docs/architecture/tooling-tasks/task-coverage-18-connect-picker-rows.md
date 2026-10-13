# Task card coverage-18: the Connect to Host picker rows of F-2301, F-2202 and F-2201 (batch 3a of #142's acceptance rows)

Issue: #588. Why: #142's acceptance rows, batch 3a. These rows run Connect to Host... (`opensshremotes.openEmptyWindow`)
end to end, as a user does: the pick's rows, typing, Escape, the new empty windows it opens, and the configuration file
changing under it. They cite F-2301 (`remote-oss/remote-ssh#34`), F-2202 (`#29`) and F-2201 (`#28`). Builder: iris or
hestia (hermes assigns). Size: about 2 agent-days. **Depends on:**
- #540: the command;
- connect-29 (#571): the pick's focus;
- tooling-25 (#566): `hostPick`;
- tooling-28 (#583): empty windows' names, `nextEmptyWindow`, `remoteAuthority`;
- connect-28 (#563): its log lines;
- coverage-14 (#568): the windows helpers.

## 1. The file and its rules

A new file, `tests/acceptance/windows/connect-picker.test.ts`, in the `windows` launch. The picking window is `local`
(the editor's first window), unless a row says otherwise.

**The configuration file.** The run's `remote.SSH.configFile` is `<run>/ssh_config`.
- A `before` hook copies it to `<run>/ssh_config.saved`; an `after` hook copies it back and waits 1 s.
- Rows that change the file write the whole file in one `writeFileSync`.
- `aliases()` is the list of the file's `Host` words with no `*`, `?` or `!`, in file order. It's the F-2202 order the
  pick shows: the `Host` names in the order of their lines.

**Scripted answers.** Each row appends its entries with `appendScript` (tooling-26), naming the window that answers.
- A window opened by the command is scripted under `nextEmptyName()` before it's opened.
- A failing new window's entries are `failureDialog` → `dismiss`, then `mitigationPick` → `dismiss`.
- A row that opens a window waits for it with `nextEmptyWindow(...)`.

"Unchanged" for a window means: its `windowState` (remote, authority, folders) is the same before and after, and its
agent got no new `activated` or `deactivated` event.

## 2. The rows

Each row's name starts with its cite.

| Cite | Steps | Assertions |
|---|---|---|
| F-2301 AC-4 | `hostPick` → `dismiss` | the `hostPick` line's question is `Select configured SSH host or enter user@host`, and its `items` are `aliases()`, then `$(plus) Add New SSH Host...`, then `Configure SSH Hosts...` |
| F-2301 AC-19 | the same line | no new window (no new `empty-*`), and no `notice` or `failureDialog` line |
| F-2301 AC-6, AC-7 | `hostPick` → `{label: 'harness'}` | within 5 s, one new `empty-<n>`: `remoteName` `ssh-remote`, `remoteAuthority` `ssh-remote+harness`, no folders. `local` is unchanged. "Within about 2 s" is checked as the window's `activated` time minus the `hostPick` line's `time`, at most 5 000 ms, since the agent activates after the window opens |
| F-2301 AC-15 | pick `harness` again | a further `empty-<m>` on `ssh-remote+harness`; the first `empty-<n>` is unchanged |
| F-2301 AC-14 | in `empty-<n>`, `hostPick` → `{label: 'harness'}` | its `items` equal AC-4's (the client's hosts); a further new window opens; `empty-<n>` stays connected |
| F-2301 AC-33 | pick `harness` (its block sets `Port`) | the new window's `remoteAuthority` is `ssh-remote+harness`, with no port |
| F-2301 AC-30 | `hostPick` → `{typed: 'harness'}` | the new window's authority is `ssh-remote+harness`, the same as picking the alias |
| F-2301 AC-21, F-2202 AC-31 | `hostPick` → `{label: 'nowhere'}` (a listed host ssh can't resolve) | the new window's `failureDialog` reads `Could not establish connection to "nowhere": Could not resolve hostname.`; its `mitigationPick` `items` have `Open Recent...` second; `local` unchanged |
| F-2301 AC-28 | close that failed window | `local` unchanged; the other `empty-*` windows are unchanged |
| F-2301 AC-23 | four picks, one at a time, `{typed: …}`: `-oProxyCommand=x`, `a%b.invalid`, `a\b.invalid`, `a b.invalid` | each new window's dialog reason, in order: `SSH host name cannot begin with -`, `SSH host name cannot include the character %`, `SSH host name cannot include the character \`, `Hostname contains invalid characters` |
| F-2301 AC-31 | `{typed: 'porthost.invalid:99999'}`, then `{typed: 'harness@[fe80::1]:22'}` | dialogs `Could not establish connection to "porthost.invalid".` and `Could not establish connection to "fe80::1".`, without a reason |
| F-2301 AC-29 | `{typed: '   '}` (three spaces) | the line's `items` (tooling-25 records the initial model) are AC-4's. The new window's authority is `ssh-remote+` followed by three spaces, and its dialog's reason is `Hostname contains invalid characters` |
| F-2301 AC-32 | three picks in a row, waiting only for each `hostPick` line: `harness`, `nowhere`, `harness` | three new windows, each connected or failed on its own as its host says; `local` unchanged |
| F-2301 AC-26, F-2202 AC-22, F-2201 AC-17 | write the file with a new block `Host fresh-alias` (`HostName 127.0.0.1` and the `harness` block's other lines) appended; then `hostPick` → `dismiss` | `items` include `fresh-alias` in its file place; no reload happened (`local` unchanged) |
| F-2301 AC-5, F-2202 AC-33 | write a file holding only `Host *` and `Host *.corp !x` blocks (one option each); `hostPick` → `dismiss` | `items` are exactly `$(plus) Add New SSH Host...` and `Configure SSH Hosts...`; no `notice` line |
| F-2301 AC-24 | write a file whose second `Host` line has an unterminated quote (`Host "broken`); in `local`, run the command | `inWindow` fails, and its message holds the parser's detail. No `hostPick` line was written |
| F-2201 AC-21 | with the same file, `filePick` → `dismiss`; run `opensshremotes.openConfigFile` | the `filePick` line is there (the pick opens normally) |
| F-2201 AC-22 | with the same file, open a window on `harness` (`openWindow('harness', 'q1')`) | `q1` doesn't connect within 15 s; the record has a `failureDialog` or `notice` line of `q1` whose text names the parse problem; `connectionLog()` has no `Checking ssh client:` line (connect-28 §1) written after the step began. Close `q1` |

Restore the file after the last row.

## 3. The catalogue

`acceptance`:
- F-2301 AC-4, 5, 6, 14, 15, 19, 21, 23, 24, 26, 28, 29, 30, 31, 32 and 33;
- F-2202 AC-22, 31 and 33;
- F-2201 AC-17, 21 and 22.

Core halves, listed in #142:
- F-2301 AC-7: the title and the Explorer;
- F-2301 AC-24: the modal error's look;
- F-2202 AC-33: the Remotes view;
- the indicator of AC-33.

F-2201 AC-19 stays `todo` until connect-23's Kill and Uninstall exist. Its Connect to Host half is AC-24's row.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass. Report a row
that fails on the issue, not by changing it.

## 5. Review

PR title `tests: the Connect to Host picker rows (card coverage-18, #142)`. themis or triton reviews; athena gives the tag
check.
