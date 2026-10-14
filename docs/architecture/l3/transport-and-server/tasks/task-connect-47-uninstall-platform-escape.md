# Task card connect-47: Uninstall ends silently on Escape at the platform pick

Issue: #742. Release 0.2, **gating**: F-2206 AC-33 (`remote-oss/remote-ssh#33`, 6.8) is a slice-1 criterion. Size: S.
Builder: selene. Found while revising coverage-12 for dike's review of #723. coverage-12's AC-33 Escape row (#551) waits
on this card.

## 1. The defect

**The rule:** F-2206 AC-33. In non-local mode with no stored entry, Uninstall VS Code Server from Host... shows the
platform picker. After Escape, "the command ends without dialog, notification or change on the host".

**What main does:**
1. The platform step answers a dismissed pick with `{kind: 'failed', failure: {kind: 'cancelled', reason: {id:
   'S027'}}}` (`pipeline/terms-steps.ts`).
2. `runMaintenance` (`maintenance/maintenance-run.ts`) turns any failed `decideTerms` into `connectionFailed`.
3. `cleanDevBox` (`maintenance/maintenance-commands.ts`) throws `new Error(UNINSTALL_FAILED)` on `connectionFailed`,
   so core shows "Command '…' resulted in an error".

## 2. The fix

1. **`maintenance-run.ts`:** `MaintenanceRun.result` becomes `StepResult | 'cancelled'`. When `decideTerms` fails with
   `failure.kind === 'cancelled'`, `runMaintenance` returns `{result: 'cancelled', cause: 'the platform pick was
   dismissed'}`, before any connection is opened. Every other failed step stays `connectionFailed`.
2. **`maintenance-commands.ts`:**
   - **`cleanDevBox`:** on `cancelled`, return. Nothing is thrown, logged at warn, noticed, or ended locally
     (`killLocalServer` isn't called).
   - **`cleanRemoteServer` (kill):** handles `cancelled` as it handles `connectionFailed` today: logged at warn, the
     `killFailed` notice, and no `killLocalServer`. athena ruled that S076 after Escape agrees with F-2411 7.E5. So
     change its test to `outcome.result !== 'stepRan'`, and leave its behaviour unchanged.
3. `StepResult` (`own-host.ts`) and `killResult` don't change.
4. **If connect-43 (#748) has merged first:** it moves the two bodies into `killOnHost(target)` and
   `uninstallOnHost(target)`, which `cleanRemoteServer`, `cleanDevBox` and `cleanCurrentRemoteServer` (through
   `killOwnHost` and `uninstallOwnHost`) all call. Apply the same rule there:
   - `killOnHost` tests `outcome.result !== 'stepRan'` where it tests `=== 'connectionFailed'`;
   - `uninstallOnHost` returns on `cancelled` before its `connectionFailed` test.

   The type checker doesn't catch a missed spot, because `=== 'connectionFailed'` still compiles with the wider union.
   So grep `maintenance-commands.ts` for `'connectionFailed'` after the change: every remaining test must be one where
   `cancelled` is meant to fall through. If connect-43 merges after this card, its builder applies this point, and
   this card's rows then catch a miss.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `maintenance-run.test.ts` | `F-2206 AC-33: a dismissed platform pick is a cancelled run, and no connection is opened` | `perform('uninstall', {decideTerms: () => Promise.resolve({kind: 'failed', failure: {kind: 'cancelled', reason: {id: 'S027'}}})})` | `outcome.result` is `'cancelled'`; the recording has no `openConnection` |
| `maintenance-run.test.ts` | the existing `F-2411.7.E2: terms that were not decided are a failed connection` | unchanged (its failure is `invalidSetting`) | still `connectionFailed` |
| `maintenance-commands.test.ts` | `F-2206 AC-33: Escape at the platform pick ends the uninstall with no error, notice or local end` | `setup({outcome: {result: 'cancelled', cause: 'the platform pick was dismissed'}})`; `await scenario.uninstall()` | it resolves (no rejection); `scenario.notices` is `[]`; `scenario.ended` is `[]`; no warn line |
| `maintenance-commands.test.ts` | `F-2206 AC-26: Escape at the platform pick ends the kill with the kill-failed notice and no local end` | the same outcome; `await scenario.kill()` | the notices are the ones the existing `connectionFailed` kill row gives; `scenario.ended` is `[]` |

| `maintenance-commands.test.ts` | `F-2206 AC-26: Kill Current with Escape at the platform pick ends no local server` (only once connect-43 is on main; otherwise connect-43's builder adds it) | Kill Current in a window whose plan acts on the host (`heldHost` set, terminal mode), with the outcome `cancelled` | `scenario.ended` is `[]`, the kill-failed notice is shown, and no switch to a local window happens |

**Defect rule:** the two `F-2206 AC-33` rows must fail on main and pass with the fix. Paste both runs.

## 4. Catalogue

No tag changes here: coverage-12's acceptance rows tag AC-26 and AC-33.

## 5. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage,
with the changed files at 100 %. Use the PR title
`remote-ssh: Uninstall ends silently on Escape at the platform pick (card connect-47, #742)`. themis or triton reviews;
athena gives the design check.

## 6. Open rows (stop and report on #742)

1. In the maintenance run, `decideTerms` reports a dismissed pick as something other than `cancelled`. Report what it
   gives.
