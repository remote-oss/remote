# Task card containers-70: the container stops when the window's processes are killed (F-0417 AC-23, AC-35, AC-43)

Containers increment 2, shutdown. Size: S. Builder: `task:local` (selene). Design: athena's C9 ruling on #737, point
4: the helper leaves the starter's process tree (helper-05), so a killed window's lease closes and its obligation
runs. Spec: remote-oss/remote-containers#62 (F-0417) 6.6, BR-9, AC-23, AC-35 and AC-43. **Depends on containers-69
(#1226)**, whose launch `containers-shutdown` these rows join. Everything is decided here. If what you find differs,
comment on this issue and stop.

## 1. A harness helper

In `tests/acceptance/windows/harness.ts`, beside `closeWindow`:

```ts
/** Kills window `name`'s processes at once (SIGKILL): its process group, its main process, or its whole tree. */
export async function killWindow(name: string, reach: 'processGroup' | 'mainProcess' | 'tree'): Promise<void>
```

- The window's process id is the one its pid file holds (`REMOTE_OSS_ACCEPTANCE_WINDOWS`, read the way the harness
  reads it already).
- `processGroup`: `process.kill(-pgid, 'SIGKILL')`, where `pgid` is field 5 of `/proc/<pid>/stat`.
- `mainProcess`: the editor's main process for that window: walk `/proc/<pid>/stat`'s parent field up from the
  window's process to the process the run started (the launch's editor process id, as the run records it), and kill
  that one.
- `tree`: every process whose parent chain leads to the run's editor process. Collect them from `/proc/*/stat` first,
  then kill them all.
- Afterwards, wait until none of the killed pids exists (at most 5 s).

A unit row for the `/proc` walk goes in `tools/` or the harness's own tests, over a fixture folder of `stat` files.

## 2. Rows (`tests/acceptance/containers-shutdown/killed.test.ts`)

Each row opens a folder with an image configuration and no `shutdownAction` (as containers-69's AC-1 row does, using
its helpers), waits until it's connected, then:

| Row | Kill | Expect |
|---|---|---|
| `F-0417 AC-23 (process-group)` | `killWindow(name, 'processGroup')` | `exited 0` within 15 s of the kill, and not before 9 s |
| `F-0417 AC-35 (main-process)` | `killWindow(name, 'mainProcess')` | the same |
| `F-0417 AC-43 (whole-tree, linux)` | `killWindow(name, 'tree')` | `exited 0` within 15 s of the last process ending |

- The launch's later rows need an editor, so each row ends by restarting the editor the way the harness restarts a
  launch after a crash. If the harness has no such step, run these three rows last in the launch, one per editor run,
  and comment here with what you did.
- `finally`: remove the row's container.

## 3. Coverage (`coverage-containers-r1.tsv`)

- `F-0417.AC-23` becomes `acceptance`.
- `F-0417.AC-35` and `F-0417.AC-43` become `deferred` with `containers release 1: later (Windows, WSL and macOS)`:
  their Windows halves wait for that increment. Their Linux rows stay.

## 4. Done when

`node tools/acceptance.ts --editor vscodium --launches containers-shutdown` passes (paste the summary line), and all
gates pass. PR title: `remote-containers: the container stops when the window's processes are killed (card
containers-70, #1227)`. Request athena only.
