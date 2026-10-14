# Task card connect-53: the own host is the same host string, not the same host name

Issue: #785. Release 0.2, **gating** (F-2411 under D-86). Size: S. Builder: selene. Found by coverage-39's build
(#727). Its AC-25 row was dropped, and it goes back in after this card.

## 1. The defect

**The rule:**
- F-2411 6.7: "Own host typed in another form (for example `<user>@<alias>` while the window is
  `ssh-remote+<alias>`): not recognized as the own host; 5.0 runs (S085, server stopped), and the window then follows
  6.6 step 3 with core's dialog."
- AC-25: with the typed `user@A` in a window on `A`, "Killed VS Code Server on A." appears, and the window stays an SSH
  window. F-2412 6.1 decides the uninstall's own host the same way.

**What main does:**
- `maintenance/maintenance-commands.ts`'s `ownHostOf` calls `isOwnHost(target.host, held.target.host)`
  (`maintenance/target.ts`). It compares the host names only.
- So the typed `harness@harness` in a window on `harness` counts as the own host. The default-mode plan then switches
  the window to a local one, and nothing is killed on the host.
- `isOwnHost`'s own JSDoc says "exact, case-sensitive equality of the target as given and the window's authority host.
  A different spelling of the same host is another host". The call site drops the user and port.

## 2. The fix

1. **`maintenance/target.ts`:** `isOwnHost(target: SshTarget, windowTarget: SshTarget | undefined): boolean` is
   `payloadOf(target) === payloadOf(windowTarget)` (`connect/connect-commands.ts`'s `payloadOf`, the host string as the
   authority writes it). So two targets are the same host exactly when their host, user and port are all equal, case
   kept: `harness` ≠ `harness@harness` ≠ `harness:22` ≠ `HARNESS`. No alias is resolved: an alias and its `HostName`
   are two hosts, as 6.7 says of a different form. Keep the JSDoc's sentence, and add "the user and the port included".
2. **`maintenance-commands.ts`:** `ownHostOf` calls `isOwnHost(target, held.target)`. Kill Current is unchanged: it
   takes the held host directly.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `maintenance-target.test.ts` | the existing `isOwnHost` rows, rewritten to targets | `{host: 'devbox'}` against `{host: 'devbox'}`; `{host: 'DEVBOX'}`, `{host: '10.0.0.5'}` against `{host: 'devbox'}`; anything against `undefined` | `true`; `false`, `false`; `false` (same outcomes as today) |
| `maintenance-target.test.ts` | `F-2411 6.7: a user or a port makes another host string` | `{host: 'devbox', user: 'lab'}` against `{host: 'devbox'}`; `{host: 'devbox', port: 22}` against `{host: 'devbox'}`; `{host: 'devbox', user: 'lab'}` against `{host: 'devbox', user: 'lab'}` | `false`, `false`, `true` |
| `maintenance-commands.test.ts` | `F-2411 AC-25: a typed user@A in a window on A kills on the host and leaves the window` | `setup({held: DEFAULT_MODE, picked: {kind: 'typed', label: '➤ me@dev', text: 'me@dev', keepVisible: true}})` (the window on `dev`); `kill()` | `scenario.runs` is `['kill dev']`, the notice is S085 for `dev`, there's no `switch` in `scenario.order`, and the window's own helper isn't ended before the run |
| `maintenance-commands.test.ts` | `F-2412 6.1: a typed user@A in a window on A uninstalls on the host` | the same with `uninstall()` | `scenario.runs` is `['uninstall dev']`, no `switch` |

**Defect rule:** the second-table rows for AC-25 and F-2412 must fail on main and pass with the fix. Paste both runs.

**Acceptance proof:** coverage-39's dropped row `F-2411 AC-25` (in `tests/acceptance/windows/kill.test.ts`: in a
window on `harness`, Kill on Host with the typed `harness@harness`, then S085, the window stays remote, and the
server's processes are gone). Its builder puts it back once this merges. Say so on #727.

## 4. Gates and review

Run all gates, with the changed files at 100 %. Use the PR title
`remote-ssh: the own host is the same host string (card connect-53, #785)`. Request athena only.

## 5. Open rows (stop and report on #785)

1. Another caller of `isOwnHost` needs the old host-only comparison. Name it.
