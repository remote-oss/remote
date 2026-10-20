# Task card containers-69: a dev container window registers its connection with the shutdown helper (F-0417, C9)

Containers increment 2, shutdown. Size: L. Builder: `task:claude`. Design: athena's C9 ruling on #737 (2026-10-20),
point 2 (a window registers each connection once its target is identified, and sends `leave` when it goes elsewhere)
and point 1 (one helper per instance). Spec: remote-oss/remote-containers#62 (F-0417), image and Dockerfile
configurations. **Depends on helper-05 (#1223), containers-68 (#1225) and coverage-50 (#1224).**

## 1. The lease (`src/shutdown/window-lease.ts`, new)

One lease per extension host, acquired the first time a connection registers, and kept for the extension host's
life. It closes with the extension host; that close is the helper's signal that the window ended (BR-9: a close, a
quit, a crash, a reload, Close Remote Connection).

```ts
acquire({
  folder: {instanceOf: context.globalStorageUri.fsPath},
  namespace: 'remote-containers.shutdown',
  helperKey: 'instance',
  script: path.join(extensionFolder, 'dist', 'shutdown-helper.js'),
  leaveStarterTree: true,
  launcherScript: path.join(extensionFolder, 'dist', 'helper-launcher.js'),
  policy: {kind: 'delayedCheckAfterLastLease', milliseconds: 10_000, action: 'drain'},
  prepare: () => Promise.resolve({kind: 'ready', options: {}, payload: {}}),
  cancellation,
});
```

- Every failure (`registryUnresolved`, `spawnFailed`, `endpointUnreachable`) logs one line,
  `the shutdown helper isn't available (<failure>): this window's containers won't be stopped when it closes`. The
  connect goes on with nothing shown (BR-10, BR-11).
- A request that fails (`helperGone`, a timeout of 2 s, or `{accepted: false}`) logs one line and is dropped, and nothing
  else happens.
- After `helperGone`, the next registration acquires again. That joins a new helper, if one started.

## 2. Registration (`connect/connector.ts`)

The connection id is `randomUUID()`, one per connect with attempt 1. A reconnection (attempt > 1) is the same
connection and registers nothing.

1. **`register`, at the start of the connect** (attempt 1), from the authority payload's folder target:
   - `identity: {hostPath: target.hostPath, configFile: target.configFile.fsPath}`;
   - `engine: {dockerPath: tools.dockerPath, environment}`, where `environment` has `DOCKER_CONTEXT` (when the
     payload has a context) and `DOCKER_HOST` (when the editor's environment has one).
   This is BR-5's "a reload, and a reopen of an existing dev container, count from the moment they begin". A brand-new
   connect counts from here too. That's earlier than BR-5 asks, but the only connection it can be compared with is
   another of the same folder and configuration, which is the reopen case (6.15), so the outcome is the same.
   A `legacy` target registers nothing.
2. **`container`, once the container is ready** (after `prepared.kind === 'ready'`, beside the line
   `container <id> was newly started|already running`):
   - `containerId: prepared.containerId`;
   - `action: effectiveAction(recorded, fileValue)` (containers-68 §4), where:
     - `recorded` is the container's `devcontainer.metadata` label, parsed as a JSON array, or `undefined` when the
       container has no such label. Read it from the inspect the connect already does (`lifecycle/inspect-lines.ts`,
       `labels.ts`); if that inspect doesn't keep the label, add it there;
     - `fileValue` is the top-level `shutdownAction` of the configuration file as written. Read it through the
       configuration text the connect already has (`config/configuration-text.ts`); `undefined` when absent.
   - This is sent also when the connect fails after the container is ready (the window still holds its obligation,
     BR-8, AC-60). It's sent before the failure is returned.
3. **`leave`**: sent by the step our commands run before they reload or reopen the window elsewhere
   (`open/pre-reload.ts`), for the connection the window holds, if any, right before the reload.
   - Rebuild Container: the new connection then registers the same identity, so the old container counts as in
     use, but Rebuild has removed it already.
   - Reopen elsewhere: the container isn't in use, and it stops (BR-9).
   - Reopen Folder Locally and Switch Container aren't built yet (their criteria are deferred), so the step covers
     them when they come.

## 3. Rows

**Unit** (`test/unit/window-lease.test.ts`, `connector.test.ts`):
- a register at the start;
- a container message after ready, also when the connect fails after it;
- no register on attempt 2;
- no register for a legacy target;
- a failed acquire logs once and the connect goes on;
- a request failure logs once;
- `helperGone` acquires again;
- the `leave` from `pre-reload`.

**Acceptance**, a new plain launch `containers-shutdown` in `tools/acceptance-launches.ts`, modelled on
`containers` (`...CONTAINERS_LAUNCH`, the same registry and stand-ins), suite `tests/acceptance/containers-shutdown/`:
- Each row opens a folder with a small image configuration (`alpine` pinned by digest, as the containers suite pins
  its images), closes the window with `closeWindow`, and reads the container's state over time.
- Use `docker inspect -f '{{.State.Status}} {{.State.ExitCode}}'` through the harness's Docker helpers, and a
  `docker events --since <close> --until <now> --filter container=<id>` reading for "no kill, stop or die".
- Timings get a margin of 3 s over the spec's "about".
- Rows, named `F-0417 AC-n (<case>)`:

  | AC | Case |
  |---|---|
  | 1 | no `shutdownAction`: `exited 0` 10–15 s after the close |
  | 2 | `"stopContainer"`: as AC-1 |
  | 3 | a Dockerfile configuration: as AC-1 |
  | 5, 6 | an image built by the row with `LABEL devcontainer.metadata='[{"shutdownAction":"none"}]'`: stays `running` 40 s; with the file's `"stopContainer"`: stopped |
  | 7 | created with `"none"`, key removed, reopened without rebuild: stays; and the converse: stopped |
  | 8 | `"none"` added while connected: stopped |
  | 12 | `"overrideCommand": false`, a command that exits 3 four seconds after SIGTERM: `exited 3` about 15 s after the close; one that ignores it: `exited 137` about 21 s after |
  | 17, 19 | `docker kill` from the host, Cancel on core's "Cannot reconnect" dialog (the scripted or renderer surface the containers suite uses): the window stays; started again by hand, the window then closed: stopped about 11 s later |
  | 21 | a terminal command running at the close: stopped |
  | 22 | a `docker exec -d` process from the host: stopped |
  | 24 | Reload Window: `running` 40 s with no kill, stop or die; then closed: stopped |
  | 25 | Close Remote Connection (core's command): stopped 11–16 s after |
  | 26 | across all rows: `recordLines('notice')` and the failure dialog lines have nothing of this feature |
  | 27 | removed (`docker rm -f`) during the delay: no container started or created, and no shutdown helper process left 30 s later (`pgrep -f shutdown-helper.js` under the run's user) |
  | 28 | Docker unreachable during the check (the harness's engine cut, or a `dockerPath` wrapper that fails for 15 s): still `running` afterwards, and not stopped later |
  | 46 | `docker stop` by hand during the delay: no further start, kill, stop or die for 40 s |
  | 51 | a reload whose Docker calls are held 25 s (a `dockerPath` wrapper that sleeps): `running` throughout |
  | 56 | Rebuild: the new container stays 60 s; closed: stopped |
  | 57 | closed while the indicator still says "Opening Remote...", after the container started: stopped 11–17 s after |
  | 58 | a Dockerfile whose build takes 20 s, closed during the build: no container of it up for more than 15 s after its start, and none running 120 s after the close |
  | 60 | `remoteUser` changed to a missing account, Reload: the failure dialog stays, and the container is stopped |
  | 61 | closed, then reopened from a second window within 5 s: no kill, stop, die or start for 40 s |
  | 62 | the Close Window half: a 60 s `postCreateCommand` running at the close: stopped |
  | 65 | `"keepRunning"`: stays 60 s |
  | 66, 68 | a foreground `postStartCommand` of ten minutes, and a detached one: stopped |
  | 67 | a Dockerfile `LABEL devcontainer.metadata` with `"none"`: the label has no `shutdownAction`, and it's stopped |
  | 69 | a container made by the row with only the folder's two labels, the file `"none"`: stays 40 s |
  | 70 | `null`, `false`, `0`, `""`: stopped; `1`: stays 40 s |

- **The program's own row** (amended 2026-10-20 on dike's note on #1243). containers-68 excludes
  `src/programs/shutdown-helper.ts` and `src/programs/helper-launcher.ts` from coverage as "the acceptance run covers
  it", so a committed row has to prove that, in `tests/acceptance/containers-shutdown/helper-program.test.ts`, named
  `#1226: the shutdown helper program starts with the first dev container window, outside the editor's process tree,
  and ends after the last window closed and its check ran`:
  1. before any dev container window, no process of the run's user runs `shutdown-helper.js` (`pgrep -f`);
  2. after one window connects, exactly one does, and its parent isn't the editor's process tree (its `PPID` chain
     doesn't reach the editor's main process);
  3. its record is under the instance folder `<run>/user-data/User/globalStorage/remote-oss.remote-containers/instance-registry`;
  4. after the window closes, the container is stopped (AC-1's timing) and, within 30 s after that, no
     `shutdown-helper.js` process is left.
  Then make the two exclusions' reasons in `packages/remote-containers/coverage.json` name this row (its file and
  title), as remote-ssh's `connection-helper.ts` line does for its acceptance proof.
- `finally`: remove each row's containers.
- AC-23, AC-35 and AC-43 (ended process trees) are containers-70's.

**Coverage** (`coverage-containers-r1.tsv`):
- `acceptance` for the criteria above whose row passes.
- The mixed criteria have an unmet half that waits for a deferred group. They become `deferred` with that group's
  reason, and their rows for the image half stay:
  - AC-4, AC-9 and AC-50: `containers release 1: later (Compose)`;
  - AC-62: `containers release 1: later (Reopen Folder Locally)`.
- Unit-only criteria stay as containers-68 tagged them.

## 4. Done when

- The unit tests pass, with `window-lease.ts` at 100 % and `connector.ts` at its gate.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers-shutdown,containers` passes. Paste
  the summary line.
- All gates pass. PR title: `remote-containers: a dev container window registers its connection with the shutdown
  helper (card containers-69, #1226)`. Request athena only, and tell proteus the new launch's name for CI.
