# Task card connect-43: Kill Current VS Code Server is registered, with its own-host plans

Issue: #681. Release 0.2 (the user put the maintenance commands in 0.2, #299's scope note), not gating. Size: M (about
2 agent-days). Builder: assigned by hermes. Spec: F-2411 (remote-oss/remote-ssh#56) §6.1, §6.2, §6.5, §6.7 and AC-19–22,
26, 29; F-2412 (#57) §6.1. Found by the unwired-contribution audit (2026-10-13).

## 1. The defect

- **The unregistered command:** `opensshremotes.cleanCurrentRemoteServer` ("Remote-SSH: Kill Current VS Code Server")
  is in the manifest's command palette for every connected SSH window, but neither handler map registers it
  (`packages/remote-ssh/src/activation.ts`, `register-connect.ts`). Choosing it gives core's "command not found".
- **What connect-23 built:** `cleanRemoteServer` and `cleanDevBox` only.
- **The unused planner:** connect-11's own-host planner (`maintenance/own-host.ts`: `killCurrentAvailable`,
  `killCurrentPlan`, `uninstallOwnHostPlan`) has no caller.
- **The own alias picked:** Kill on Host… (F-2411 6.7, AC-21) and Uninstall… (F-2412 6.1) for the window's own host run
  the other-host flow today.

## 2. The rules

- **R1. The window's own host.** The connector records, with the connection it holds, the connect's target and whether
  the connect ran in terminal mode (`dependencies.terminalMode()`, already read in `connect`). A new connector method,
  `heldHost(): {target: SshTarget; terminalMode: boolean} | undefined`, answers that while the held connection isn't
  lost, else `undefined`. `killCurrentAvailable` maps it: a held host is `sshConnected`; no held connection is `local`;
  a lost one is `sshDisconnected`.
- **R2. Kill Current** (`cleanCurrentRemoteServer`), registered in `register-connect.ts`'s map beside
  `cleanRemoteServer`:
  - **Not connected** (local or disconnected window, F-2411 6.5, AC-22): it does nothing. It shows nothing and writes
    nothing, and the promise resolves.
  - **Connected, the plan of `killCurrentPlan(!terminalMode)`.** Default mode (6.1, AC-19, AC-29), which is
    connect-11's reading of Q1 option (a), the reference:
    1. `killLocalServer(<own host string>)` stops the local connection server for the host and forgets its stored
       details, as the picked-host Kill does for its host;
    2. S085 "Killed VS Code Server on {0}." with {0} = the window's host alias, and the button "Open Logs". It isn't
       awaited;
    3. the same window becomes an empty local window: `executeCommand('vscode.newWindow', {reuseWindow: true,
       remoteAuthority: null})` through the editor port.

    Core's save prompt and its outcomes are core's. No server process on the host is stopped.
  - **Terminal or socket mode** (6.2, AC-20): `perform('kill', <own target>)` over a new connection, then S085 (or
    S076 when the connection failed, as Kill on Host… does). The window stays. Core's later "Cannot reconnect" dialog
    is core's.
- **R3. The own alias in Kill on Host…** (6.7, AC-21): when the picked target's host equals `heldHost()`'s, compared
  as F-2411 6.7 does (the alias as written), the handler runs R2's connected branch instead of the other-host flow.
- **R4. The own host in Uninstall…** (F-2412 6.1): the same, with `uninstallOwnHostPlan`. In default mode,
  `killLocalServer`, no notice, and the switch to an empty local window. In terminal mode, the uninstall over a new
  connection, as today.
- **R5.** No setting is written in any branch (F-2411 AC-23).

**A question for athena, F-2411 Q1:** R2's default mode copies the reference (the window turns local, and the server
keeps running), as connect-11 decided. If Q1 is ruled (b), stop the server over a new connection first, and only the
plan changes.

## 3. Changes

| File | Change |
|---|---|
| `packages/remote-ssh/src/pipeline/connector.ts` | `heldHost()` (R1), from the `input` and the `terminalMode` the connect already has |
| `packages/remote-ssh/src/maintenance/maintenance-commands.ts` | `cleanCurrentRemoteServer` (R2), and R3 and R4 in the two existing handlers. The ports gain `heldHost` and `switchToLocalWindow` |
| `packages/remote-ssh/src/register-connect.ts` | the command in the map, and the two ports wired: `assembly.connector.heldHost`, and `vscode.newWindow` through the connect editor |
| `packages/remote-ssh/src/maintenance/own-host.ts` | used as it is. Change it only if a row shows its plan is wrong, and report that |

## 4. Rows

**Unit rows** (`maintenance-commands.test.ts`, `connector.test.ts`, with the existing fakes):

| Cite | Given | Expected |
|---|---|---|
| F-2411.AC-22 | Kill Current with `heldHost()` `undefined` | no `perform`, no `killLocalServer`, no notice, no window switch |
| F-2411.AC-19 | Kill Current connected in default mode | `killLocalServer` with the own host string, S085 with the alias, then `switchToLocalWindow`; no `perform` |
| F-2411.AC-20 | Kill Current connected in terminal mode, `perform` answering `stepRan` | `perform('kill', <own target>)`, then S085; no switch |
| F-2411.AC-20 | the same with `connectionFailed` | S076; no switch |
| F-2411.AC-21 | Kill on Host… picking the window's own alias, default mode | as AC-19's row |
| F-2412 6.1 | Uninstall… picking the own host, default mode | `killLocalServer`, no notice, the switch |
| F-2411 R1 | the connector after a connect in terminal mode, then after `lost` | `heldHost()` gives the target with `terminalMode: true`, then `undefined` |

**Acceptance row** (VSCodium, the `windows` launch, a new file `tests/acceptance/windows/kill-current.test.ts`):
- **Steps:** `openWindow('harness', 'kc1')`, wait until it's connected, note the server's process ids on the host (the
  processes whose arguments carry the commit's server folder), then `inWindow('kc1', 'opensshremotes.cleanCurrentRemoteServer')`.
- **Expected:** `kc1` deactivates within 5 s, and a window without a folder activates under the next free claim
  (tooling-28): `windowState` gives `remoteName` `null`. The noted server processes still run (AC-19, the reference).
  No `failed` event for the command.
- **Name:** `F-2411 AC-19: Kill Current in a connected default-mode window turns it into an empty local window and the server keeps running`.
- **It must fail on main** (the command isn't registered, so `inWindow` fails with "not found"), and pass with the fix.

## 5. Gates and review

All gates, the changed files at 100 %, and the VSCodium run green. PR title `remote-ssh: Kill Current VS Code Server is
registered, with its own-host plans (card connect-43, #681)`. themis or triton reviews; athena gives the design check,
Q1 included.

## 6. Open rows (stop and report on #681)

1. `vscode.newWindow` with `remoteAuthority: null` doesn't turn the same window local in the pinned VSCodium. Report what
   it does, and use `workbench.action.remote.close` only if athena agrees.
2. Comparing the picked host with the window's own host (R3) needs more than the alias as written, for example a typed
   `user@host` against an alias. Report the case. The card compares the alias only.
