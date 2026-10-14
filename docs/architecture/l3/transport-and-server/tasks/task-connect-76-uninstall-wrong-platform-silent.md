# Task card connect-76: a wrong platform answer ends the uninstall silently

Issue: #859. Gating: milestone 0.2 (D-86 puts F-2412 in 0.2). F-2412 6.2 step 1, 7.E11, BR-5 and AC-32. Size: S.
Builder: `task:local`.

## 1. The defect

coverage-40 measured it (#728, comment 6161780611). With `remote.SSH.useLocalServer` false and a server running on
`harness`, uninstall `harness` and answer "Windows" on the platform pick. The command fails with core's error dialog
(`Failed to run command`), and the log says `the uninstall failed: the probe failed: channelFailed`.
- **AC-32 and 7.E11:** no message appears, and nothing is stopped, removed or created on the host.
- **BR-5:** the result is silent whenever the remote step ran. Core's command-error surface (7.E1, 7.E5) is only for
  when the SSH connection itself failed.

**The cause:**
- `packages/remote-ssh/src/maintenance/maintenance-run.ts:111-118`: after `openConnection` worked, a failed probe and a
  failed step both return `failed(…)`, which is `result: 'connectionFailed'` (`:69-71`).
- `maintenance-commands.ts:129-138`, `uninstallOnHost`: it throws `UNINSTALL_FAILED` on `connectionFailed`.

## 2. The fix

1. **`own-host.ts:65`:** `export type StepResult = 'stepRan' | 'stepFailed' | 'connectionFailed';`.
   - JSDoc: "`stepFailed`: the connection opened, but the probe or the step did not work on the host."
   - `killResult` is unchanged: `stepRan` gives `killed`, and anything else gives `killFailed`.
   - `uninstallResult` returns `'silent'` for `stepRan` and `stepFailed`, and `'commandError'` for `connectionFailed`.
2. **`maintenance-run.ts`:**
   - Add, beside `failed`:

     ```ts
     function stepFailed(cause: string): MaintenanceRun {
       return {result: 'stepFailed', cause};
     }
     ```

   - Line 113 returns `stepFailed(`the probe failed: ${probed.failure.kind}`)`, and line 118 returns
     `stepFailed(`the ${action} did not run: ${outcome.kind}`)`.
   - Everything before `openConnection` worked (the checks, `locateClient`, `decideTerms`, `openConnection`) still
     returns `failed`.
   - Update the `MaintenanceRun` JSDoc (line 12) to name the three results.
3. **`maintenance-commands.ts`, `uninstallOnHost`:**

   ```ts
   async function uninstallOnHost(target: SshTarget): Promise<void> {
     const outcome = await ports.perform('uninstall', target);
     if (outcome.result === 'cancelled') {
       return;
     }
     if (outcome.result !== 'stepRan') {
       ports.logger.warn(`the uninstall failed: ${outcome.cause}`);
       if (outcome.result === 'connectionFailed') {
         throw new Error(UNINSTALL_FAILED);
       }
       return;
     }
     await ports.killLocalServer(payloadOf(target));
   }
   ```

   - With `stepFailed`, the host's server wasn't touched, so the local connection server isn't ended either.
4. **`killOnHost` is unchanged.** It already shows `killFailed` for anything but `stepRan`, so Kill behaves as before.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `maintenance-run.test.ts` | rename the row at line 156 to `F-2412 BR-5: a probe that failed after the login is a failed step, with the lease given back` | as now | `['stepFailed', 1, false]` |
| `maintenance-run.test.ts` | rename the row at line 167 to `F-2412 BR-5: a step that did not finish is a failed step, with the lease given back` | as now | `['stepFailed', 1]` |
| `maintenance-run.test.ts` | `F-2412 BR-5: a login that failed is still a failed connection` | `openConnection` fails | `result` is `connectionFailed` |
| `maintenance-commands.test.ts` | `F-2412 AC-32: an uninstall whose step failed on the host shows nothing and ends nothing` | `outcome: {result: 'stepFailed', cause: 'the probe failed: channelFailed'}` (a new `STEP_FAILED` beside `FAILED`) | `uninstall()` resolves; no notice; `ended` is `[]`; one warn line `the uninstall failed: the probe failed: channelFailed` |
| `maintenance-commands.test.ts` | `F-2411.AC-14: a kill whose step failed on the host shows the kill-failed notice` | `outcome: STEP_FAILED`, then `kill()` | the `killFailed` notice; `ended` is `[]` |
| `own-host.test.ts` | extend the rows at lines 117 and 124 | `uninstallResult('stepFailed')` and `killResult('stepFailed')` | `'silent'`, `'killFailed'` |

The existing `FAILED` rows (lines 257-296) stay as they are, with `connectionFailed`. The two renamed rows and the
`AC-32` row fail on main.

**Acceptance:** coverage-40's row 16 (`docs/architecture/tooling-tasks/task-coverage-40-uninstall-rows.md` on
`origin/feature/coverage-40`), added to `tests/acceptance/windows/uninstall.test.ts` in
`describe('with remote.SSH.useLocalServer false')`, after the AC-31 row, with the name
`F-2412 AC-32: Windows answered for a Linux host shows nothing and changes nothing`.
- **Setup:** `makeDataFolder()`, and a running server: `perWindowMode(true)`, `openConnected('u1', INSTALL_MILLISECONDS)`,
  then `const servers = await serverProcesses()`.
- **Then:** `uninstallWith('local', [pickHost('harness'), platform('windows')])`. It must resolve, not throw.
- **Pass:** `surfacesSince(mark, 'local')` is `['hostPick', 'platformPick']`; after 2 s, `serverProcesses()` equals
  `servers` and `existsOnHost(DATA_FOLDER)` is true. Close `u1` with `closeAllButLocal()` at the end.
- **On main** the run throws `Failed to run command`.
- If coverage-40 hasn't merged, build on its file from `origin/feature/coverage-40`.

## 4. Gates and review

Run all gates and the VSCodium run. PR title `remote-ssh: a wrong platform answer ends the uninstall silently (card
connect-76, #859)`. Request athena only.
