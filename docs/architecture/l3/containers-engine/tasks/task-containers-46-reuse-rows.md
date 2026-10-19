# Task card containers-46: F-0409's reuse rows: a paused container, an older configuration, a missing bind source

Issue: #1060. Milestone 0.4, containers release 1. Size: S. Builder: `task:local`. Every row is spelled out below,
and its expected values were measured on 2026-10-19 with the pinned CLI and Docker 29 (main at 4984f4c5, with #1046
for row R6's texts). If something on main doesn't match, stop and report on the card's issue (§4).

**What this card is:** acceptance rows only, in `tests/acceptance/containers/reuse.test.ts`, and the catalogue lines.
No product code changes. Don't change the product or an expected value.

**Build after** #1046 is on main (row R6 asserts the connecting toast's exact texts).

Sources: F-0409 (remote-oss/remote-containers#23): 6.1, 6.3, 6.5, 6.10, 7.E1, 7.E6, BR-6; AC-7, AC-26, AC-34, AC-35,
AC-44, AC-45.

## 1. Where and with what

Add the rows to the `describe` of `tests/acceptance/containers/reuse.test.ts`, after the last `it`. Use the file's
own helpers: `inspectOf`, `containerOf`, `reopened`, `containerLeftBy`, `dialogText`, `S034`, `RECOVERY_BUTTONS`,
`DIALOG_MILLISECONDS`; and from `windows/`: `devContainerFolder`, `devContainersOf`, `openFolderWindow`,
`removeContainers`, `closeWindow`, `reopenStarted`, `connectedToContainer`, `waitForDialog`, `answerDialog`,
`windowTitle`, `statusItem`, `notifications`, `variable`, `runLabelArguments`. Add the ones the file doesn't import
yet to its import lists. Write no helper that duplicates one.

Each row's folder name starts `c46-`. Each row removes its containers in `finally` (`removeContainers`), after
`docker unpause` where it paused one (ignore that command's failure). A row that opened a window closes it in `try`,
before the assertions.

Add one constant beside `S034`:

```ts
/** F-0410's detail for a mount Docker refuses (S018), as `failure-strings.ts` has it. */
const S018 =
  'A mount config is invalid. Make sure it has the right format and a source folder that exists on the machine where the Docker daemon is running.';
```

## 2. The rows

| # | Name | Setup | Assertions |
|---|---|---|---|
| R1 | `F-0409 AC-7 (p7): a paused container shows F-0410's generic dialog after the reload, and no "Container is paused." text` | `devContainerFolder('c46-paused', {name: 'Paused'})`; `const id = await containerLeftBy(folder)`; `docker pause <id>`. `openFolderWindow`, `reopenStarted`, `waitForDialog(name, DIALOG_MILLISECONDS)` | `dialogText(dialog)` is `['', S034, RECOVERY_BUTTONS]`; `windowTitle(name)` is `[c46-paused [Dev Container: Paused]]`; `(await statusItem(name, 'status.host')).text` is `Opening Remote...`; `devContainersOf(folder)` is the one id, and `inspectOf(id).status` is `paused` |
| R2 | `F-0409 AC-26 (p26): a container made from an older configuration is reused, without the new containerEnv, under the new name` | `devContainerFolder('c46-older', {name: 'Old Name'})`; `const id = await containerLeftBy(folder)`. Rewrite `<folder>/.devcontainer/devcontainer.json` as `JSON.stringify({image: variable('HARNESS_DEVCONTAINER_IMAGE'), runArgs: runLabelArguments(), name: 'New Name', containerEnv: {C46: 'yes'}})`; `docker stop <id>`. Then `reopened(folder)` | `devContainersOf(folder)` is `[<id>]`; `windowTitle(name)` is `[c46-older [Dev Container: New Name]]`; the indicator is `Dev Container: New Name`; `docker exec <id> sh -c 'echo "C46=$C46"'` prints `C46=` |
| R3 | `F-0409 AC-44 (p44): Retry while the bind source is still missing shows the same dialog, and the container stays exited` | the source folder `<run>/c46-bind-src` (`mkdirSync` recursive); `devContainerFolder('c46-bind', {name: 'Bind', mounts: ['source=<source>,target=/bind,type=bind']})` (put the real path in the string); `const id = await containerLeftBy(folder)`; `docker stop <id>`; `rmSync(<source>, {recursive: true, force: true})`. `openFolderWindow`, `reopenStarted`, `waitForDialog`; record it; `answerDialog(name, 'Retry')`; `waitForDialog` again | both dialogs' `dialogText` is `['', S018, RECOVERY_BUTTONS]`; after the second, `devContainersOf(folder)` is `[<id>]` and `inspectOf(id).status` is `exited` |
| R4 | `F-0409 AC-35 (p35): with the bind source restored, Retry connects to the same container, with its bind mount` | its own `it`, with its own folder `c46-bind-back` and source `<run>/c46-bind-back-src`, set up as R3 up to the first dialog. Then `mkdirSync(<source>)`, `answerDialog(name, 'Retry')`, `connectedToContainer(name, DIALOG_MILLISECONDS)` | `devContainersOf(folder)` is `[<id>]`; `inspectOf(id).status` is `running`; `docker inspect -f '{{json .Mounts}}' <id>` has a mount with `Type` `bind`, `Source` `<source>`, `Destination` `/bind` |
| R5 | `F-0409 AC-34 (p34, the dialog half): an exited container whose bind source is gone is started, Docker's refusal shows S018, and no container is made` | `c46-bind-gone`, set up as R3 up to the first dialog | `dialogText(dialog)` is `['', S018, RECOVERY_BUTTONS]`; `devContainersOf(folder)` is `[<id>]`. Then `answerDialog(name, 'More Actions...')`, `waitForQuickPick(name, 30_000)`, and `console.log` its items, one line starting `containers-46 p34:` (not asserted; see §3) |
| R6 | `F-0409 AC-45 (p45): reopening an exited container shows no build phase, only the connecting toast and its server stage` | `c46-exited`; `const id = await containerLeftBy(folder)`; `docker stop <id>`; `openFolderWindow`. While `reopenInContainer(name)` runs, sample `notifications(name)` every 100 ms (each in a `try`; a failed sample is the reload) and collect every text | every collected text that starts with `Connecting to Dev Container` is `Connecting to Dev Container (show log)` or `Connecting to Dev Container (show log): Starting server`; at least one such text was seen; `devContainersOf(folder)` is `[<id>]` |

`waitForQuickPick` comes from `windows/renderer.ts`; import it. R1's `containerLeftBy` leaves the container running
(release 1 has no shutdown), so `docker pause` works on it. In R3–R5, `docker stop` makes the container exited before
the source goes.

**What was measured:** R1 to R4 and R6 as written. R5's quick pick listed `Reload Window`, `Edit devcontainer.json
Locally`, `Open Recent...`, `Open Documentation`; AC-34 asks for `Rebuild Container` too, which is a question on the
issue (§3).

## 3. The catalogue (`coverage-containers-r1.tsv`)

F-0409 AC-7, AC-26, AC-35, AC-44 and AC-45 become `acceptance`. AC-34 stays `todo`: R5 proves its dialog half, and
its quick-pick and rebuild halves wait for athena's answer on the issue. Run `node tools/check-coverage.ts`.

## 4. Gates, review and open rows

All gates; the `containers` launch locally (`docker ps` first; remove your leftovers after, and `docker unpause`
anything paused). PR title: `tests: F-0409's paused, older-configuration and bind-source reuse rows (card
containers-46, #1060)`. Request athena only; hermes assigns the peer.

**Open rows (stop and report on the issue, with the row's output):** a dialog's text, a title, an indicator or a
container id differs from §2; R4 doesn't connect; R6 sees a text starting `Connecting` other than the two.
