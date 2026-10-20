# Task card containers-71: the Open Recent entry stores its label when it's created (F-0501 AC-1, AC-8)

Containers release 1. Size: S. Builder: `task:claude`. Found by themis on containers-54 part d (#1117). Open Recent
shows `c54-identity [Dev Container: Identity Name]` from our live label formatter. The product stores no label, so
F-0501 AC-1's "the Open Recent entry stored at creation carries the label `<tilded host path> [Dev Container]` with
`remoteAuthority` `dev-container+<HEX>`" and AC-8 ("stored labels are never refreshed") aren't met. Spec:
remote-oss/remote-containers#35 (F-0501), 5.0 step 9 and BR-6. This is a product gap, not a deviation.

## 1. Core's commands ([oss] 1.139.1)

`src/vs/workbench/browser/actions/workspaceCommands.ts`:
- `_workbench.addToRecentlyOpened(recentEntry)`, where `recentEntry` is `{type: 'folder' | 'workspace' | 'file', uri,
  label, remoteAuthority}`. It calls `IWorkspacesService.addRecentlyOpened`.
- `_workbench.getRecentlyOpened()` gives the list as the main process holds it, so a row needs no shutdown flush.

**Measure first, and cite it in the PR:** what `workspacesHistoryMainService.addRecentlyOpened`
(`src/vs/platform/workspaces/electron-main/`) does with an entry whose URI is already in the list (label kept, or
replaced), and when core adds the window's own entry (with which label). The design below holds if core keeps the
first stored label, or if our add runs after core's. If neither holds, comment here with the lines and stop.

## 2. The change (remote-containers)

- When a dev container window **connects for the first time to a folder target** (the resolve of attempt 1, once the
  connection is set up), look the window's folder URI up in `_workbench.getRecentlyOpened()`:
  - **no entry with a label of ours:** call `_workbench.addToRecentlyOpened({type: 'folder', uri: <the window's
    workspace URI>, label: '<tilded host path> [Dev Container]', remoteAuthority: 'dev-container+<HEX>'})`;
  - **an entry exists:** do nothing. Stored labels are never refreshed (AC-8).
  - For a workspace target, use `type: 'workspace'` and the workspace file's URI.
- `<tilded host path>` is the payload's `hostPath`, with the editor's home folder replaced by `~` when it's a prefix.
  Write a small pure function for it, with unit rows: home itself, under home, outside home, and a home that's only a
  string prefix (`/home/al` vs `/home/alex`).
- A failing command logs one line and changes nothing else.
- Put it beside the window's other on-connect work (find where the label formatter is registered, `workspaceSuffix`).
  Use `vscode.commands.executeCommand` through the port the module already has for commands.

## 3. Rows

- **Unit:** the tilde function; added when absent; not added when present; the failure is logged.
- **Acceptance**, in the `containers` launch, beside themis's F-0501 AC-1 row:
  - `F-0501 AC-1 (stored-label)`: after a reopen in container, `_workbench.getRecentlyOpened()` (run through the agent,
    `inWindow` on the local window, or a new agent readout if commands' results can't come back) holds the folder
    entry with label `~/…/<folder> [Dev Container]` (or the absolute path when the run's folder isn't under home) and
    `remoteAuthority` `dev-container+<HEX>`;
  - `F-0501 AC-8 (rename)`: change the configuration's `name`, rebuild or reopen, close: the stored label is
    unchanged.
- **Coverage:** `F-0501.AC-1` and `F-0501.AC-8` become `acceptance` when the rows pass (with themis's AC-1 row).

## 4. Done when

The rows pass in `node tools/acceptance.ts --editor vscodium --launches containers` (paste the summary line), and all
gates pass. PR title: `remote-containers: the Open Recent entry stores its label when it's created (card
containers-71, #1231)`. Request athena only.
