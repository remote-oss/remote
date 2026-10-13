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

**How the agent claims a name.** At activation, a window without a folder claims a name by creating
`<HARNESS_RUN_FOLDER>/agent/claims/<name>` exclusively (`openSync(…, 'wx')`). It tries `local`, then `empty-1`,
`empty-2`, … until a creation succeeds. It writes the name it got to `<HARNESS_RUN_FOLDER>/agent/pids/<process.pid>`. The run passes that folder to every launch
as `REMOTE_OSS_ACCEPTANCE_WINDOWS`, the product's own harness variable: no file under `packages/` reads a `HARNESS_*`
variable (triton on #575).
- A window with a folder claims nothing and writes no pid file.
- A reloaded empty window has a new extension host, so it claims a new name. The rows don't reload empty windows; the
  README says so.

**How the adapters know the name.** When `REMOTE_OSS_ACCEPTANCE` is set, the scripted adapters' window name (computed
lazily at the first question, as now) is the content of `<REMOTE_OSS_ACCEPTANCE_WINDOWS>/<process.pid>` when that file
exists, and
`windowNameOf(…)` otherwise. The agent and our extension run in the same local extension host, so they share the pid,
and the agent activates (`*`) before any question can come.

## 2. Helpers (`tests/acceptance/windows/harness.ts`)

- `emptyWindows()`: the names `empty-<n>` that have an events file, in `n` order;
- `nextEmptyWindow(action)`: notes `emptyWindows()`, runs `action`, and resolves with the one new name once its
  `activated` event is there. It's bounded at 60 s, and fails if no new window or more than one appears.

**The agent's state** (`acceptance.agent.state`) also reports `remoteAuthority` (`vscode.env.remoteAuthority ?? null`),
and `windowState` returns it, so a row can compare a new window's authority with the one it expects.

**`nextEmptyName()`** gives the name the next empty window will claim: `empty-<n>` with `n` one more than the highest
claimed. A test that must script a window before it exists (a failure dialog in a window Connect to Host opens) writes
its entries for that name. Claims are made in order, so the name is right as long as the test opens one window at a
time.

## 3. Rows

Unit rows:
- the claim order: `local`, then `empty-1`, `empty-2`;
- a taken claim is skipped;
- the adapters read the pid file, and fall back to `windowNameOf` without it.

Capability row in `two-windows.test.ts`:

| Name | Expected |
|---|---|
| `D-85: an empty window opened from a window gets its own name` | `nextEmptyWindow(() => inWindow('local', 'acceptance.agent.openWindow', 'vscode-remote://ssh-remote+harness/'))` resolves with `empty-1`. Its `windowState` is `ssh-remote` with no folders, and `local`'s events gained no `activated` |

`acceptance.agent.openWindow` accepts an authority without a folder path; that is the agent's own change. Close the
window at the end.

## 4. Review

PR title `tests: windows without a folder get their own names (card tooling-28)`. themis or triton reviews; athena checks
the adapters' reading of the agent's pid file.
