# Task card coverage-23: the activation rows of F-2001 (batch 7 of #142's acceptance rows)

Issue: #602. Why: #142's acceptance rows, batch 7. F-2001 (`remote-oss/remote-ssh#11`) says when the extension activates
and where it runs. Each window has its own extension host, so these rows use the windows suite, and each row looks at
a fresh window. Builder: selene. Size: about 1.5 agent-days. **Depends on:**
- coverage-19 (#590): the agent's `remoteSshActive`;
- tooling-28 (#583): empty windows' names;
- coverage-14 (#568): `userSettings` and the windows helpers.

## 1. Harness additions

**The agent's state** gains:
- `remoteSshKind`: `vscode.extensions.getExtension('remote-oss.remote-ssh')?.extensionKind`, as a number, or `null`;
- `outputDocuments`: the paths of `vscode.workspace.textDocuments` whose scheme is `output`.

**Helpers** (`windows/harness.ts`):
- `activationEvents(since)`: from every `exthost.log` under `<run>/user-data/logs/`, the activation lines of
  `remote-oss.remote-ssh` written after `since`, each as `{logFolder, activationEvent}`. Core writes them as
  `ExtensionService#_doActivateExtension remote-oss.remote-ssh, startup: …, activationEvent: '…'`; take the event
  between the quotes. A window's log folder is the `window<N>` folder its agent's first event falls in. Match it by
  the time of the log's first line and the agent's `activated` time, or have the agent report
  `vscode.env.logUri`'s parent in its state (prefer this);
- `openLocalFolder(name)`: makes `<run>/local/<name>`, runs `inWindow('local', 'acceptance.agent.openWindow',
  'file://<run>/local/<name>')`, and waits for its `activated`;
- `openEmptyLocalWindow()`: `nextEmptyWindow(() => inWindow('local', 'workbench.action.newWindow'))`;
- `globalStorageOf()`: the names, sizes and mtimes under `<run>/user-data/User/globalStorage/remote-oss.remote-ssh`.

## 2. The rows (`tests/acceptance/windows/activation.test.ts`)

| Cite | Steps | Assertions |
|---|---|---|
| F-2001 AC-1 (folder) | `openLocalFolder('l1')`; wait 5 s | `l1`'s `remoteSshActive` is false; no activation line for `l1` |
| F-2001 AC-1 (empty) | `openEmptyLocalWindow()`; wait 5 s | the same for that window |
| F-2001 AC-2, AC-3, AC-4 | in `l1`: `workbench.action.showCommands`, then `workbench.action.closeQuickOpen`; `workbench.action.remote.showMenu`, then close; `workbench.action.openSettings` with the query `@ext:remote-oss.remote-ssh`, then `workbench.action.closeActiveEditor` | after each, `remoteSshActive` is still false; no activation line for `l1` |
| F-2001 AC-5 | in `l1`, `opensshremotes.showLog` | `remoteSshActive` true; one activation line for `l1`, `onCommand:opensshremotes.showLog`; `outputDocuments` has one path ending in `Remote - SSH` |
| F-2001 AC-6 | the same | no record line of `l1` at all. The launch passes `--enable-proposed-api`, so the setup has nothing to say |
| F-2001 AC-23 | for each command the manifest's `commandPalette` hides in a local window, in a fresh `openLocalFolder` window of its own: `opensshremotes.openEmptyWindowOnCurrentHost`, `opensshremotes.provideFeedback`, `opensshremotes.openWebUI`. When connect-23 has registered it, also `opensshremotes.cleanCurrentRemoteServer` | each: one activation line for that window with `onCommand:<id>`; no record line of that window; no new window (`emptyWindows()` unchanged) |
| F-2001 AC-15, AC-13 | `openWindow('harness', 'r1')` | `r1` connected; one activation line for `r1`, `onResolveRemoteAuthority:ssh-remote`; `remoteSshKind` is `1` (`ExtensionKind.UI`); `onHost('ls', '/home/harness/.vscodium-server-insiders/extensions')` lists no `remote-oss.remote-ssh` folder |
| F-2001 AC-20 | `userSettings({'remote.extensionKind': {'remote-oss.remote-ssh': ['workspace']}})`. Note the record's and the log's sizes, the helper registry, `globalStorageOf()` and the user settings file. `openWindow` on `harness` for `r2`, without waiting for a connect; wait 20 s | no activation line for `r2`; no record or log line written since; no connection helper; `globalStorageOf()` and the settings file (apart from the row's own `remote.extensionKind`) unchanged; `inWindow('r2', 'acceptance.agent.writeFile', …)` fails (no remote folder). Set the setting back and close `r2` |

**F-2001 AC-29, the stand-in.** athena ruled on #603 that a stand-in carrying the reference's id may be used, within
these limits:
- The test writes it at run time into the run's extensions folder as a `package.json` only, with nothing else. It holds:
  - the reference's publisher and name, the ids F-3901's detection reads (from our stand-down table, `standDown.standsDownFor`);
  - a version and `engines`;
  - a `displayName` of `Acceptance stand-in (not the reference)`.

  There is no code and no contribution beyond what the detection reads.
- Nothing in it comes from the reference. It is never committed as a package, packaged, published, or left outside the
  run folder.
- It is removed at the end of the row.
- The rows assert only our side.

**The warning in the record.** lib-standdown's editor adapter shows its warning with `vscode.window.showWarningMessage`,
which the record doesn't see. connect-31 (#586) makes the adapters before activation. This card passes the stand-down
guard `{...standDownHost(vscode), showWarning: (text, button) => adapters.notice.showWarning(text, [button])}` in
`extension.ts`, so in the harness the warning goes through the notice port. A user's editor uses the same
`showWarningMessage`. Add a unit row in `extension.test.ts` (or the activation's) that the guard's warning reaches the
notice port. **This card therefore depends on connect-31 (#586) too.**

The row:
- write the stand-in;
- open a fresh local folder window `l9` (`openLocalFolder`), so the editor scans the extensions folder anew;
- run `opensshremotes.showLog` in it.

Assert:
- exactly one `notice` line of `l9`, whose question is our stand-down warning (`standDownTexts.warning`) and whose
  `buttons` are `["Show Other Extension"]`;
- `vscode.commands.getCommands(true)` in `l9` (the agent's state gains `ourCommands`, the `opensshremotes.*` ones it
  lists) holds no `opensshremotes.openEmptyWindow`;
- no `progress` line of `l9`.

The context key `opensshremotes.standingDown` has no public reader; it rests on lib-standdown's unit rows. Name them in
the PR. If the editor needs a restart to see a new extension folder, say so in the PR and use the restart the windows
suite allows (close every window but `local`, reopen).

Close every window a row opened before the next row.

## 3. Every AC of F-2001

| AC | Tag | How |
|---|---|---|
| 2, 3, 4, 5, 6, 13, 15, 20 | `acceptance` | the rows above. AC-2's 13 entries, AC-3's group and AC-4's settings are the manifest's: `skeleton.test.ts`'s `commands: 17 …`, `menus: 8 entries …` and `settings: the 35 declared …` rows. Name them in the PR as those halves |
| 23 | `acceptance` once the `cleanCurrentRemoteServer` row runs | until connect-23, `todo` with that wait. Its R-46 safety half rests on F-2006's unit rows: name them |
| 19 | `unit` | `skeleton.test.ts`'s `F-2001 AC-19` row |
| 7, 12, 21, 24, 25, 26, 27 | `core` | as tagged |
| 1, 9, 10, 11, 14, 16, 28 | `todo` | a trust-enabled launch (#456): Restricted Mode and untrusted folders. AC-1's folder and empty-window rows run now; its untrusted-folder half is the wait |
| 8, 18 | `deferred` | `build order slice 1: the Remotes view is remote-explorer's` (as F-2202 AC-20 and AC-33) |
| 17 | `todo` | core's URI consent dialog stands before the activation. Wait: a way to answer core's dialog from the harness. Its "empty path shows no further UI" half rests on the URI handler's unit row: name it |
| 22 | `todo` | a virtual-workspace window, which needs a file system provider the run doesn't have |
| 29 | `acceptance` | the stand-in row below (athena's ruling on #603) |

## 4. Done when

`pnpm test:acceptance:vscodium` passes with the new file; paste its summary. The repository's gates pass.

## 5. Review

PR title `tests: the activation rows of F-2001 (card coverage-23, #142)`. themis or triton reviews; athena gives the tag
check.
