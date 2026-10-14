# Task card containers-11: C8, the failure dialog and its quick pick

Issue: #881. Gating: milestone 0.4, increment 1b. It builds the dialog of gate row 7 (brief-release-1 §5). The row
itself needs a Dockerfile build, which comes with the F-0412 card. F-0410 (release-1 half), F-0202 6.1 and 7.E2, and
F-0201 5.0 step 5 (7.E14 and 7.E16). Size: M. Builder: `task:claude`.

**Build on:**
- containers-08 (#776, C10) merged: `failures.ts`, `slice-presenter.ts` and `register-connector.ts`;
- containers-06 (#878, C7) merged: a `CliFailure` from `up` reaches C10 unchanged.

The acceptance rows (§4.3) also need containers-09 part 2 (#775), for the containers launch's gate folders. If any of
these hasn't merged, wait for it.

## 1. Why

Slice 1's presenter (containers-08 §3.11) shows every failure as one modal error with a single `Retry`. Release 1
needs F-0410's dialog instead. It has three buttons (Retry, Edit devcontainer.json Locally, More Actions...). Its
detail picks S018 for a refused bind mount, S019 for a port that's already in use, and S034 for everything else. Its
"More Actions..." opens F-0202's quick pick (STR:S272).

The second pre-flight check's failures (S339, S104, S144) use the same three-button dialog and the same quick pick
(F-0202 BR-6 and 7.E2; F-0201 7.E14 and 7.E16; contracts §2 step 2, amended on #842). C10 already gives them as
`engineCheckFailed` with that reason (containers-08 §3.7 row 3).

Today nothing can tell S018 or S019 from S034. The CLI's result line says only `An error occurred setting up the
container.` (§3.1), so the daemon's words must be read where the CLI relays them.

## 2. Files

All under `packages/remote-containers/`, unless named otherwise.

| File | What |
|---|---|
| `src/cli/cli-lines.ts` | `setupFailed` gains `refusal?: DaemonRefusal`; the pure `daemonRefusalOf(line)` (§3.1) |
| `src/cli/cli-bridge.ts` | `drive` notes the last refusal of the run's own lines and puts it on `setupFailed` (§3.1) |
| `src/connector/failures.ts` (containers-08's path) | row 5's reason by `refusal` (§3.2) |
| `src/surfaces/failure-strings.ts` (new) | the English templates of §3.7, by id, and `failureText(id, values, translate)` |
| `src/surfaces/failure-dialog.ts` (new) | pure: the dialog and the quick pick for a `Failed` and the window's target (§3.3, §3.5) |
| `src/surfaces/recovery-presenter.ts` (new) | C8: the `FailurePresenter` over the ports of §3.4 |
| `src/surfaces/recovery-editor.ts` (new) | the editor adapters of those ports, over `vscode` |
| `src/surfaces/slice-presenter.ts` | deleted (containers-08 §3.11: "C8 replaces this module") |
| `src/connector/register-connector.ts` | `options.presenter` is C8's; the window's target comes from the resolver handle (§3.4) |
| `l10n/bundle.l10n*.json` | every new template, in every locale, as containers-03 did for `ENGINE_TEMPLATES` |
| `docs/remote-containers/README.md` (new, at the repository root's `docs/`) | the page "Open Documentation" opens (§3.6) |
| `tests/acceptance/windows/renderer.ts` | `quickPickOf(name)` and `answerQuickPick(name, label)` (§4.3) |
| `tests/acceptance/containers/recovery.test.ts` (new) | the acceptance rows of §4.3 |

## 3. The design

### 3.1 The daemon's refusal (C3)

**Measured on Docker 29.9.0 with the pinned CLI 0.89.0** (`up --log-format json`, an `alpine:3.22` image, 2026-10-14):

| Case | Result line (stdout) | The daemon's words (stderr events) | Container afterwards |
|---|---|---|---|
| bind source missing, create path | `outcome: error`, `message: "Command failed: docker run …"`, `description: "An error occurred setting up the container."`, no `containerId` | a `raw` event, no channel: `docker: Error response from daemon: invalid mount config for type "bind": bind source path does not exist: /nonexistent-c11-src\n\nRun 'docker run --help' for more information\n` | none |
| empty bind source (malformed entry) | the same | a `raw` event: `docker: Error response from daemon: invalid mount config for type "bind": field Source must not be empty\n…` | none |
| bind source gone, restart path (F-0410 7.E1) | `message: "Command failed: docker start <id>"`, the same `description`, `containerId: <id>` | a `text` event: `\u001b[1m\u001b[31mError response from daemon: invalid mount config for type "bind": bind source path does not exist: /tmp/claude-1000/c11src\u001b[39m\u001b[22m\r\n…` | the same, `Exited` |
| `appPort` in use (F-0410 7.E2) | `message: "Command failed: docker run … -p 127.0.0.1:47321:47321 …"`, the same `description`, `containerId: <id>` | a `raw` event: `docker: Error response from daemon: failed to set up container networking: driver failed programming external connectivity on endpoint laughing_pare (da74…4e8): Bind for 0.0.0.0:47321 failed: port is already allocated\n…` | one, `Created` |

So `errorOf` (`cli-lines.ts`) gives `setupFailed` for all four. The difference is only in the stderr events.

**The rule (ADR-0010 rule 2: the Docker client's own lines, anchored, on the CLI's event stream):**
1. `cli-lines.ts` exports

   ```ts
   /** Why the Docker daemon refused to create or start the container, by its own words. */
   export type DaemonRefusal = 'invalidMount' | 'portAllocated';

   /** The refusal one line of the Docker client says, or undefined; the line has no colour codes and no CR. */
   export function daemonRefusalOf(line: string): DaemonRefusal | undefined
   ```

   - `invalidMount`: `/^(?:docker: )?Error response from daemon: invalid mount config for type "/`. It covers a
     missing source and a malformed entry alike (F-0410 7.E1, "a malformed `mounts` entry, or a `source` path that does
     not exist").
   - `portAllocated`: `/^(?:docker: )?Error response from daemon: .*: Bind for \S+ failed: port is already allocated$/`.
2. `setupFailed` gains `refusal?: DaemonRefusal`. Set the key only when there is a refusal (exactOptionalPropertyTypes).
3. **`cli-bridge.ts`, `drive`:** inside `deliver`, for a `log` event whose `channel` is `undefined` only, split the
   scrubbed text on `\n`. For each line, remove SGR sequences (`/\u001b\[[0-9;]*m/g`) and one trailing `\r`, and run
   `daemonRefusalOf`. The last refusal found in the run is kept.
   - **Why only `channel === undefined`:** a lifecycle command's output arrives as `raw` events with a channel
     (`postCreate`, and so on; containers-04's appendix). A hook that prints such a line mustn't change the dialog.
   - **After `read(…)`:** when the result is `setupFailed` and a refusal was kept, return `{...result, refusal}`. Any
     other result is unchanged.
4. Nothing else of C3 changes. The lines still reach `onCliEvent` and the log as they do now.

### 3.2 The reason (C10, `failures.ts`)

containers-08 §3.7 row 5, `containerSetupFailed`, takes its reason from the `CliFailure`:
- `setupFailed` with `refusal: 'invalidMount'` gives `{id: 'S018'}`;
- with `refusal: 'portAllocated'` it gives `{id: 'S019'}`;
- every other case gives `{id: 'S034'}`, as now.

The other rows don't change.

### 3.3 The dialog for a `Failed`

lib-authority calls the presenter only for a failure that isn't `silent` and isn't `retryable`. So `cancelled`,
`containerGone` and `transportLost` never reach it.

`failure-dialog.ts`:

```ts
export interface FailureDialog {
  message: string;
  detail: string;
  /** In the order they're passed to the editor; the last is the close affordance. */
  buttons: readonly FailureButton[];
}
export type FailureButton = {label: string; action: 'retry' | 'editLocally' | 'moreActions'};
export function failureDialogOf(failed: Failed, target: DevContainerTarget | undefined, translate: Translate): FailureDialog
```

**Message and detail:**

| `failed.kind` | `message` | `detail` |
|---|---|---|
| `noServerSource` | not this function: §3.4 keeps containers-08's two-button dialog, unchanged | |
| `requirementsNotMet` | S346 | the reason's text, the check's own output (F-0503 7.E1) |
| `malformedAuthority`, which has no reason | `''` | S034 |
| every other kind | `''` (F-0410 5.0 step 2: "no separate message headline") | the reason's text through `failureText`: S018, S019, S034, S339, S104, S144, S031 or S359 |

**Buttons**, in this order, the last one `isCloseAffordance: true`:
1. `Retry` (S297), `retry`;
2. `Edit {0} Locally` (S158), `editLocally`. `{0}` is the POSIX base name of `target.configFile.path`. It's left out
   when `target` is `undefined`: `malformedAuthority` has no folder to go back to.
3. `More Actions...` (S227), `moreActions`.

On screen, F-0410 5.0 step 2 wants "Edit devcontainer.json Locally | More Actions... | Retry", with Retry primary and
the default for Enter. The custom dialog's rendering of this order is measured in §4.3 row R1 (open row 3).

**The texts never hold a secret** (R-26). They come from S-ids and the reason's own values, and no `diagnostics` reach
a dialog.

### 3.4 C8, the presenter (`recovery-presenter.ts`)

```ts
export interface RecoveryPorts {
  /** Shows the modal error; resolves with the chosen button's label, or undefined. */
  showError(message: string, detail: string, buttons: readonly string[]): PromiseLike<string | undefined>;
  /** Shows the quick pick; resolves with the chosen label, or undefined. */
  pick(placeholder: string, labels: readonly string[]): PromiseLike<string | undefined>;
  /** Reopens the folder on this machine, in this window. */
  openLocally(folder: string): PromiseLike<unknown>;
  reloadWindow(): PromiseLike<unknown>;
  openRecent(): PromiseLike<unknown>;
  openExternal(address: string): PromiseLike<unknown>;
  openSetting(settingId: string): PromiseLike<unknown>;
  /** Runs `task` once the current call stack has unwound (setTimeout 0). */
  later(task: () => void): void;
}
export function recoveryPresenterOf(ports: RecoveryPorts, target: () => DevContainerTarget | undefined, translate: Translate): FailurePresenter
```

**The presenter waits for the user**, as the WSL presenter does (windows contracts §3.2, the failure presenter
paragraph). The resolve stays open while the dialog shows, so core keeps "Opening Remote..." and nothing changes on
its own (F-0410 5.0 step 2, AC-2).

| The user chooses | The presenter |
|---|---|
| `Retry`, or Enter on it | resolves `'reload'`: lib-authority reloads the window and the connect runs again |
| `Edit devcontainer.json Locally` | calls `openLocally(target.hostPath)` and resolves `'handled'` |
| `More Actions...`, or Escape (`undefined`, the close affordance) | resolves `'handled'`, then `later(() => showQuickPick())` |

- **`noServerSource`** keeps containers-08 §3.11's dialog: `Open Setting` runs `openSetting('remote.serverDownloadBaseUrl')`,
  and `Cancel` and Escape do nothing. Each resolves `'handled'`. Move that code here unchanged.
- **Retry reloads.** F-0410 5.0 step 3 says Retry repeats "with no window reload". lib-authority's presenter can only
  hand back `reload`, `handled` or `closeRemote`, and slice 1 already reloads. While the dialog shows, the window
  hasn't connected, so its title and status are the same before and after. AC-3 is checked by its observable half:
  the same dialog again after a further failure (§4.3 R6).
- **`target`** is read when the presenter runs: `devContainerTargetOf(<payload>)` of the resolver handle's
  `currentConnection()?.decodedTarget`. It's `undefined` when there's none, or when it's malformed.
- **`openLocally(folder)`** is `executeCommand('vscode.openFolder', Uri.file(folder), {forceReuseWindow: true})`. The
  window becomes a plain local window on the folder, and Reopen in Container is available again (AC-4's first half).
  Opening the configuration file in that window is open row 1.

### 3.5 The quick pick (F-0202's STR:S272 surface; F-0410 5.0 step 4)

`failure-dialog.ts` also gives `quickPickOf(target, translate)`: the placeholder S272 and these items, in this order:

| Item | What it does |
|---|---|
| `Reload Window` (S289) | `reloadWindow()` |
| `Edit {0} Locally` (S158), only when `target` is defined | as the dialog button |
| `Open Recent...` (S260) | `openRecent()`, which is `workbench.action.openRecent` |
| `Open Documentation` (S256) | `openExternal(CONTAINERS_DOCUMENTATION)`, then the same quick pick again, fresh, with `Reload Window` first (F-0410 AC-9b, F-0202 AC-10) |

- Escape on the quick pick does nothing more. The window stays disconnected (F-0202 AC-19's second half).
- The pick has no title, is single-select, and has no Back button: `showQuickPick(labels, {placeHolder})`.
- **Not here:** "Rebuild Container" (S285, F-0410 BR-4 and AC-6). It runs `remote-containers.rebuildContainer`, which
  containers-14 (#884) registers. containers-14 adds the item, after `Reload Window`, with its check that a container
  exists for the folder and configuration. This card leaves room for it and adds no check.

### 3.6 The documentation address

F-0202 AC-10 names the reference's own help page. Our product's help lives in our repository, as remote-ssh's
`remoteHelp` does (`packages/remote-ssh/package.json`). So the address is ours:

```ts
/** The page "Open Documentation" opens: when the dev container can't be set up. */
export const CONTAINERS_DOCUMENTATION =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-containers/README.md#when-the-dev-container-cant-be-set-up';
```

`docs/remote-containers/README.md` is new, with one section under that heading. It covers what the dialog's detail
means (S018, S019, S034, S339, S104, S144), what each button and quick-pick item does, and where the log is
(`Dev Containers: Show Log`). It's short, and it uses no reference text.

### 3.7 The strings (`failure-strings.ts`)

The exact English templates, from the specs' string tables:

| Id | Text | Source |
|---|---|---|
| S018 | `A mount config is invalid. Make sure it has the right format and a source folder that exists on the machine where the Docker daemon is running.` | F-0410 §3.4 |
| S019 | `A port the container is setup to bind to is already in use. See the Dev Containers terminal for details.` | F-0410 §3.4 |
| S034 | `An error occurred setting up the container.` | F-0410 §3.4 |
| S104 | `Current user does not have permission to run 'docker'. Try adding the user to the 'docker' group.` | F-0201 §3.4 |
| S144 | `Docker returned an error. Make sure the Docker daemon is running and select an option how to proceed.` | F-0202 §3.4 |
| S158 | `Edit {0} Locally` | F-0410 §3.4 |
| S227 | `More Actions...` | F-0410 §3.4 |
| S256 | `Open Documentation` | F-0105, as F-0410 5.0 step 4 shows it |
| S260 | `Open Recent...` | F-0403, as F-0410 5.0 step 4 shows it |
| S272 | `Pick an action to help resolve the problem.` | F-0202 §3.4 |
| S289 | `Reload Window` | F-0108, as F-0410 5.0 step 4 shows it |
| S297 | `Retry` | F-0108, as F-0201 6.6 step 9 shows it |
| S339 | `The 'docker' command was not found. Make sure Docker is installed.` | F-0201 §3.4 |
| S346 | `The container does not meet all the requirements of the VS Code Server.` | F-0503 §3.4 |

- S031 and S359 stay where containers-08 put them.
- S019's "Dev Containers terminal" is the spec's text, kept verbatim (D-14), although F-0410 7.E2 found no such
  terminal.
- A template id that's already in `engine-dialogs.ts`'s `ENGINE_TEMPLATES` isn't repeated (S104 is not there; S103
  is). Check the two tables don't share an id, so there's no duplicated string.

### 3.8 What stays out of release 1

| Spec part | Why | Catalogue |
|---|---|---|
| The recovery container, the 4-button dialog, S159, S372, S076, the reset command (F-0410 6.1, 6.2; AC-14 to AC-19, AC-16a–c, AC-24 to AC-26, AC-28 to AC-32) | Clone in Volume is later (brief §2, "Later") | `deferred`, "containers release 1: later (volumes, F-07xx)" |
| S160, S161, S162, the SSH, Tunnel and WSL wording (AC-20, AC-22, AC-23; F-0202 AC-63) | remote engines and WSL are later | `deferred`, "containers release 1: later (remote engines, WSL)" |
| S420 (AC-21) | no subcommand outside `up` fails a connect in release 1 (containers-08 F-0504 BR-2 only logs) | `deferred`, "containers release 1: no CLI subcommand outside `up` fails a connect" |
| "Rebuild Container" in the quick pick (AC-6, AC-11b's item, AC-12b's Rebuild) | containers-14 (#884) | stays `todo`, reason containers-14 |
| AC-10, the disconnected-state menu | already deferred under brief ruling 8 | unchanged |
| AC-4's and AC-8's configuration tab and log group | open row 1 | `todo` |

## 4. Rows

### 4.1 Pure rows

**`cli-lines.test.ts`, `daemonRefusalOf`:**
- the four measured lines of §3.1 (colour codes and the CR already removed) give `invalidMount`, `invalidMount`,
  `invalidMount` and `portAllocated`;
- the same lines without the `docker: ` prefix give the same;
- a line with text before `Error response from daemon:` gives `undefined` (ADR-0010 noise row);
- `Error response from daemon: No such container: x` gives `undefined`;
- a `port is already allocated` line with text after `allocated` gives `undefined`;
- `''` gives `undefined`.

**`cli-bridge.test.ts`** (over the fake CLI host, as containers-04's rows):
- `F-0410 AC-11: a run whose raw stderr refuses the mount fails setupFailed with refusal invalidMount`;
- `F-0410 7.E1: the restart path's coloured text event gives invalidMount`;
- `F-0410 AC-12: a port refusal gives portAllocated, and the containerId stays`;
- `ADR-0010: a hook's raw output with the refusal line on its own channel gives no refusal`;
- `F-0410: two refusals, the last one wins`;
- `F-0410: a refusal on a run that fails some other way (buildFailed) leaves that result unchanged`;
- `F-0410: a setupFailed with no refusal line has no refusal key`.

**`failures.test.ts`:** row 5 with `refusal: 'invalidMount'` gives S018, with `'portAllocated'` S019, and without
either S034. The existing row-5 rows stay.

**`failure-dialog.test.ts`:**

| Name | Given | Expected |
|---|---|---|
| `F-0410 AC-1: a setup failure's dialog has no message, the reason as detail, and Retry, Edit, More Actions` | `containerSetupFailed`, `{id: 'S034'}`, a target with `configFile.path` `/w/.devcontainer/devcontainer.json` | `{message: '', detail: S034, buttons: [Retry, 'Edit devcontainer.json Locally', More Actions...]}` with the actions |
| `F-0410 AC-11, AC-12: S018 and S019 reach the detail` | the two reasons | the two texts |
| `F-0202 AC-8, F-0201 7.E14, 7.E16: the second check's reasons use the same dialog` | `engineCheckFailed` with S144, S339, S104 | the same buttons, those details |
| `F-0503 7.E1: the requirements failure has S346 as its message and the check's text as detail` | `requirementsNotMet`, `{text: 'Error: Missing GLIBC'}` | `message` S346, `detail` the text |
| `F-0410: a malformed authority has no Edit button and S034 as detail` | `malformedAuthority`, target `undefined` | `[Retry, More Actions...]` |
| `F-0410 S158: {0} is the configuration's base name` | `configFile.path` `/w/.devcontainer.json` | `Edit .devcontainer.json Locally` |
| `R-26: no diagnostics reach the dialog` | `diagnostics: ['token=SECRET']` | no text holds `SECRET` |
| `F-0202 AC-9: the quick pick` | a target | placeholder S272; `[Reload Window, Edit devcontainer.json Locally, Open Recent..., Open Documentation]` |
| `F-0410: the quick pick without a target` | `undefined` | `[Reload Window, Open Recent..., Open Documentation]` |

### 4.2 The presenter (`recovery-presenter.test.ts`, over recording ports)

- `F-0410 AC-3, AC-7b: Retry resolves reload`;
- `F-0410 AC-4: Edit Locally opens the folder locally and resolves handled`. `openLocally` gets `target.hostPath`.
- `F-0410 AC-5: More Actions resolves handled, then shows the quick pick once the call has returned`. The order of the
  recorded calls proves `later`.
- `F-0410 6.3: Escape is More Actions`: `showError` resolves `undefined`.
- `F-0202 AC-18: Reload Window reloads`;
- `F-0410 AC-8: the quick pick's Edit is the button's`;
- `F-0410 AC-9: Open Recent runs openRecent`;
- `F-0410 AC-9b, F-0202 AC-10: Open Documentation opens the address and shows the same pick again`. A second
  Escape ends it.
- `F-0202 AC-19: Escape on the quick pick does nothing more`;
- `contracts §3.11: noServerSource keeps Open Setting and Cancel`. Both outcomes and Escape are moved with the code.
- `F-0410 AC-2: the presenter doesn't resolve while the dialog is open`. `showError` is pending, so the presenter's
  promise is pending too.

Changed files are covered at 100 % (ADR-0003). `slice-presenter.test.ts` goes with its module; move its
`noServerSource` rows here.

### 4.3 Acceptance (`tests/acceptance/containers/recovery.test.ts`, the containers launch)

**Renderer helpers, beside `dialogOf`:**
- `quickPickOf(name)` gives `{placeholder: string; items: string[]} | undefined`, read from the window's open
  `.quick-input-widget`: the input's `placeholder` attribute, and the label of each visible list row, in order.
- `answerQuickPick(name, label)` clicks the row with that label.
- Measure the selectors on the pinned VSCodium, and write them into the PR.

Each row writes its folder with containers-09's folder helper, opens a window on it with Reopen in Container, and
waits with `waitForDialog`. Docker objects carry the run's label (containers-09 §3.2), so the run's clean-up removes
them.

| Row | Given | Expected |
|---|---|---|
| R1, F-0410 AC-1, AC-13 | `image: "remote-oss-acceptance/no-such-image:0"` | `dialogOf`: no message; detail S034; buttons `Edit devcontainer.json Locally`, `More Actions...`, `Retry`. Record the rendered order and the primary button in the PR (open row 3) |
| R2, F-0410 AC-11 | an `alpine:3.22` image with `mounts: ["source=<run>/missing,target=/x,type=bind"]` | detail S018; no container with the folder's labels afterwards |
| R3, F-0410 AC-12 | an `alpine:3.22` image with `appPort: [<port>]`, and a labelled helper container publishing `<port>` first | detail S019; one container with the folder's labels, status `Created` |
| R4, F-0410 AC-5, F-0202 AC-9 | R1's dialog, `answerDialog('More Actions...')` | `quickPickOf`: placeholder S272, items `Reload Window`, `Edit devcontainer.json Locally`, `Open Recent...`, `Open Documentation`. Record the window title and the remote indicator in the PR (open row 4) |
| R5, F-0410 AC-4 (first half) | R1's dialog, `Edit devcontainer.json Locally` | within 10 s the window's agent reports no remote and the folder open |
| R6, F-0410 AC-3 | R1's dialog, `Retry` | after the reload, the same dialog: no message and detail S034 |
| R7, F-0201 7.E14 (AC-50's dialog; AC-50's own commands come with containers-14) | a window connected to an image folder (containers-09 part 2, row 1's folder); `dev.containers.dockerPath` set to `<run>/no-such-docker` in the user settings; `Developer: Reload Window` | the three-button dialog, detail S339. Reset the setting in an `afterEach` |
| R8, F-0410 AC-2 | R1's dialog, left alone 35 s | `dialogOf` unchanged, and the agent still reports `Opening Remote...` as its state |

## 5. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

**`acceptance`:**
- F-0410 AC-1, AC-2, AC-3, AC-5, AC-11, AC-12 and AC-13;
- F-0202 AC-9.

**`unit`:** F-0410 AC-7, AC-7b, AC-8, AC-9 and AC-9b; F-0202 AC-8 (the S144 dialog; a stopped daemon isn't in the
containers launch), AC-10, AC-16, AC-18 and AC-19; F-0201 AC-36 (the S104, S339 and S144 details of the second
check's dialog).

F-0201 AC-50 stays `todo`, because its commands are containers-14's. R7 is that card's head start. Escape is unit-proven
only, because the custom dialog's Escape can't be sent reliably over CDP. If R4 can send it, mark AC-16
`acceptance`.

**Deferred** with §3.8's reasons. AC-4 and AC-8 stay `todo`, with open row 1.

## 6. Gates and review

- **Gates:** all of them: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers,
  check-string-tables, check-consumed, check-coverage, check-licences and coverage.
- **Runs:** the VSCodium run, with the containers launch.
- **PR title:** `remote-containers: C8, F-0410's failure dialog and quick pick (card containers-11, #881)`.
- **Review:** request athena only; hermes assigns the peer.

## 7. Open rows (stop and report on #881)

1. **Edit Locally's configuration tab** (F-0410 AC-4 and AC-8, the tab and the log group; 5.0 step 3).
   - **Why it's open:** the window that must open `devcontainer.json` is a new, local extension host. Our extension
     activates there only on `onStartupFinished` (F-0101's ACT atom). containers-01 deferred that event to increment 2
     under brief ruling 8, and the session log file of the second group has no sink in lib-log.
   - **What to build:** the reopen only (§3.4). Leave both halves `todo` with this row.
   - **If athena moves `onStartupFinished` into release 1:** the follow-up stores `{configFile, at}` under
     `remote-oss.remote-containers.pendingEdits` in `globalState` (R-27), keyed by the folder's `fsPath`. At activation
     in a local window, an entry younger than 5 minutes (contracts §3's intent rule) is read once, deleted, and opened
     with `vscode.open`, which shows core's missing-file placeholder for a deleted file (7.E5). That's a separate card.
2. **F-0503 7.E1's "Learn More"** (S218, primary) for `requirementsNotMet` opens a help address of the reference's.
   Until athena names one of ours, `requirementsNotMet` uses §3.3's three buttons. Report the deviation in the PR.
3. **Button order and Enter.** If the custom dialog doesn't render `Edit devcontainer.json Locally | More Actions... |
   Retry`, with `Retry` primary and the default for Enter, report what it renders. Don't reorder by platform.
4. **The disconnected title and indicator** after More Actions (F-0410 AC-5: `<folder> [Dev Container]`,
   "Disconnected from Dev Container"). They're core's text from our label formatter, which containers-08 registers only
   after a connect. Report what R4 shows. A fix belongs to C10/F-0504, not here.
5. The runner's Docker gives other words than §3.1's for R2 or R3. Report them with `docker --version`, and don't
   widen the patterns past the measured lines.
6. containers-06's or containers-08's merged code doesn't pass a `CliFailure` from `up` through to row 5 unchanged.
   Report what it does.
