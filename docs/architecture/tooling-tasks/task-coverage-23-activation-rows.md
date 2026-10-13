# Task card coverage-23: the activation rows of F-2001 (batch 7 of #142's acceptance rows)

Issue: #602. Why: #142's acceptance rows, batch 7. F-2001 (`remote-oss/remote-ssh#11`) says when the extension activates
and where it runs. A window has its own extension host, so these rows use the windows suite: each row looks at a fresh
window. Builder: iris or hestia (hermes assigns). Size: about 1 agent-day. **Depends on:**
- coverage-19 (#590): the agent's `remoteSshActive`;
- coverage-14 (#568): `userSettings`, the windows helpers.

## 1. Harness additions

- **The agent's state** gains:
  - `remoteSshKind`: `vscode.extensions.getExtension('remote-oss.remote-ssh')?.extensionKind`, as a number, or `null`;
  - `outputDocuments`: the paths of `vscode.workspace.textDocuments` whose scheme is `output`.
- **`activationEvents(since)`** (`windows/harness.ts`): from every `exthost.log` under `<run>/user-data/logs/`, the
  activation lines of `remote-oss.remote-ssh` written after `since`, each as `{window log folder, activationEvent}`. Core
  writes them as `ExtensionService#_doActivateExtension remote-oss.remote-ssh, startup: …, activationEvent: '…'`. Read
  the event between the quotes.
- **`openLocalFolder(name)`**: makes `<run>/local/<name>`, then `inWindow('local', 'acceptance.agent.openWindow',
  'file://<run>/local/<name>')`, and waits for its `activated`. The window is named `<name>` (tooling-28).

## 2. The rows (`tests/acceptance/windows/activation.test.ts`)

| Cite | Steps | Assertions |
|---|---|---|
| F-2001 AC-1 | `openLocalFolder('l1')`; wait 5 s | `l1`'s `remoteSshActive` is false; `activationEvents` has no line from `l1`'s log folder |
| F-2001 AC-5 | in `l1`, `inWindow('l1', 'opensshremotes.showLog')` | `remoteSshActive` true; one activation line for `l1` with `onCommand:opensshremotes.showLog`; `outputDocuments` has one path that ends with `Remote - SSH` |
| F-2001 AC-6 | the same | no `notice`, `failureDialog`, `pick`, `hostPick` or `platformPick` line of `l1`. The launch passes `--enable-proposed-api`, so the setup has nothing to say |
| F-2001 AC-23 | `openLocalFolder('l2')`; `inWindow('l2', 'opensshremotes.openEmptyWindowOnCurrentHost')` (hidden from the palette in a local window) | one activation line for `l2` with `onCommand:opensshremotes.openEmptyWindowOnCurrentHost`; no record line of `l2`; no new window (`emptyWindows()` unchanged) |
| F-2001 AC-15 | `openWindow('harness', 'r1')` | `r1` connected; `remoteSshKind` is `1` (`ExtensionKind.UI`); `onHost('ls', '/home/harness/.vscodium-server-insiders/extensions')` lists no `remote-oss.remote-ssh` folder |
| F-2001 AC-20 | `userSettings({'remote.extensionKind': {'remote-oss.remote-ssh': ['workspace']}})`; note the record's, the log's and the helper registry's sizes; `openWindow` on `harness` for `r2`, without waiting for a connect: wait 20 s | no activation line for `r2`'s log folder; no record or log line written since; no connection helper; `r2` has no folder content (`windowState` folders as opened, but `inWindow('r2', 'acceptance.agent.writeFile', …)` fails). Set the setting back and close `r2` |

Close `l1`, `l2` and `r1` at the end.

## 3. The catalogue

F-2001 AC-1, 5, 6, 15, 20 and 23 go to `acceptance`.
- **Core halves for #142:** "Developer: Show Running Extensions" and the Extensions view's sections (AC-1, AC-15); core's
  "OK to enable" notification on an editor whose product names our id (AC-20).
- **AC-23's R-46 safety half:** it rests on F-2006's unit rows; name them in the PR.
- **Unit:** AC-2, 3 and 4 (the palette, the indicator menu and the settings from the manifest) are the manifest's rows,
  as #481 tagged their manifest halves.

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass.

## 5. Review

PR title `tests: the activation rows of F-2001 (card coverage-23, #142)`. themis or triton reviews; athena gives the tag
check.
