# Task card tooling-20: a second window, and reloading or closing a window, under test (D-85)

Issue: #492. Why: D-85 (the user, on #142). **Two windows** and **window reload** are the capabilities most of F-2102 needs (AC-8 to
AC-40: shared login, the waiting window, Kill, reload without a prompt, closing the owner), plus F-2206 AC-29 and
AC-34 and F-2304 AC-9. Today a launch has one window, and its tests run in it, so a test can neither open a second one
nor reload its own. Builder: daedalus. Size: L. **Depends on tooling-16 (#488)** (launches, `extraExtensions`) **and
tooling-18 (#490)** (the record's shape); the password rows use **tooling-17**.

## 1. The design

**One test window drives the others through an agent.**
- The launch's own window, **A**, runs the tests as today.
- Every window of the run, A included, loads a small development extension, the **window agent**
  (`tests/acceptance/window-agent/`, UI kind, `activationEvents ["*"]`).
- A test opens window **B** with `vscode.openFolder(<remote folder URI>, {forceNewWindow: true})`. It acts in B by
  writing a command for B's agent, and observes B through B's record lines and B's agent events.
- **A never reloads or closes itself**, since that would end the test run. Rows about "the window that reloads" use B.
- **Two launches.** In `windows`, A is the first remote window, so A starts the connection server. In
  `windows-local`, A is a local window (no folder) that opens B and then C, so **B owns the server** and can be
  reloaded or closed. That's what F-2102 AC-14, AC-36, AC-38 and the like need.

**A window's name** is the last segment of its first workspace folder's path (`a`, `b`), or `local` for a window
without one. Launch folders for these rows are `/home/<user>/a` and `/home/<user>/b`, which the test creates on the host
before opening them.

**Measure first** that `vscode.workspace.workspaceFolders` is set when remote-ssh activates in a remote window: the
resolver activates early. If it's empty then, the adapters read the window's name at their first call, not at
activation.

**Per-window scripts and records** (`scripted-adapters.ts`):
- `ScriptEntry` gains an optional `window`. An adapter answers only from entries whose `window` is absent or equals its
  own name, with a cursor of its own.
- `RecordLine` gains `window`, set on every line.
- `adaptersFor(environment, real, files, windowName)` takes the name. `extension.ts` passes it from
  `vscode.workspace.workspaceFolders` at activation.
- One script and one record file serve every window of a launch, so lines from different windows interleave.
- **An entry without `window` is answered once by each window**, because each has its own cursor. A row that counts
  prompts gives its entries a `window`.
- **Each record line is one `O_APPEND` write** (`appendFileSync` of the whole line with its `\n`), so two extension
  hosts never split a line. The agent's event lines are written the same way.

**The agent stays a test tool:** it does nothing unless `HARNESS_RUN_FOLDER` is set, and it lives only under `tests/`.
It never goes into a product VSIX. The README states these three rules.

**The agent** (`tests/acceptance/window-agent/src/extension.ts`, bundled with the suites):
- On activation, it appends `{event: 'activated', time}` to `<HARNESS_RUN_FOLDER>/agent/<name>.events.jsonl`.
- It polls `<name>.commands.jsonl` every 200 ms. For each new line `{id, command, args}` it first appends
  `{event: 'accepted', id}`, then runs `vscode.commands.executeCommand(command, ...args)`, then appends
  `{event: 'done', id}` or `{event: 'failed', id, message}`. A reload or a close may never write `done`; `accepted`
  is the acknowledgement.
- On `deactivate`, it appends `{event: 'deactivated', time}`.
- It registers one command of its own, `acceptance.agent.writeFile(name, text)`: it writes `text` to `name` in its
  window's first workspace folder through `vscode.workspace.fs`. That shows the window's connection still works.

**Helpers** (`tests/acceptance/suite/harness.ts`):
- `openWindow(alias, folder)` creates the folder on the host if needed, opens the window and resolves once its agent
  has `activated`;
- `inWindow(name, command, ...args)` resolves on `accepted`;
- `reloadWindow(name)` resolves on the next `activated`;
- `closeWindow(name)` resolves on `deactivated`;
- `windowEvents(name)`;
- `recordLines(surface?, window?)`.

Every wait is bounded (60 s) and fails naming the window and the event.

**First, measure** that a window opened from a test-cli launch loads the launch's development extensions and sees its
environment (`HARNESS_RUN_FOLDER`). If it doesn't, the agent is installed as a VSIX into the run's extensions folder
instead, and the README says so.

## 2. Files

| File | Change |
|---|---|
| `tests/acceptance/window-agent/` | new: the agent (`package.json`, `src/extension.ts`) |
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts`, `src/extension.ts` and tests | per-window entries, the `window` field |
| `tests/acceptance/suite/harness.ts` | the helpers; `onHost` takes an optional user |
| `tools/acceptance-launches.ts` | the `windows` launch: `runner-remote`, folder `vscode-remote://ssh-remote+harness/home/harness/a`, `extraExtensions: ['window-agent']`; the `windows-local` launch: `runner`, no folder, the same `extraExtensions`; every other launch gets the agent too |
| `tests/acceptance/suite-windows/two-windows.test.ts` | the capability rows (section 3) |
| `tests/acceptance/README.md` | "Several windows" |

## 3. Capability rows (`suite-windows`, key-login host `harness`)

One assertion per `it`, in this order (they build on each other):

| Name | Expected |
|---|---|
| `D-85: a second window on the same host opens and connects` | `openWindow('harness', 'b')` resolves, and B's record holds a `progress` line for `Setting up SSH Host harness` |
| `D-85: the two windows share one connection server` | the client has one connection-helper process for the host (by the registry entry the helper writes for `harness`) |
| `D-85: reloading the second window activates its agent again` | `windowEvents('b')` has two `activated` |
| `D-85: closing the second window deactivates its agent` | `windowEvents('b')` ends with `deactivated` |
| `D-85: the first window is still connected after the second closed` | a file written through A's window is on the host |

**`suite-windows-local`** (launch `windows-local`; A is local):

| Name | Expected |
|---|---|
| `D-85: with the second window closed, the third is still connected` | A opens B, then C, on `harness` (folders `b`, `c`), then closes B; `inWindow('c', 'acceptance.agent.writeFile', 'still-here.txt', 'c')` is `done`, and `/home/harness/c/still-here.txt` holds `c` |

## 4. What follows

The F-2102 rows (#481's "two windows" and "window reload" lines) are written in `suite-windows` and, with tooling-17's
`password` alias, in a `windows-password` launch. They come from later cards, once this one and tooling-17 are merged.

## 5. Gates and review

The repository's gates, remote-ssh at 100/100/100. The VSCodium run passes with the new launch; paste its summary.
PR title `tests: a second window, reload and close under test (card tooling-20, D-85)`. athena (design), proteus.
