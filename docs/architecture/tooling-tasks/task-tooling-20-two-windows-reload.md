# Task card tooling-20: a second window, and reloading or closing a window, under test (D-85)

Issue: #492. Why: D-85 (the user, on #142). **Two windows** and **window reload** are the capabilities most of F-2102 needs (AC-8 to
AC-40: shared login, the waiting window, Kill, reload without a prompt, closing the owner), plus F-2206 AC-29 and
AC-34 and F-2304 AC-9. Today a launch has one window, and its tests run in it, so a test can neither open a second one
nor reload its own. **Revised by athena's ruling on #492 (2026-10-13)** after iris measured that a window opened from a
test-cli launch runs the test bundle again, and that closing or reloading it ends the whole run. Builder: iris (reassigned). Size: L. **Depends on tooling-16 (#488)** (launches, `extraExtensions`) **and
tooling-18 (#490)** (the record's shape); the password rows use **tooling-17**.

## 1. The design (athena's ruling on #492)

**Multi-window runs leave extension-test mode.** One plainly started editor, one user-data folder, every window driven
by the window agent, and the assertions in Node.

- **The editor.** The run starts the editor under test plainly: no `--extensionTestsPath` and no
  `--extensionDevelopmentPath`. It runs on the run's user-data folder and a run-specific extensions folder, with the
  harness variables in its environment (`REMOTE_OSS_ACCEPTANCE`, the record, script and log paths,
  `HARNESS_RUN_FOLDER`). It starts with no folder.
- **The extensions.** Our VSIXs (`pnpm package`) and a VSIX of the window agent are installed into that extensions
  folder with the editor's `--install-extension`, as the run already does for ours.
- **Why one editor, not two.** Every window shares one main process, one profile and one settings file, as users
  have them. Two user-data folders would split `context.globalState` (the licence acceptance) and Global settings
  writes (`remotePlatform`), so F-2102 AC-22 and F-2206 AC-29 and AC-34 would run on a topology users never have.
- **The agent is the only test presence in the windows.** It opens, reloads and closes them like any user action.
- **The assertions run in a Node mocha process**, as `tests/acceptance/server/` does. They read the record lines, the
  agent's events and the host's state.

Measured by iris on VSCodium (2026-10-13), all three hold:
1. the VSIXs activate in a plainly started editor with a run-specific extensions folder;
2. the harness variables reach every window's extension host by inheritance, so the record and log fill;
3. the agent's `vscode.openFolder(…, {forceNewWindow: true})` opens a window in the same process, a reload gives a
   second `activated`, a close gives `deactivated`, and the editor keeps running.

**A window's name** is the last segment of its first workspace folder's path (`b`, `c`), or `local` for the window
with none. The editor's first window has no folder, so its agent is `local`, and the rows open the others from it.
Folders are `/home/<user>/<name>`, created on the host before the window opens.

**Per-window scripts and records** (`scripted-adapters.ts`):
- `ScriptEntry` gains an optional `window`, and `RecordLine` gains `window` on every line.
- `adaptersFor` reads the window's name lazily, at its first call (`windowNameOf`).
- An entry without `window` is answered once by each window, because each has its own cursor. A row that counts
  prompts gives its entries a `window`.
- Each record line is one `O_APPEND` write (`appendFileSync` of the whole line with its `\n`), so two extension hosts
  never split a line. The agent's event lines are written the same way.

**The agent** (`tests/acceptance/window-agent/`, UI kind, `activationEvents ["*"]`, packaged as a VSIX by the run):
- it does nothing unless `HARNESS_RUN_FOLDER` is set;
- on activation, it appends `{event: 'activated', time}` to `<HARNESS_RUN_FOLDER>/agent/<name>.events.jsonl`, and on
  `deactivate`, `{event: 'deactivated', time}`;
- it polls `<name>.commands.jsonl` every 200 ms. For each new line `{id, command, args}` it appends
  `{event: 'accepted', id}`, runs `vscode.commands.executeCommand(command, ...args)`, then appends
  `{event: 'done', id}` or `{event: 'failed', id, message}`;
- its own commands:
  - `acceptance.agent.openWindow(uri)`: `vscode.openFolder(uri, {forceNewWindow: true})`;
  - `acceptance.agent.writeFile(name, text)`: writes through `vscode.workspace.fs` into its window's first folder;
  - `acceptance.agent.state()`: appends `{event: 'state', remoteName: vscode.env.remoteName ?? null, folders: [...]}`,
    since no runner lives in a window any more;
- it lives only under `tests/`, never in a product VSIX. The README states these rules.

**The Node helpers** (`tests/acceptance/windows/harness.ts`):
- `startEditor()` and `stopEditor()`;
- `openWindow(alias, folder)`, which writes the open command for `local` and resolves on the new window's
  `activated`;
- `inWindow(name, command, ...args)`, which resolves on `done`, and fails on `failed`;
- `reloadWindow(name)`, which resolves on the **next `activated`** and ignores the reload command's own `failed`
  (athena: the extension host may end before it can answer);
- `closeWindow(name)`, which resolves on `deactivated`;
- `windowState(name)`, `windowEvents(name)` and `recordLines(surface?, window?)`.

Every wait is bounded (60 s) and fails naming the window and the event.

## 2. Files

| File | Change |
|---|---|
| `tests/acceptance/window-agent/` | the agent (`package.json`, `src/extension.ts`), packaged into a VSIX by the run |
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts`, `src/extension.ts` and tests | per-window entries, the `window` field, the lazy name |
| `tests/acceptance/windows/harness.ts`, `tests/acceptance/windows/two-windows.test.ts` | the Node helpers and the capability rows (section 3) |
| `tools/acceptance-launches.ts`, `tools/acceptance.ts` and tests | a launch kind with no runner: `{label: 'windows', kind: 'plain', suite: 'windows'}`, which installs the VSIXs, starts the editor plainly, and runs the suite with Node mocha; tooling-16's other launches are unchanged |
| `tests/acceptance/README.md` | "Several windows": the plain launch, the agent's rules, the helpers |

## 3. Capability rows (`tests/acceptance/windows/two-windows.test.ts`, Node mocha, key-login host `harness`)

One assertion per `it`, in this order (they build on each other):

| Name | Expected |
|---|---|
| `D-85: a window on the host opens and connects` | `openWindow('harness', 'b')` resolves, and `windowState('b').remoteName` is `ssh-remote` |
| `D-85: a second window on the same host shares the connection server` | after `openWindow('harness', 'c')`, the client has one connection-helper process for the host (by the registry entry the helper writes for `harness`) |
| `D-85: reloading a window activates its agent again` | after `reloadWindow('b')`, `windowEvents('b')` has two `activated` |
| `D-85: closing the window that started the server leaves the other connected` | after `closeWindow('b')`, `inWindow('c', 'acceptance.agent.writeFile', 'still-here.txt', 'c')` resolves, and `/home/harness/c/still-here.txt` holds `c` |
| `D-85: both windows' progress is in one record, by window` | the record has `progress` lines with `window: 'b'` and with `window: 'c'` |

## 4. What follows

The F-2102 rows (#481's "two windows" and "window reload" lines) are written in `tests/acceptance/windows/`, with
tooling-17's `password` alias where they need it. They come from later cards, once this one and tooling-17 are merged.

## 5. Gates and review

The repository's gates, remote-ssh at 100/100/100. The VSCodium run passes with the new launch; paste its summary.
PR title `tests: a second window, reload and close under test (card tooling-20, D-85)`. athena (design), proteus.
