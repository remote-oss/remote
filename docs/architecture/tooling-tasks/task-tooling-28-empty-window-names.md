# Task card tooling-28: windows without a folder get their own names in the windows suite

Issue: #583. Why: tooling-20's window agent names a window by the last segment of its first folder, or `local` when it
has none (`window-name.ts`, and the same `windowNameOf` in `remote-ssh/src/surfaces/scripted-adapters.ts`). Connect to
Host... opens an **empty** remote window (F-2301 AC-6). Such a window is named `local` too, so its events and commands
mix with the editor's first window, and so do a second empty window's. Batch 3's picker rows open several. Builder:
hestia or iris (hermes assigns). Size: S.

## 1. The rule

- The editor's first window, local and with no folder, stays `local`: the first window without a folder that the agent
  sees in the run.
- Every later window without a folder gets `empty-<n>`, with `n` = 1, 2, … in the order the windows' agents start.
- Windows with a folder keep their folder name.

**How the agent claims a name.** Every window's agent writes its name to the pid file (below) at activation: a
window with a folder writes its folder name, so a reused pid never carries a stale name and the adapters have one
source. A window without a folder first claims a name by creating
`<HARNESS_RUN_FOLDER>/agent/claims/<name>` exclusively (`openSync(…, 'wx')`). It tries `local`, then `empty-1`,
`empty-2`, … until a creation succeeds. It writes the name it got to `<HARNESS_RUN_FOLDER>/agent/pids/<process.pid>`. The run passes that folder to every launch
as `REMOTE_OSS_ACCEPTANCE_WINDOWS`, the product's own harness variable: no file under `packages/` reads a `HARNESS_*`
variable (triton on #575).
- A window with a folder claims nothing and writes no pid file.
- A reloaded empty window has a new extension host, so it claims a new name. The rows don't reload empty windows; the
  README says so.

**How the adapters know the name.** The scripted adapters' window name is computed lazily at the first question, as
now. The agent and our extension run in the same local extension host, so they share the pid.
- **With `REMOTE_OSS_ACCEPTANCE_WINDOWS` set,** the adapters **wait for** `<REMOTE_OSS_ACCEPTANCE_WINDOWS>/<process.pid>`,
  polling every 50 ms for up to 10 s, and take its content.
  - A remote window's first questions come during the resolve. Our extension is activated for that by
    `onResolveRemoteAuthority`, and the resolve doesn't wait for `*` extensions, so the file may not be there yet
    (athena and triton on #591).
  - On timeout the window is named `unclaimed-<pid>`, so no other window's entries are used and the record shows it.
- **With the variable unset,** the name is `windowNameOf(…)`, as today.
- **The agent activates early** (deviation 3 of #609, accepted by athena): `*` fires only at workbench-ready, which
  on a first connect is more than 10 s after our extension starts its wait. So the agent declares `onStartupFinished`
  and `onResolveRemoteAuthority:ssh-remote` as well. It registers no resolver and changes nothing of ours, and the
  activation rows (F-2001, F-2501) read our extension's activation, not the agent's. The README records the measured
  order: the pid file is there 16 ms before the window's first record line.

## 2. Helpers (`tests/acceptance/windows/harness.ts`)

- `emptyWindows()`: the names `empty-<n>` that have an events file, in `n` order;
- `nextEmptyWindow(action)`: notes `emptyWindows()`, runs `action`, and resolves with the one new name once its
  `activated` event is there. It's bounded at 60 s, and fails if no new window or more than one appears.

**The agent's state** (`acceptance.agent.state`) also reports `remoteAuthority`, and `windowState` returns it, so a row
can compare a new window's authority with the one it expects. `vscode.env.remoteAuthority` isn't stable API (deviation
4 of #609, accepted by athena), so:
- our extension writes the authority its resolver resolved to `<REMOTE_OSS_ACCEPTANCE_WINDOWS>/<pid>.authority`, beside
  the pid file, only when that variable names the folder. The payload holds no secret;
- the agent's `state` reads that file, and reports `null` when there is none.

coverage-19 (#590) and coverage-18 (#588) read `remoteAuthority` this way.

**`nextEmptyName()`** gives the name the next empty window will claim: `empty-<n>` with `n` one more than the highest
claimed. A test that must script a window before it exists (a failure dialog in a window Connect to Host opens) writes
its entries for that name. Claims are made in order, so the name is right as long as the test opens one window at a
time.

## 3. Rows

Unit rows:
- the claim order: `local`, then `empty-1`, `empty-2`;
- a taken claim is skipped;
- with the variable set, the adapters wait for the pid file and take its name;
- with the variable set and no file within 10 s, the name is `unclaimed-<pid>` (a fake clock);
- with the variable unset, the name is `windowNameOf`'s;
- a folder window's agent writes its folder name to the pid file.

Capability row in `two-windows.test.ts`:

| Name | Expected |
|---|---|
| `D-85: an empty window opened from a window gets its own name` | `nextEmptyWindow(() => inWindow('local', 'acceptance.agent.openWindow', 'vscode-remote://ssh-remote+harness/'))` resolves with `empty-1`. Its `windowState` is `ssh-remote` with no folders, and `local`'s events gained no `activated` |

`acceptance.agent.openWindow` accepts an authority without a folder path; that is the agent's own change. Close the
window at the end.

## 4. Review

PR title `tests: windows without a folder get their own names (card tooling-28)`. themis or triton reviews; athena checks
the adapters' reading of the agent's pid file.
