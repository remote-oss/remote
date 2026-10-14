# Task card connect-52: Kill and Uninstall on Host open a connection of their own in shared mode

Issue: #784. Release 0.2, **gating**: F-2411 (`remote-oss/remote-ssh#56`) is in 0.2 under D-86. Size: S–M. Builder:
selene. Found by coverage-39's build (#727). Its AC-33 row was dropped, and it goes back in after this card.

## 1. The defect

**The rule:**
- F-2411 BR-2: "Kill on Host... always uses a NEW SSH connection to the host, even when the window is connected to it;
  it does not reuse the window's connection or another window's local connection server; the host's sshd log shows one
  new login session per kill, closed by the client right after."
- AC-33: one new login session for the kill, ended right after. F-2412's uninstall runs through the same maintenance
  run.

**What main does:**
- `connect-ports.ts`'s `maintain` runs `runMaintenance(stepsOf(ports, …), maintenanceInputOf(target), …)`.
- In shared mode, `stepsOf`'s `openConnection` is `openConnectionStep`. It acquires the connection helper whose record
  key is `input.rawHostString` (`pipeline/connection-step.ts`: `hostString: input.rawHostString`).
- `maintenanceInputOf` sets `rawHostString` to `payloadOf(target)`, the same key a window's helper uses. So when a
  window holds a helper for that host, the kill takes a lease on it and logs in 0 times instead of once (measured by
  coverage-39: 0 new `Accepted publickey` lines).
- Terminal mode (`useLocalServer` false) already opens its own `ssh` per run, and is unchanged.

## 2. The fix

1. **`pipeline/steps.ts`:** `ConnectInput` gains `connectionKey?: string`, the record key of the connection helper
   the connect acquires; when it's absent, `rawHostString` as today. Its JSDoc says exactly that.
2. **`pipeline/connection-step.ts`:** the acquire's `hostString` is `input.connectionKey ?? input.rawHostString`.
   Nothing else reads `connectionKey`; the channel and every other use of `rawHostString` are unchanged.
3. **`maintenance/maintenance-run.ts`:** `maintenanceInputOf(target, runKey)` takes a second argument and sets
   `connectionKey` to `` `${payloadOf(target)}\u0000maintenance-${runKey}` ``. The NUL can't occur in an authority, so
   the key never equals any window's. `rawHostString` stays `payloadOf(target)`.
4. **`connect-ports.ts`'s `maintain`:**
   - makes `runKey = randomBytes(8).toString('hex')` (`node:crypto`) per call;
   - runs the maintenance with `maintenanceInputOf(target, runKey)`;
   - in a `finally`, ends that private helper with
     `killConnection({helper: machine.helpers, freePort: machine.freeSocksPort}, machine.folders.registry, <the connectionKey>)`,
     so the login is closed right after (BR-2), not after the helper's end-policy grace.

   Make the key builder one exported pure function in `maintenance-run.ts`, `maintenanceConnectionKey(target, runKey)`,
   used by both, so the two can't differ.
5. The window's own helper (the key `payloadOf(target)`) is never touched by `maintain`. The commands' existing
   `killLocalServer(payloadOf(target))` after a kill (F-2411 POST-3) is unchanged.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `maintenance-run.test.ts` | `F-2411.BR-2: a maintenance input names a connection key of its own` | `maintenanceInputOf({host: 'dev'}, 'k1')` | `rawHostString` `'dev'`; `connectionKey` `'dev\u0000maintenance-k1'` |
| `maintenance-run.test.ts` | `F-2411.BR-2: two runs never share a key, and neither equals a window's` | `maintenanceConnectionKey` for `k1` and `k2` | different, and neither equals `payloadOf({host: 'dev'})` |
| `connection-step.test.ts` | `F-2411.BR-2: the acquire is keyed by the connection key when the input names one` | an input with `connectionKey: 'x'` | the acquire's `hostString` is `'x'`; without it, the input's `rawHostString` (an existing row, re-cited if one exists) |
| `connect-ports.test.ts` | `F-2411 AC-33: each kill acquires a helper of its own and ends it after the run` | `maintain('kill', {host: 'dev'})` twice over the ports fixture, with the acquire and `killConnection` recorded | two acquires with two different keys, neither `'dev'`; after each run, one `killConnection` with that run's key, also when the run fails (the `finally`) |
| existing rows | the `maintenanceInputOf` rows in `maintenance-run.test.ts` | pass a run key | unchanged otherwise |

**Defect rule:** the third and fourth rows must fail on main and pass with the fix. Paste both runs.

**Acceptance proof:** coverage-39's dropped row `F-2411 AC-33` (in `tests/acceptance/windows/kill.test.ts`: with a
window connected on `harness` in default mode, Kill on Host picks `harness`, and `acceptedKeyLogins(since)` grows by
exactly 1, with the kill's helper gone afterwards). Its builder puts it back once this merges. Say so on #727.

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage,
with the changed files at 100 %. Use the PR title
`remote-ssh: Kill and Uninstall on Host open a connection of their own (card connect-52, #784)`. Request athena only.

## 5. Open rows (stop and report on #784)

1. Something other than the acquire reads `rawHostString` in the shared path in a way that expects the helper's key.
   Name it.
