# Task card tooling-30: the explorer's acceptance launches and a view reader over CDP

Issue: #633. Release 0.3 (#43), explorer slice 1, item S7. Why: the eight gate rows of slice 1 (brief
`docs/architecture/l3/windows-and-explorer/brief-remote-explorer.md`, "The slice-1 gate", ruled 233e3b7) need four
things the harness doesn't have:
- the explorer installed, with its proposals;
- a window where remote-ssh is absent;
- a way to see the rows of the Remotes view;
- a way to press a row's inline action as a user does.

coverage-25 writes the rows themselves. Builder: daedalus. Size: about 2 agent-days. **Depends on:** explorer-03
(the explorer's `main` bundle, so `pnpm package` makes its VSIX). The tools rows and the smoke rows below don't
depend on it.

## 1. Why CDP, not a test adapter in the explorer

**What can't be used:**
- No editor API lets one extension read another extension's tree.
- F-5002 BR-3 rules that a keybinding never acts on the focused row, so a test can't reach a row's action through a
  command.
- A row's actions get their row argument only from core's tree, when a user clicks an inline action or picks a
  context-menu entry ([oss] `src/vs/workbench/browser/parts/views/treeView.ts`).

**What it leaves:** the alternative is a test hook in the explorer, such as a runtime command that runs an action on
a row named by id. That would be product logic that exists only for tests, which the harness's rules don't allow: the
switch only swaps adapters (tests/acceptance/README.md, `REMOTE_OSS_ACCEPTANCE`).

**So:** the harness reads and clicks the window itself, over the Chrome DevTools Protocol of the editor's renderer.
That's the window a user sees, and the explorer ships nothing for it. The plain launches already run the editor as a
user does, so they're the place for it.

The DOM of core's workbench isn't an API, so the selectors in §3 are pinned to the VSCodium build the run pins
(`VSCODIUM_RELEASE`). Bumping that build reruns the smoke rows of §4, and a selector change shows there first.

## 2. Files

| File | Change |
|---|---|
| `tools/acceptance.ts` | `EXTENSIONS_UNDER_TEST` is unchanged. A new map `LAUNCH_EXTENSIONS`, `[['remote-oss.remote-explorer', 'remote-explorer']]`, names the extensions that only some launches install. Before a launch with `withExtensions`, the run installs into the launch's own extensions folder, `<run>/extensions-<label>`: the run's VSIX files, the window agent's, and the packaged VSIX of each id in `withExtensions` (as `packagedExtensions` finds them: a VSIX not built yet is skipped, as there) |
| `tools/acceptance-plain.ts` | `editorArguments(runFolder, proposedApi, launch?)`: the extensions folder is `<run>/extensions-<label>` for a launch with `withExtensions`, else `<run>/extensions`. The proposals are `PROPOSED_API_EXTENSIONS` (unchanged: `remote-oss.remote-ssh` and `remote-oss.acceptance-window-agent`, in that order) followed by the launch's `withExtensions`, all left out when `proposedApi` is false. `plainEditorOf` adds `--remote-debugging-port=0` when the launch's `debuggingPort` is true, then one `--disable-extension=<id>` per id of its `disabledExtensions` (in order), after `editorArguments(...)` and before `--new-window` |
| `tools/acceptance-launches.ts` | `PlainLaunch` gains `withExtensions?: readonly string[]` (ids of `LAUNCH_EXTENSIONS`), `debuggingPort?: boolean` and `disabledExtensions?: readonly string[]`. `launchesOf` gains, after `no-proposals`: `explorer` (`withExtensions: ['remote-oss.remote-explorer']`, `debuggingPort: true`), `explorer-alone` (the same and `disabledExtensions: ['remote-oss.remote-ssh']`) and `explorer-no-proposals` (the same as `explorer` and `proposedApi: false`, for gate row 8: the explorer without its proposal), each `kind: 'plain'` with the suite folder of its label |
| `tests/acceptance/windows/renderer.ts` | new: the CDP helpers of §3 |
| `tests/acceptance/explorer/renderer.test.ts` | new: the smoke rows of §4, run in the `explorer` launch |
| `tests/acceptance/explorer/`, `tests/acceptance/explorer-alone/`, `tests/acceptance/explorer-no-proposals/` | new: each holds a `tsconfig.json` like `no-proposals/`'s and one `it` named `tooling-30: the launch starts and its local window answers the agent` (`inWindow('local', 'acceptance.agent.state')` resolves). coverage-25 adds the rows |
| `tests/acceptance/tsconfig.json`, `knip.jsonc` | the three suite folders, as the README's "To add a launch" says |
| `tests/acceptance/README.md` | a section "Reading the window" (§5), and the three explorer launches in the list of labels |
| `tools/acceptance-plain.test.ts`, `tools/acceptance-launches.test.ts`, `tools/acceptance.test.ts` | the tools rows of §4 |

Nothing in `packages/` changes.

## 3. The renderer helpers (`windows/renderer.ts`)

**Scope (athena on #634):** only the three explorer launches get the debugging port and the explorer, so no earlier
launch changes. In particular, F-2001 AC-2's "not activated" row keeps a window where nothing can call remote-ssh's
`remote-internal.*` ids.

**The port:** Electron, given `--remote-debugging-port=0`, picks a free port and writes it as the first line of
`<user-data>/DevToolsActivePort`. `debuggingPort()` reads that file under the run's user-data folder, waiting at most
60 s for it.

**The page of a window:** `pageOf(name)` reads `http://127.0.0.1:<port>/json/list` and returns the `webSocketDebuggerUrl`
of the target of `type` `page` whose `title`, cut at the first `' - '`, is `name` or starts with `` `${name} [` ``. That's
the folder name of a local window, or `harness [SSH: harness]` for a remote one. The window `local` is the one whose
title has no folder part, so its first segment is the product name. It fails naming the window and listing the titles
when there's no single match. The helper waits until there is one, polling every 200 ms, bounded at 60 s like
the harness's other waits.

**The client:** `evaluate<Value>(name, expression)` opens a `WebSocket` (Node's global) to that URL, sends one
`Runtime.evaluate` with `{expression, returnByValue: true, awaitPromise: true}`, and returns `result.value`. It
closes the socket. An `exceptionDetails` in the answer fails with its text. There's no dependency.

**The helpers** (each runs one expression in the page):

| Helper | Returns or does |
|---|---|
| `paneOf(viewName)` (expression part) | the `.pane` element whose `.pane-header .title` text is exactly `viewName`, or none |
| `viewRows(name, viewName)` | for each `[role="treeitem"]` of that pane, in DOM order: `{label, description, level, expanded}`. `level` is the `aria-level` as a number, and `expanded` is `aria-expanded` (`'true'`/`'false'` → boolean, absent → `undefined`). `label` and `description` come from the row's `aria-label` where core puts them there apart. Otherwise they come from the texts of `.label-name` and `.label-description` (`''` when absent). Measure which in the pinned build, and write it into the PR. An absent pane gives `undefined`, and a pane with no rows gives `[]` |
| `rowAction(name, viewName, rowLabel, actionTitle)` | finds the single row whose `label` is `rowLabel`, then the `.action-label` inside its `.actions` whose `aria-label` is `actionTitle`, and calls `click()`. It fails naming what it didn't find: no pane, no row or several rows, no action. It returns when the click has been dispatched |
| `titleAction(name, viewName, actionTitle)` | the same on the pane header's `.actions` |

**How a row shows its view:** before reading or clicking, the test shows the view with
`inWindow(name, '<viewId>.focus')`, core's generated focus command. The helpers don't open views themselves.

## 4. Rows

**Tools rows** (unit, in `tools/`):

| Cite | Given | Expected |
|---|---|---|
| tooling-30 | `editorArguments(run, true)` with no launch, and with the `windows` launch | `--extensions-dir=<run>/extensions` and exactly the two proposals `--enable-proposed-api=remote-oss.remote-ssh` and `--enable-proposed-api=remote-oss.acceptance-window-agent`, in that order (no `remote-oss.remote-explorer`) |
| tooling-30 | `editorArguments(run, true, <explorer>)`; then with `proposedApi` false and `<explorer-no-proposals>` | `--extensions-dir=<run>/extensions-explorer`, then `--enable-proposed-api=remote-oss.remote-ssh`, `--enable-proposed-api=remote-oss.acceptance-window-agent` and `--enable-proposed-api=remote-oss.remote-explorer`, in that order; with `proposedApi` false, `--extensions-dir=<run>/extensions-explorer-no-proposals` and no proposal |
| tooling-30 | `plainEditorOf` for `explorer-alone` | the arguments are `editorArguments(...)`, `--remote-debugging-port=0`, `--disable-extension=remote-oss.remote-ssh`, `--new-window`, in that order |
| tooling-30 | `plainEditorOf` for the `windows` and `no-proposals` launches | no `--remote-debugging-port`, no `--disable-extension` |
| tooling-30 | `launchesOf(...)` | the labels end with `windows`, `no-proposals`, `explorer`, `explorer-alone`, `explorer-no-proposals`, and only these three have `withExtensions` and `debuggingPort` |
| tooling-30 | `packagedExtensions` with `dist/remote-explorer-0.0.0.vsix` beside the other two | the list holds only the other two (the run-wide set is unchanged) |
| tooling-30 | the installs of a run with the three explorer launches, against the recording command runner | one install into `<run>/extensions` without the explorer, and one into each `<run>/extensions-<label>` with the run's VSIX files, the window agent's and the explorer's |

**Smoke rows** (`explorer/renderer.test.ts`, in the `explorer` launch, against core's own file Explorer, so they need no
explorer code). The row names start with `tooling-30:`.

| Given | Expected |
|---|---|
| the run's local window `local`, `inWindow('local', 'acceptance.agent.openWindow', <a folder of the run with the files a.txt and b.txt>)`, wait for its window; `inWindow(<it>, 'workbench.files.action.focusFilesExplorer')` | `viewRows(<it>, <the folder's name, as the Explorer pane's title shows it>)` lists `a.txt` and `b.txt` at level 1 (measure the title and the level in the pinned build before writing the assertion, and write what you measured into this card's PR) |
| the same window | `titleAction(<it>, <that title>, 'Collapse Folders in Explorer')` resolves; `viewRows` afterwards is unchanged for files at the root (a measurable effect is enough; record it) |
| a view name no pane has | `viewRows` gives `undefined`; `rowAction` fails with a message naming the view |
| `pageOf('no-such-window')` with the wait cut to 1 s for the row | fails, listing the page titles |

## 5. README: "Reading the window"

One paragraph under "Several windows":
- the explorer launches install the explorer into their own extensions folder and start the editor with a debugging
  port that only the run reads;
- `windows/renderer.ts` reads a view's rows, and clicks a row's or a view's action as a user does;
- the selectors are pinned to the run's VSCodium build;
- nothing in a product package exists for it.

Add the `explorer`, `explorer-alone` and `explorer-no-proposals` launches to the label list, one line each.

## 6. Gates and review

All gates: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm dupes`, `pnpm dead`, `pnpm check-layout`,
`pnpm coverage` (the changed tools files at 100 %), and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium`
with every launch green. Paste its summary in the PR. PR title `tools, tests: the explorer's launches and a view
reader over CDP (card tooling-30, #633)`. themis or triton reviews. athena gives the design check of §1. proteus checks
that the debugging port is bound to the loopback address only and dies with the editor.

## 7. Open rows (stop and report on #633)

1. If `--remote-debugging-port` makes the pinned build bind anything but `127.0.0.1`, stop. Don't add a flag by
   guess.
2. If an earlier launch's row changes at all, stop: the explorer launches must leave the others untouched.
3. If a row's inline actions aren't in the DOM until the row is hovered or selected, the helper first selects the
   row by clicking its `.monaco-list-row`. Record which one it was.
