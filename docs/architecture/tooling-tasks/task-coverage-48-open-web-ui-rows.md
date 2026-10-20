# Task card coverage-48: the rows of Open Web UI (F-2509)

Release 0.2, slice 3. Size: M. Builder: `task:claude`. Spec: remote-oss/remote-ssh#67 (F-2509, `spec:reviewed`, 21
criteria), with athena's ruling on Q1 there: (a), reproduce it as specified. Brief: `docs/architecture/build-order.md`,
"Slice 3", F-2509: built (card remote-ssh-16). This card writes the rows and tags the lines. A product change follows
only where a row fails. **Depends on coverage-47 (#1215)**, which adds the F-2509 lines as `todo`.

## 1. On main

- `surfaces/web-ui-command.ts` (`openWebUiHandler`) and `window/web-ui.ts` (`webUiUrl`) are the command. It's wired
  in `register-connect.ts`, with `serverPort` from the connector and `openExternal` going to
  `vscode.env.openExternal`.
- The palette `when` is the spec's clause plus `&& !opensshremotes.standingDown`. That's the family's stand-down term,
  which every gated clause carries (`skeleton.test.ts`, `STANDING_DOWN`).
- Unit rows already exist in `web-ui-command.test.ts`, `web-ui.test.ts`, `connector.test.ts` and lib-server's
  `runtime.test.ts`. Rename them to the `F-2509.AC-n:` form where §3 gives them a criterion.

## 2. The harness

1. **A renderer launch `web-ui`** in `tools/acceptance-launches.ts`, with its unit row beside the others:
   `{...RENDERER_LAUNCH, label: 'web-ui', suite: 'web-ui', environment: {PATH: '<run>/browser-bin:<path>'}}`. Check
   that `<run>` is the folder the suite reads as `variable('HARNESS_RUN_FOLDER')`, as `config-files` uses it.
2. **A browser that records.** At the start of the suite (a `before`), write `<run>/browser-bin/xdg-open`, mode 755:
   ```sh
   #!/bin/sh
   printf '%s\n' "$*" >> "$(dirname "$0")/../browser-urls"
   ```
   The helper `openedUrls(): string[]` (in the suite, reading `<run>/browser-urls`, `[]` when it's missing) is what
   the rows read. **Measure first** that `vscode.env.openExternal` from our extension reaches this `xdg-open` under
   VSCodium (Electron's `shell.openExternal` on Linux). If it doesn't, find what it does run, with the [oss] lines, and
   comment on this issue before going on.
3. **A palette helper** in `tests/acceptance/windows/renderer.ts`: `paletteRows(name, text): Promise<string[]>`. It
   opens the Command Palette (the key core binds to `workbench.action.showCommands`), types `text`, waits for the
   list to settle (`waitForQuickPick`), reads the labels with `quickPickRows`, and closes the palette with Escape.
   Reuse those helpers, and copy no code from them.
4. **The server's port**: the remote port the connect logs (F-2409's line in `connectionLog()`). Read the log adapter
   for the exact line, and put a helper `serverPortOf(lines)` in the suite.

## 3. Rows

Acceptance rows go in `tests/acceptance/web-ui/web-ui.test.ts` (more files if it grows), named `F-2509 AC-n (<case>)`.
Each row sets `remote.SSH.enableWebAccess` with `userSettings` and restores it in `finally`.

| AC | Case |
|---|---|
| 2 | connected, key `true`: `paletteRows(…, 'Open Web UI')[0]` is `Remote-SSH: Open Web UI` |
| 3 | key absent, `false`, `0`, `""`, `null`: not listed (one row, five values) |
| 4 | key `"true"`, `"yes"`, `1`, `{}`: listed |
| 5 | add the key, then remove it, with no reload: the listing follows within 10 s each time |
| 6 | the key only in the remote folder's `.vscode/settings.json` (written with `onHost`), then only in the remote Machine settings (`~/.vscode-server/data/Machine/settings.json`, or whatever the server's data folder is on main): listed |
| 7 | a local window with the key `true`: not listed |
| 8 | `cutHostNetwork()`: not listed while the indicator reads reconnecting; `restoreHostNetwork()`: listed again |
| 9 | run it from the palette: `openedUrls()` gains exactly `http://localhost:<serverPortOf>/`; no notification, no dialog, no quick pick, no new editor tab, one window; the forwarded-ports status item and the title and indicator are unchanged |
| 10 | before and after the run: `onHost('ps', '-eo', 'comm')` names and `ss -ltn` ports unchanged, and `connectionLog()` has no new line, with `remote.SSH.logLevel` at `trace` (or the log level setting main has) |
| 11 | run twice: the same URL twice, nothing else |
| 12 | invoked with arguments (`inWindow(name, 'opensshremotes.openWebUI', {any: 1})` and with `'text'`): as AC-9 |
| 13 | invoked in a local window, in an SSH window with the key unset, and while reconnecting: no settings or keybindings file changes, the window answers `acceptance.agent.state` afterwards, and any notification is F-2006's R-46 one. Our handler opens the URL when the key is unset and opens nothing while reconnecting or local; both are within 6.7 step 3 |
| 15 | workspace trust on (the trust launches' setting) and the folder in Restricted Mode: listed, and runs as AC-9 |
| 16 | a fresh local window where `remote-oss.remote-ssh` isn't active (`extensionPresent`/the agent's activation readout): invoking it activates it, and nothing else shows |
| 17 | key set before the window connects: listed once connected, and runs as AC-9 |
| 18 | `remote.SSH.useLocalServer: false`, then `remote.SSH.useExecServer: false`: as AC-9 with that connection's port |
| 19 | `remote.SSH.remoteServerListenOnSocket: true`: running it adds no URL |
| 21 | before and after one run: the bytes of `settings.json` and `keybindings.json`; our own `globalState` entry in the run's `User/globalStorage/state.vscdb` (key `remote-oss.remote-ssh`, read with `node:sqlite`, same value length); the file names under `~/.ssh`, the run's user-data `User` folder (logs excepted), the host user's home (the server's log folder excepted) and the host's `/tmp`: all unchanged |

If a row fails, look at the cause before changing anything:
- **AC-9's port or the Ports count.** If core forwards the port (its opener tunnels `localhost` URLs for a remote
  window), the URL changes and the Ports count grows. Comment on this issue with the [oss] lines and stop. The way
  around it is a design question.
- **Any other failing row:** fix it in the product only when the cause is ours, and say so in the PR.

**Unit**, in `packages/remote-ssh/test/unit/`:
- `skeleton.test.ts`: `F-2509.AC-1` (the command, its category and title, one `commandPalette` entry whose `when` is
  the spec's clause followed by ` && !opensshremotes.standingDown`, no other menu, no keybinding) and `F-2509.AC-14`
  (`contributes.configuration` has no `remote.SSH.enableWebAccess`).
- Rename the existing rows: AC-11 for `BR-6: running twice…`, AC-12 for `arguments do not change the address`,
  AC-19 for the socket ones, and AC-20 for the reconnection ones (they stay).

## 4. Coverage (`coverage-slice1.tsv`)

- `unit`: AC-1, AC-14 and AC-20. AC-20's lost-and-new-port case is the connector's, and the unit rows prove it.
- `acceptance`: every other criterion, as its row passes.
- A criterion whose row can't pass for a cause outside us stays `todo`, with a comment here.

## 5. Done when

- `pnpm package && node tools/acceptance.ts --editor vscodium --launches web-ui` passes. Paste the summary line.
- All gates pass, and `node tools/check-coverage.ts` is clean.
- PR title: `remote-ssh: the rows of Open Web UI (card coverage-48, #1219)`. Request athena only, and tell
  proteus the new launch's name for CI.
