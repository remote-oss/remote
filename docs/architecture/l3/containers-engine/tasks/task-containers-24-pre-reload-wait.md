# Task card containers-24: the pre-reload wait

Issue: #929. Milestone 0.4, containers release 1. Size: M. Builder: `task:claude`. It's best taken by whoever built
containers-13, because it changes `chooseConfiguration`.

**Builds after:** containers-12 (#882, the trust gate in Reopen's flow) and containers-13 (#883, `chooseConfiguration`).
containers-14 part 2 and containers-17 then call the helper of §2.3, so they build after this card.

Sources:
- athena's ruling (c) on the user's trial, 2026-10-14, quoted in #929;
- F-0401 (remote-oss/remote-containers#21) 5.0 steps 1–3;
- F-0301 5.0 (the picker comes after the engine check);
- containers-03 (C2's `firstCheck` and `EngineDialogPort`);
- containers-13 §3.6 and §4 (`chooseConfiguration`, its surfaces, Reopen's flow).

## 1. The defect

In the user's trial, the first click of Reopen in Container seemed to do nothing. Between the click and the reload, our
flow runs C2's first check (`docker --version`, then `docker version`), then the CLI's `read-configuration`, and shows
nothing meanwhile.

**Measured:**
- `read-configuration` takes about 100–150 ms through the editor's Electron, and 75 ms through node;
- `docker version` takes about 10 ms;
- a cold CLI spawn or a slow daemon takes more.

F-0401 5.0 step 2 observes the reload "within about 1 s". Our CLI spawn can't promise that.

## 2. The design (athena's ruling (c))

### 2.1 The engine check and the CLI read run together; the surfaces wait for the check

`ConfigurationRequest` (containers-13 §3.6) gains:

```ts
/**
 * C2's first check, already running. Every surface and every answer of `chooseConfiguration` waits for it; when it
 * ends `stopped`, nothing more is shown and the answer is `stopped`. The work (discovery, reads, the CLI) doesn't wait.
 */
engineCheck: Promise<FirstCheckResult>;
```

`ConfigurationChoice` gains `{kind: 'stopped'}`: C2's check stopped the flow, and its own dialog has shown.

**In `chooseConfiguration`:**
- Before each call to a surface (`showInformation`, `pick`, `dialogs.showError`, `showWarning`, `openPreview`), `await
  request.engineCheck`. If it's `stopped`, show nothing and answer `stopped`.
- Before the answer, whatever the answer, `await request.engineCheck` the same way. A `chosen` therefore never reaches
  the caller before the check passed.
- **The work runs before or during the check:** discovery, the reads of the candidates, the re-read of the chosen file,
  and the CLI's `read-configuration` (step 5).
  - With one candidate that parses and has a container source, the CLI read starts at once, concurrently with the check.
  - With two or more, the reads that make the labels run during the check. The picker waits for the check, and the CLI
    read follows the pick.
- **When both fail,** the check's dialog shows (C2 shows it inside `firstCheck`). `chooseConfiguration` then answers
  `stopped`, and the read's failure is only logged at `info`, as `the configuration was read while the engine check
  failed: <kind>`. So the visible order stays the spec's: the engine first (F-0401, F-0301 5.0).
- **The CLI read's cancellation** is the request's `cancellation`, as now. Nothing aborts the read when the check stops.
  It ends on its own, and its answer is dropped.

### 2.2 S087 after 500 ms (`src/open/pre-reload-progress.ts`, new)

```ts
/** ruling (c): how long the pre-reload work runs before its progress shows, in milliseconds. */
export const PRE_RELOAD_PROGRESS_MILLISECONDS = 500;

export interface PreReloadProgressPorts {
  /** Shows a notification progress with `title` until `until` settles (`window.withProgress`, location Notification). */
  showProgress(title: string, until: Promise<void>): void;
  /** Calls `callback` after `milliseconds`; the result stops the wait (containers-03's `setTimer`). */
  setTimer(milliseconds: number, callback: () => void): () => void;
  translate: Translate;
}

export interface PreReloadProgress {
  /** Closes the progress, or prevents it from opening; idempotent. */
  close(): void;
}

/** Starts the timer; at 500 ms, unless closed, it shows S087 (`startTitleOf`) until `close`. */
export function startPreReloadProgress(ports: PreReloadProgressPorts): PreReloadProgress;
```

- **The title** is `startTitleOf(translate)`, the S087 of `progress-titles.ts`. It's the same text and link as the
  connect's own progress after the reload (F-0401 5.0 step 3), so the user sees one notification carry on. Don't define
  it twice.
- **What closes it** (it never reopens in the same run):
  - any surface: the surfaces of C2's dialogs (`EngineDialogPort.showError`) and every `ConfigSurfaces` method call
    `close()` first. §2.3 wraps the ports for that;
  - the reload: `close()` just before `openRemote`;
  - the end of the run, whatever the answer: `close()` in the run's `finally`.

### 2.3 One helper for the three flows (`src/open/pre-reload.ts`, new)

```ts
export interface PreReloadPorts {
  /** C2's first check with the given dialogs (preflight.ts's `firstCheck` over `served.preflight`, dialogs replaced). */
  firstCheck(base: string | undefined, dialogs: EngineDialogPort): Promise<FirstCheckResult>;
  dialogs: EngineDialogPort;
  config: ConfigurationPorts;
  progress: PreReloadProgressPorts;
}

/** The checks before a reload (ruling (c)): the engine and the configuration together, with S087 after 500 ms. */
export async function beforeReload(
  ports: PreReloadPorts,
  request: Omit<ConfigurationRequest, 'engineCheck'>,
): Promise<{choice: ConfigurationChoice; progress: PreReloadProgress}>;
```

**In order:**
1. `progress = startPreReloadProgress(ports.progress)`.
2. `closing = {...ports.dialogs, showError: (…) => { progress.close(); return ports.dialogs.showError(…); }}`. Wrap each
   `ConfigSurfaces` method the same way.
3. `engineCheck = ports.firstCheck(request.folder, closing).catch(caught => { … })`. Don't await it here.
   - **The `catch` is attached at once,** so a rejection is never unhandled while `chooseConfiguration` works (dike on
     #931).
   - A rejected check logs at error `the engine check failed: <message>` (the `Error`'s message, else `String(caught)`),
     closes the progress, and answers `stopped`. `firstCheck` maps every Docker outcome to a dialog, so a rejection is
     a defect of ours, and the command ends with the log line.
4. `choice = await chooseConfiguration({...request, engineCheck}, {...ports.config, surfaces: <wrapped>})`.
5. Return `{choice, progress}`. The caller closes `progress` before its reload, and in its `finally`.

**The callers:**
- **Reopen** (`reopen.ts`): steps 4 to 6 (containers-13 §4: the engine check, `executableOf`, `chooseConfiguration`)
  become one `beforeReload` call. `stopped` returns like `dismissed`. The trust gate (containers-12) stays before it:
  the trust dialog is a surface the user answers before any work starts.
- **Rebuild and Reopen** (containers-14 part 2) and **Open Folder Flow B** (containers-17) call `beforeReload` in the
  same place. Their cards cite this one. This card changes Reopen only.

### 2.4 The deviation, written down

- **`docs/architecture/l3/containers-engine/release-1-notes.md`** (new): the list the release notes are built from. It
  gets two entries:
  - this deviation, worded for users: "Reopen in Container checks Docker and reads the configuration before the window
    reloads. When that takes longer than half a second, a "Connecting to Dev Container" notification shows meanwhile."
    Then one line citing F-0401 5.0 step 2 and #929;
  - containers-13's interim notice (`noConfiguration`), as containers-13 §1 asks.
- **Not in the catalogue.** check-coverage allows a reason only on `core` and `deferred` rows, so the deviation lives in
  `release-1-notes.md` alone (dike on #931).

## 3. Files

| File | What |
|---|---|
| `src/open/pre-reload-progress.ts`, `src/open/pre-reload.ts` | new: §2.2, §2.3 |
| `src/config/choose-configuration.ts` | `engineCheck`, the `stopped` answer, the waits (§2.1) |
| `src/open/reopen.ts`, `src/open/reopen-ports.ts`, `src/extension.ts` | Reopen through `beforeReload`; the adapters (`withProgress`, `setTimer` from `served.preflight`) |
| `test/unit/pre-reload-progress.test.ts`, `test/unit/pre-reload.test.ts` | new: §4.1, §4.2 |
| `test/unit/choose-configuration.test.ts`, `test/unit/reopen.test.ts` | §4.3 |
| `tests/acceptance/containers/gate.test.ts` or containers-13's acceptance file | §4.4 |
| `docs/architecture/l3/containers-engine/release-1-notes.md` | §2.4 |

## 4. Rows

### 4.1 `pre-reload-progress.test.ts` (a fake timer you fire by hand)

| Name | Expected |
|---|---|
| `ruling (c): nothing shows before 500 ms` | `setTimer` got 500; no `showProgress` until it fires |
| `ruling (c): at 500 ms S087 shows until close` | firing shows `startTitleOf`'s text once; `close()` settles `until` |
| `ruling (c): closed before 500 ms, it never shows` | `close()`, then fire: no `showProgress`, and the timer was stopped |
| `ruling (c): close is idempotent and it never reopens` | `close()` twice, then fire: one settle, no second show |

### 4.2 `pre-reload.test.ts` (fake `firstCheck` and CLI, each settling when the row says)

| Name | Expected |
|---|---|
| `ruling (c): the engine check and the CLI read run concurrently` | with one valid candidate, the CLI's `readConfiguration` is called before `firstCheck` settles |
| `ruling (c): a chosen configuration waits for the check` | the CLI settles first, the check later: `beforeReload` settles only after the check, with `chosen` |
| `ruling (c): when both fail, only the check's dialog shows` | the check shows its dialog and answers `stopped`, and the CLI fails: one `showError` (the check's); the answer is `stopped`; the log has the "read while the engine check failed" line |
| `ruling (c): a check that stops before the picker shows no picker` | two candidates; check `stopped`: no `pick` call |
| `ruling (c): the picker waits for a passing check` | two candidates; the check settles `proceed` after the labels are read: `pick` is called after it, not before |
| `ruling (c): a surface closes the progress` | the progress fired; then a `showError` (check) / `pick` / `showWarning` / `showInformation` / `openPreview`: `close` comes before each surface's call |
| `ruling (c): a fast run never shows the progress` | both settle before the timer fires; the caller closes: no `showProgress` |
| `ruling (c): a check that rejects answers stopped, logs it, and leaves no unhandled rejection` | `firstCheck` rejects with `new Error('boom')` while the CLI read is pending: the answer is `stopped`; the log has `the engine check failed: boom` at error; the progress is closed; no surface is called; an `unhandledRejection` listener installed for the row sees nothing |

### 4.3 `choose-configuration.test.ts` and `reopen.test.ts`

- **Every existing row of containers-13** passes `engineCheck: Promise.resolve('proceed')` and keeps its expectation.
- **New rows:**
  - `ruling (c): a stopped check answers stopped and shows nothing`, one row per surface path (no configuration, the
    picker, S181, S113, S411);
  - `ruling (c): Reopen returns on stopped without a reload`;
  - `ruling (c): Reopen closes the progress before the reload, and in its finally on every other answer`.

### 4.4 Acceptance (the containers launch)

| # | Steps | Assertions |
|---|---|---|
| P1 | Reopen on a folder with one configuration, with `dev.containers.dockerPath` set to a wrapper that sleeps 1 s then runs `docker` (a script in the run folder) | the toast `Connecting to Dev Container (show log)` is on screen before the window reloads. Then it connects as gate row 1 does |
| P2 | The same with the plain `docker` | the connect succeeds. No assertion on the toast: under 500 ms it may not show |

## 5. Gates and review

Run all gates, the containers launch (`docker ps` first), and the VSCodium run. The PR title is
`remote-containers: the pre-reload wait, with the engine check and the CLI read together and S087 after 500 ms (card
containers-24, #929)`. Request athena only; hermes assigns the peer.

## 6. Open rows (stop and report on #929)

1. **The S087 title doesn't render its link in a pre-reload `withProgress`** (that is, P1 sees the brackets). Report
   what the toast shows. Don't change the template.
2. **A `firstCheck` that stopped leaves the CLI read running past the command's end** for longer than its own timeout.
   Report the read's duration, and don't add an abort without a ruling.
