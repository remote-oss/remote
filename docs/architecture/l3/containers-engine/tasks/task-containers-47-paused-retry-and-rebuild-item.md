# Task card containers-47: C8's Retry starts a paused container, and More Actions... offers Rebuild Container

Issue: #1064. Milestone 0.4, containers release 1. Size: M. Builder: `task:claude`.
Design: athena's rulings 12 and 14 on #737, recorded as `brief-release-1.md` §3 rulings 12 to 14 in #1062. Ruling 14
reverses containers-11 §3.5 (the four-item pick). Card containers-46 (#1060) has the rows of the other F-0409
criteria; this card brings AC-22's rows and the rest of AC-34's.

Sources: F-0409 (remote-oss/remote-containers#23) 6.3, 6.5, 7.E1, 7.E6, BR-4, BR-13, AC-7, AC-22, AC-34; F-0410
(#28) 5.0 step 4, 7.E2, BR-4, BR-8, AC-5, AC-6, AC-11b, AC-12b; cards containers-11 (C8, the timed store), containers-14 (the rebuild commands and their intent).

## 1. The rules

1. **A paused container fails as today, unless Retry asked for it** (ruling 12). C7's decision for a paused matching
   container is `unusable` (`lifecycle/labels.ts`), and the connect fails into F-0410's generic dialog (S034, AC-7),
   leaving it paused. That stays the outcome of every connect, except the one that follows C8's Retry on that very
   container.
2. **C8's Retry records the paused container's id** before it returns `'reload'`: a timed entry (containers-11's
   `state/timed-store.ts`, five minutes) under the key `remote-oss.remote-containers.pausedRetries`, entry name the
   full container id, value `true`.
3. **The next connect takes the entry once.** When C7's decision is `unusable` with status `paused`, and an entry for
   that id is taken, C7 runs `docker stop <id>` through C2's engine, then continues as for an `exited` container
   (the CLI's `up` starts it with the same id, and the connect goes on). A `docker stop` that fails ends the connect
   as `containerSetupFailed` with no refusal (S034), and the container is left as Docker left it.
4. **Rebuild Container in More Actions...** (ruling 14): when the failed connect had a matching container, the pick's
   items are, in order, `Reload Window`, `Rebuild Container`, the Edit item (when there's a target),
   `Open Recent...`, `Open Documentation`. Without a container, the pick keeps today's four items. `Rebuild
   Container` runs containers-14's command `remote-containers.rebuildContainer` in this window, which stores the
   rebuild intent and reloads.

## 2. The change

**The failure's container (C10 → C8).** C8 has no way today to know the container the failed connect found. Add one
window-scoped fact, set by the connector on every failed connect and cleared on every connect that succeeds:

```ts
/** The container a failed connect of this window found, for C8: its id and whether it was paused; none when it found none. */
export interface FailedContainer {
  containerId: string;
  paused: boolean;
}
```

- `connect/failures.ts`: `containerUnusable()` takes the decision's status. For `paused` it's a new kind
  `containerPaused`, still with the reason S034 (the dialog doesn't change); every other unusable status keeps
  `containerUnusable`.
- `connect/connector.ts` keeps `FailedContainer | undefined` in a holder object it's given (`failedContainer: {current?:
  FailedContainer}`), written in `failureOf` from the outcome (C7's outcomes that know a container id: `unusable`,
  `setupFailed` after a container was found, and the later steps where `prepared.containerId` exists), and set to
  `undefined` when the connect ends `connected`. `register-connector.ts` creates the holder once per window and hands
  it to both the connector and the presenter.
- `lifecycle/container-lifecycle.ts`: `ContainerRequest` gains `pausedRetry: (containerId: string) =>
  Promise<boolean>`, which the connector builds over `takeTimedEntry` (it takes the entry once and says whether there
  was one). `prepare` calls it only for an `unusable` decision with status `paused`; on `true` it stops the container
  (C2's engine; add `stop(containerId)` to its port beside the existing calls, spawned without a shell as every engine
  command is) and goes on as `use` with status `exited`.
- `surfaces/recovery-presenter.ts`: `RecoveryPorts` gains `storePausedRetry(containerId: string): PromiseLike<void>`
  and `rebuildContainer(): PromiseLike<unknown>`. On Retry, when the holder says `paused`, it stores the entry and
  then returns `'reload'`; a failed store is logged and the reload still happens. `quickPickOf` takes whether a
  container exists, and adds the item; `showQuickPick` runs `rebuildContainer()` for it.
- `surfaces/failure-strings.ts`: the item's label is S285, `Rebuild Container` (F-0410 BR-4; the id containers-11
  §3.5 names).
- `extension.ts`: the two new ports (the timed store over `context.globalState`; `vscode.commands.executeCommand(
  'remote-containers.rebuildContainer')`).

## 3. Rows

**Unit**: the timed entry stored on Retry for a paused failure and not for another; taken once (a second connect fails
into AC-7 again); the stop-then-use path and its failing stop; `containerPaused`'s dialog equal to
`containerUnusable`'s; the pick with and without a container, in order; Rebuild Container runs the port; the holder
cleared on success. Every branch of the changed files at 100 %.

**Acceptance** (add to `tests/acceptance/containers/reuse.test.ts`, next to containers-46's rows; folders `c47-`):

| # | Name | Setup | Assertions |
|---|---|---|---|
| P1 | `F-0409 AC-22 (p22): Retry on the paused container's dialog connects to the same container, now running` | containers-46 R1's setup (a paused container, reopen, the dialog) | `answerDialog(name, 'Retry')`, `connectedToContainer(name, DIALOG_MILLISECONDS)`; `devContainersOf(folder)` is `[<id>]`; `inspectOf(id).status` is `running` |
| P2 | `F-0409 AC-7, ruling 12 (p7b): without Retry, a second reload of a paused container fails again and leaves it paused` | P1's setup up to the dialog; then answer `More Actions...`, Escape the pick, and reload the window | the same dialog again; the container is `paused` |
| P3 | `F-0409 AC-34 (p34b): More Actions... offers Rebuild Container when the container exists, and it connects the window to a new container` | containers-46 R5's setup (exited, bind source gone, the S018 dialog); delete the `mounts` entry from the configuration; `answerDialog(name, 'More Actions...')` | the pick's items are `Reload Window`, `Rebuild Container`, `Edit devcontainer.json Locally`, `Open Recent...`, `Open Documentation`; choosing `Rebuild Container` (the pick helper of `windows/renderer.ts`; add one that chooses an item by label if it has none) connects the window; `devContainersOf(folder)` is one id other than `<id>`, and `<id>` no longer exists |
| P4 | `F-0410 AC-12b (p12b): after a port conflict leaves a created container, Retry starts that same container` | containers-11's r3 setup (`recovery.test.ts`: a port already published, the S019 dialog, the `Created` container left); then `answerDialog(name, 'Retry')` | measure first. The spec expects the same container id started, and the window connected or the S019 dialog again; assert what the product does if it is one of those two, else it's an open row |

P3 also cites F-0410 AC-6 and AC-11b (its name starts `F-0409 AC-34, F-0410 AC-6, AC-11b (p34b): …`). The "absent"
half of F-0410 AC-6 is containers-11's r4 row and the b25 row of `reuse.test.ts` (F-0405 AC-25): both fail before a
container exists (a rebuild removes the old container first, F-0405 BR-17), so their four items stay right. Add
`F-0410 AC-6` to the start of r4's name.

**The catalogue (`coverage-containers-r1.tsv`):** F-0409 AC-22 and AC-34 and F-0410 AC-6, AC-11b and AC-12b become
`acceptance` (their `deferred` reason, "the More Actions... rebuild item is the recovery path, later", goes).

**containers-11's card:** in `task-containers-11-recovery-dialog.md` §3.5, replace the "Not in release 1" bullet with
one line: `"Rebuild Container" (S285) is added by containers-47 (#1064), athena's ruling 14 on #737.`

## 4. Gates, review and open rows

All gates; the `containers` launch locally. PR title: `remote-containers: Retry starts a paused container, and More
Actions... offers Rebuild Container (card containers-47, #1064)`. Request athena only; hermes assigns the peer.

**Open rows (stop and report on the issue):** `docker stop` refuses a paused container on the run's engine; the
rebuild command doesn't run in a window whose connect failed; r4's or b25's failure turns out to have a container;
P4 shows neither outcome.
