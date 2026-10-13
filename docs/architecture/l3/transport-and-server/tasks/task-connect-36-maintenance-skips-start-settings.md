# Task card connect-36: Kill and Uninstall skip the server-start settings' checks

Issue: #653. Release 0.2, low priority: behind the 0.2 gate work. Builder: iris or hestia. Size: S. **Depends on:**
#651 (connect-26) merged.

## 1. Why

**Where it comes from:** connect-26 (#651) made the connect's `validate` step (`remote-ssh/src/pipeline/server-steps.ts`)
check, in this order:
1. `remote.SSH.serverPickPortsFromRange` for the host: a reversed range fails `invalidSetting` with the reason
   `reversedPortRange`, and a malformed one fails `invalidSetting` with no reason;
2. `remote.SSH.bindHost`: a refused value shows the S168 notice through `rejectBindHost`, and the step goes on;
3. the target, then the install folder, as before.

**The problem:** the maintenance run of Kill and Uninstall (`remote-ssh/src/maintenance/maintenance-run.ts`,
`runMaintenance`, #589/#608) calls the same `validate` first. So:
- a bad range in the host's setting makes "Kill VS Code Server on Host..." and "Uninstall VS Code Server from Host..."
  fail as `connectionFailed`;
- a refused bind host shows its notice on every Kill.

Neither setting is a configuration input of F-2411 (remote-oss/remote-ssh#56 §10) or F-2412 (#57 §10). Both are
F-2409's, and decide how a server starts (themis on #651).

## 2. The change

**Steps:** `ConnectSteps` (`remote-ssh/src/pipeline/steps.ts`) gains one step before `validate`:

```ts
/** The settings that decide how the server starts, checked before anything runs; a window's connect alone runs it. */
checkStartSettings(input: ConnectInput): StepResult<undefined>;
```

- `checkStartSettings` holds the range check and the bind-host notice, moved unchanged from `validate`: same order,
  same failures, same notice.
- `validate` keeps the target check and the install-folder check, unchanged.

**Wiring:** `wiring.ts` wires `checkStartSettings: input => serverSteps(input).checkStartSettings(input)`, beside
`validate`.

**The connect** (`pipeline/connect.ts`) calls `checkStartSettings(input)` and then `validate(input)`, both right after
`onPhase({kind: 'initializing'})`. A failure of either returns its failure as `validate`'s does today. #651's order
holds: range, then bind host, then target.

**The maintenance run:** `MaintenanceSteps` stays as it is, without `checkStartSettings`, and `runMaintenance` is
unchanged.

**Fixture:** `test/unit/pipeline.fixture.ts`'s `steps(...)` records `checkStartSettings` like the other steps.

## 3. Rows

**Moved rows:** the rows of `server-steps.test.ts` that test the range and the bind host through `validate` (F-2409
7.E1, BR-2, the reversed and malformed ranges, the notice and its absence) call `checkStartSettings` instead,
unchanged otherwise.

**New rows:**

| Cite | Given | Expected |
|---|---|---|
| F-2409 BR-2 | `validate` with a reversed range set for the host | `{kind: 'done', value: undefined}` (the range is no longer its check) |
| F-2409 7.E1 | `validate` with a refused bind host | done, and no notice shown |
| F-2409 BR-2 | the connect (`connect.test.ts`) with all steps working | the recorded calls start `checkStartSettings`, `validate` |
| F-2409 BR-2 | the connect with `checkStartSettings` failing `invalidSetting` (reason `reversedPortRange`) | that failure is the connect's, and `validate` wasn't called |
| F-2411 §10 | a maintenance run (`maintenance-run.test.ts`) with `checkStartSettings` replaced by a step that fails | the run is `stepRan`, and the calls are exactly today's list (`validate` … `kill`), without `checkStartSettings` |
| F-2412 §10 | the same for `uninstall` | `stepRan` |

**Mutations to run, and list in the PR:**
- the maintenance run calling `checkStartSettings`: the F-2411 row fails;
- the connect calling `validate` before `checkStartSettings`: the order row fails;
- the bind-host notice left in `validate`: the 7.E1 row fails.

## 4. Gates and review

All gates, with `server-steps.ts`, `connect.ts`, `wiring.ts` and `maintenance-run.ts` at 100 %, and the VSCodium run
green. PR title `remote-ssh: Kill and Uninstall skip the server-start settings' checks (card connect-36, #653)`.
themis or triton reviews; athena gives the design check (a new pipeline step).

## 5. Open rows (stop and report on #653)

1. **The install-folder check.** F-2412 §10 says `remote.SSH.serverInstallPath` isn't honoured by Uninstall, and
   F-2411 §10 doesn't list it. Whether the install-folder check belongs in `checkStartSettings` too is athena's call.
   This card leaves it in `validate`. Report it in the PR. Don't move it.
2. A connect row on main that depends on `validate` showing the bind-host notice: report it, and move it to
   `checkStartSettings` like the others.
