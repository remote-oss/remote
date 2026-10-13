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
- `validate` keeps the target check only.
- A third step, `checkInstallFolder(input): StepResult<undefined>`, holds the install-folder check (`installPathProvided`),
  moved unchanged from `validate`.

**Which run checks the install folder** (athena on #654):
- Uninstall never reads `remote.SSH.serverInstallPath` (F-2412 §10, V8), so it skips the check.
- Kill acts on the data folder that setting names, so an invalid value means the folder can't be known: Kill keeps
  the check.

**Wiring:** `wiring.ts` wires `checkStartSettings` and `checkInstallFolder` like `validate`
(`input => serverSteps(input).<step>(input)`).

**The connect** (`pipeline/connect.ts`) calls `checkStartSettings(input)`, `validate(input)` and
`checkInstallFolder(input)`, in that order, right after `onPhase({kind: 'initializing'})`. A failure of any of them
returns its failure as `validate`'s does today. #651's order holds: range, then bind host, then target, then install
folder.

**The maintenance run:** `MaintenanceSteps` gains `checkInstallFolder` (not `checkStartSettings`). `runMaintenance`
calls `validate(input)`, then, for `kill` only, `checkInstallFolder(input)`. A failure of either is
`connectionFailed` with the cause `the target is not valid: <kind>`, as today. Then it goes on as today.

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
| F-2412 §10 | an uninstall run whose `checkInstallFolder` fails `invalidSetting` (reason `installPathProvided`) | `stepRan`; the calls hold no `checkInstallFolder` |
| F-2411 §10 | a kill run whose `checkInstallFolder` fails the same way | `connectionFailed`; the calls end at `checkInstallFolder`, with nothing after it |
| F-2407 | `checkInstallFolder` with an invalid install folder set; `validate` with the same | the `installPathProvided` failure (the row moved from `validate`); `validate` is done |
| F-2407 | the connect with `checkInstallFolder` failing | that failure is the connect's, after `checkStartSettings` and `validate` ran |

**Mutations to run, and list in the PR:**
- the maintenance run calling `checkStartSettings`: the F-2411 row fails;
- the connect calling `validate` before `checkStartSettings`: the order row fails;
- the bind-host notice left in `validate`: the 7.E1 row fails;
- the uninstall calling `checkInstallFolder`: the F-2412 row fails;
- the kill skipping it: the F-2411 row fails.

## 4. Gates and review

All gates, with `server-steps.ts`, `connect.ts`, `wiring.ts` and `maintenance-run.ts` at 100 %, and the VSCodium run
green. PR title `remote-ssh: Kill and Uninstall skip the server-start settings' checks (card connect-36, #653)`.
themis or triton reviews; athena gives the design check (a new pipeline step).

## 5. Open rows (stop and report on #653)

1. A connect row on main that depends on `validate` showing the bind-host notice: report it, and move it to
   `checkStartSettings` like the others.
