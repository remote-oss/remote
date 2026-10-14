# Task card connect-74: Uninstall on the window's own host shows no reconnection progress

Issue: #857. Gating: milestone 0.2 (D-86 puts F-2412 in 0.2). F-2412 6.1 step 3, AC-17 (Q1 is (a), reproduce, as
connect-11 copies it). Size: S–M. Builder: `task:claude`. **Needs athena's design check:** it adds an operation to
lib-authority's `ResolverHandle` (`brief-lib-authority.md`, the resolver host row).

## 1. The defect

coverage-40 measured it (#728, comment 6161780611) in the VSCodium windows launch. In `u1`, connected to `harness` in
the default mode, Uninstall picking `harness` does turn `u1` into an empty local window, and the host is unchanged. But
`u1`'s record shows `['hostPick', 'progress', 'progress']`. AC-17 says "no notification appears", and 6.1 step 3 says
"the notification center stays empty".

**The cause:**
- `packages/remote-ssh/src/maintenance/maintenance-commands.ts:100-113`, `uninstallOwnHost`, follows
  `uninstallOwnHostPlan` (`own-host.ts:51`). It calls `ports.killLocalServer` first, then
  `ports.editor.switchToLocalWindow()` (`connect/connect-editor.ts:120`, `vscode.newWindow` with `reuseWindow` and
  `remoteAuthority: null`).
- Ending the local connection server ends the window's transport, so core starts its reconnection at once. Its resolve
  runs lib-authority's `resolveOne` (`packages/lib-authority/src/resolver/host.ts:313`). That calls `connect`, which
  opens `editor.progress.withProgress` (`host.ts:289`) before the connector runs. The two `progress` lines come from
  there, before the switch replaces the window.
- **The order can't simply be swapped:** `switchToLocalWindow` first tears down the extension host, so
  `killLocalServer` might never run, and BR-7 needs it.

## 2. The fix

1. **lib-authority, `ResolverHandle` (`host.ts:147`), gains `leave(): void` and `stay(): void`.**
   - `leave()` marks the window as leaving (`state.leaving = true`). From then on, `resolveOne` answers every resolve
     with `throw editor.notAvailable(undefined, true)` right after the decode. It starts no progress, calls no
     connector, and announces nothing to the tracker.
   - `stay()` clears the mark, so the next resolve runs as before.
   - The `state.disposed` check in `errorFor` (`host.ts:260`) is unchanged.
   - JSDoc: "The window is about to leave its remote: later resolves end at once, handled and silent, until `stay()`."
2. **remote-ssh, `MaintenancePorts` (`maintenance-commands.ts:28`), gains `leaveWindow(): void` and
   `stayInWindow(): void`.**
   - `register-connect.ts:145` (`maintenanceHandlers({…})`, the only place that builds `MaintenancePorts`) wires them
     to `resolver?.leave()` and `resolver?.stay()`, using the `resolver` already in scope there.
   - Without a resolver, the window has no remote to leave, so both do nothing.
3. **`uninstallOwnHost`, when `plan.switchesToLocalWindow` is set:** it calls `ports.leaveWindow()`, then
   `killLocalServer`, then `switchToLocalWindow()`. If an exception escapes the kill or the switch, it calls
   `ports.stayInWindow()` and rethrows.
   - The `actsOnHost` branch (`useLocalServer` false, 6.2 step 4) is unchanged. Its window is reconnected by core, as
     AC-36 wants.
4. **Kill Current and Kill on the own host (`killOwnHost`, `maintenance-commands.ts:83-97`) are unchanged.** They have
   the same order, but F-2411 AC-19 doesn't forbid the progress. A save-prompt Cancel there keeps the SSH window
   (F-2411 AC-29), and that path needs the reconnection.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| lib-authority `resolver-host.test.ts` | `F-2412 AC-17: a resolve after leave() starts no progress and no connect` | a registered resolver, `leave()`, then a resolve | rejects with `notAvailable(…, handled: true)`; the recording editor has no `withProgress`; the fake connector has no `connect` |
| lib-authority `resolver-host.test.ts` | `F-2412 AC-17: stay() puts the resolver back` | `leave()`, `stay()`, then a resolve | `withProgress` once, and the connector's `connect` once |
| lib-authority `resolver-host.test.ts` | `F-2412 AC-17: a resolve after leave() leaves the connection state alone` | connected, then `leave()` and a resolve | `currentConnection().state` as before the resolve |
| remote-ssh `maintenance-commands.test.ts` | `F-2412 AC-17: the own-host uninstall leaves the window before it ends the local server` | default mode, the held host picked | the ports' calls in order: `leaveWindow`, `killLocalServer`, `switchToLocalWindow` |
| remote-ssh `maintenance-commands.test.ts` | `F-2412 AC-17: a switch that throws puts the window back` | `switchToLocalWindow` rejects | `stayInWindow` called once; the rejection reaches the caller |
| remote-ssh `maintenance-commands.test.ts` | `F-2412 BR-6: the own-host uninstall with useLocalServer false never leaves the window` | terminal mode, the held host picked | no `leaveWindow` |
| remote-ssh `maintenance-commands.test.ts` | `F-2411 6.1: the own-host kill doesn't leave the window` | Kill Current in default mode | no `leaveWindow` |

The first, fourth and fifth rows fail on main, where the operations don't exist.

**Acceptance:** coverage-40's row 11 (`docs/architecture/tooling-tasks/task-coverage-40-uninstall-rows.md` on
`origin/feature/coverage-40`), added to `tests/acceptance/windows/uninstall.test.ts` with the name
`F-2412 AC-17: the own alias turns the window local with no notification and the host unchanged`.
- **Setup:** open `u1` (default mode), then in `u1` run the uninstall with `hostPick` → `{label: 'harness'}`.
- **Pass:** within 1 s `u1` is an empty local window; `surfacesSince(mark, 'u1')` is `['hostPick']` (no `progress`);
  `DATA_FOLDER` still exists.
- **On main** it shows `['hostPick', 'progress', 'progress']`.
- If coverage-40 hasn't merged, build on its file from `origin/feature/coverage-40`.

## 4. Open rows

**Measure:** does `vscode.newWindow` with `reuseWindow` resolve while the window stays, when the user cancels a save
prompt for a dirty editor? If it does, `uninstallOwnHost` calls `ports.stayInWindow()` after the switch returns, so a
window that stayed is reconnected by core. Record the measurement in the PR.
- If the extension host has gone by then, the call never runs, which is harmless.
- If the measurement shows no way to tell, keep the leave without `stay()` after a normal return, and say so in the
  PR for athena.

## 5. Gates and review

Run all gates and the VSCodium run. PR title `lib-authority, remote-ssh: Uninstall on the window's own host shows no
reconnection progress (card connect-74, #857)`. Request athena only.
