# Task card connect-11: kill and uninstall on the window's own host, and what each outcome shows (pure)

Brief: slice 3 (#42). Specs: F-2411 (`remote-oss/remote-ssh#56`) BR-2, BR-5, BR-8, BR-10 and 6.1 to 6.2; F-2412 (`#57`)
BR-1, BR-5, BR-6, BR-7 and 6.1 to 6.2; F-2410 (`#55`) BR-2. Reviewing coder: `remote-coding-worker-1`. Depends on
nothing; card connect-10 owns the sibling file `src/maintenance/target.ts`.

## 1. Package and file boundary

`packages/remote-ssh/src/maintenance/own-host.ts`, test `packages/remote-ssh/test/unit/own-host.test.ts`. Neither exists on main.
Do not touch `host-picker.ts` or `src/report/`. Pure. Nothing else changes.

## 2. Contract

```ts
export type WindowKind = 'local' | 'sshConnected' | 'sshDisconnected';
export type CommandNotice = 'killed' | 'killFailed' | 'none';
export interface OwnHostPlan {
  opensConnection: boolean;          // a new SSH connection to the host is made
  actsOnHost: boolean;               // the kill or uninstall step runs on the host
  switchesToLocalWindow: boolean;    // the same window becomes an empty local window
  forgetsStoredDetails: boolean;
  notice: CommandNotice;
}
export function killCurrentAvailable(window: WindowKind): boolean;
// true only for 'sshConnected'
export function killCurrentPlan(effectiveUseLocalServer: boolean): OwnHostPlan;
export function uninstallOwnHostPlan(effectiveUseLocalServer: boolean): OwnHostPlan;
// effectiveUseLocalServer is false in socket mode (the caller applies the rule of card forwarding-04)
export type StepResult = 'stepRan' | 'connectionFailed';
export function killResult(result: StepResult): CommandNotice;     // stepRan: 'killed'; connectionFailed: 'killFailed'
export function uninstallResult(result: StepResult): 'silent' | 'commandError';
```

Plans. `killCurrentPlan(true)`: opensConnection false, actsOnHost false, switchesToLocalWindow true,
forgetsStoredDetails true, notice `killed`. `killCurrentPlan(false)`: opensConnection true, actsOnHost true,
switchesToLocalWindow false, forgetsStoredDetails true, notice `killed`. `uninstallOwnHostPlan(true)`: opensConnection
false, actsOnHost false, switchesToLocalWindow true, forgetsStoredDetails true, notice `none`.
`uninstallOwnHostPlan(false)`: opensConnection true, actsOnHost true, switchesToLocalWindow false, forgetsStoredDetails
true, notice `none`.

## 3. Test table

| Citation | Given | Expected |
|---|---|---|
| F-2411.AC-1 | `killCurrentAvailable` for `local`, `sshConnected`, `sshDisconnected` | false, true, false |
| F-2411.BR-10 | `killCurrentPlan(true)` | the first plan above (no connection, nothing on the host, window switches) |
| F-2411.BR-10 | `killCurrentPlan(false)` | the second plan (connection, host acted on, window stays) |
| F-2411.BR-10 | both plans | `notice` is `killed` in every mode |
| F-2411.BR-8 | both kill plans | `forgetsStoredDetails` true |
| F-2410.BR-2 | `killCurrentPlan(effective)` with the caller's `effective` false for a socket-mode window | the `false` plan |
| F-2412.BR-6 | `uninstallOwnHostPlan(true)` | the third plan (nothing removed, window switches, no notice) |
| F-2412.BR-6 | `uninstallOwnHostPlan(false)` | the fourth plan (connection, removal runs, window stays) |
| F-2412.BR-1 | both uninstall plans | `notice` is `none` |
| F-2412.BR-7 | both uninstall plans | `forgetsStoredDetails` true |
| F-2411.BR-5 | `killResult('stepRan')` / `killResult('connectionFailed')` | `killed` / `killFailed` |
| F-2412.BR-5 | `uninstallResult('stepRan')` / `uninstallResult('connectionFailed')` | `silent` / `commandError` |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `remote-ssh: own-host kill and uninstall plans (card connect-11)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

1. Whether the reimplementation really stops the server in default-mode Kill Current and Uninstall of the own host, or
   copies the reference (F-2411 Q1, F-2412 Q1): this card copies the reference as the spec describes it.
2. The platform pick of F-2412 6.2 (when it appears for a host the window is not on, with `useLocalServer` true) is not
   in this card.
