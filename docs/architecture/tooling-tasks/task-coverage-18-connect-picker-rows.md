# Task card coverage-18: the Connect to Host picker rows of F-2202 and F-2201 (batch 3a of #142's acceptance rows)

Issue: #588. Why: #142's acceptance rows, batch 3a. These rows run Connect to Host... (`opensshremotes.openEmptyWindow`)
end to end, as a user does: the pick's rows, typing, Escape, the new empty windows it opens, and the configuration file
changing under it. They cite F-2202 (`remote-oss/remote-ssh#29`) and F-2201 (`#28`). Builder: iris or
hestia (hermes assigns). Size: about 0.75 agent-day. **Depends on:**
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
| F-2202 AC-31 | `hostPick` → `{label: 'nowhere'}` (a listed host ssh can't resolve) | the new window's `failureDialog` reads `Could not establish connection to "nowhere": Could not resolve hostname.`; `local` unchanged |
| F-2202 AC-22, F-2201 AC-17 | write the file with a new block `Host fresh-alias` (`HostName 127.0.0.1` and the `harness` block's other lines) appended; then `hostPick` → `dismiss` | `items` include `fresh-alias` in its file place; no reload happened (`local` unchanged) |
| F-2201 AC-21 | write a file whose second `Host` line has an unterminated quote (`Host "broken`); `filePick` → `dismiss`; run `opensshremotes.openConfigFile` | the `filePick` line is there (the pick opens normally) |
| F-2201 AC-22 | with the same file, open a window on `harness` (`openWindow('harness', 'q1')`) | `q1` doesn't connect within 15 s; the record has a `failureDialog` or `notice` line of `q1` whose text names the parse problem; `connectionLog()` has no `Checking ssh client:` line (connect-28 §1) written after the step began. Close `q1` |

Restore the file after the last row.

## 3. The catalogue

`acceptance`: F-2202 AC-22 and 31; F-2201 AC-17, 21 and 22.

F-2202 AC-33 is `deferred`, with the reason `build order slice 1: the Remotes view is remote-explorer's` (athena on #591,
as for F-2202 AC-20 on #475).

**F-2301's rows left this card on 2026-10-14.** The D-65 recorded cases cover F-2301 AC-1 to AC-19 and AC-21 to AC-33
(the coverage list on `remote-oss/remote-ssh#34`). Those criteria are tagged `recorded` once our replay passes, so they
need no row here.

F-2201 AC-19 stays `todo` until connect-23's Kill and Uninstall exist.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass. Report a row
that fails on the issue, not by changing it.

## 5. Review

PR title `tests: the Connect to Host picker rows (card coverage-18, #142)`. themis or triton reviews; athena gives the tag
check.
