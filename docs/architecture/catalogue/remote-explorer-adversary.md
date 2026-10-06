# remote-explorer: adversarial second read

Inputs: rows in `remote-explorer-15.json` and `remote-explorer-16.json`; issues #7–#17 of remote-oss/remote-explorer (gh issue view). Cross-repo ids were checked with gh issue list. This file lists problems only.

## 1. Missing

None. All 11 issues have a row, there are no rows without an issue, and every id matches its issue title. acCount and errorPaths (count of 7.E sections) agree with the issues on all rows. Issue #6 is the inventory and #1–#5 are epics, so they need no row.

## 2. Wrong or thin rows

- **F-5101 (#8)**: `proposedApi` leaves out `extensionsAny`, which is an owned atom of #8. `stableApi` lists `workspace.createFileSystemWatcher`, but #8 says the extension adds no watcher of its own (R-66, and F-5902 says the same). Drop it.
- **F-5201 (#13)**: `proposedApi` is empty. #13 needs `contribViewsRemote` and `extensionsAny` to detect the companion.
- **F-5202 (#15)**: `proposedApi` is empty, but #15 needs `extensionsAny` to detect the companion. `processes` holds two extensions (the WSL and tunnels companions), which are not processes.
- **F-5002 (#12)**:
  - `commands` leaves out `opensshremotes.openConfigFile`, the hand-over target in the 7.E3 error path.
  - `contextKeys` lists only `viewItem`. The issue's guard paths also depend on the row keys: sshGroup, tunnelGroup, sshRemoteTarget, tunnelRemoteTarget, remoteFolder, tunnelWsl and both remoteTunnelSignIn keys.
  - The question calling section 19 (R-46) dangling is wrong, because #12 has a section 19.
  - The row has no "spec cites material not for the clean side" note, though #12 cites an evidence pack and observation runs.
- **F-5901 (#7)**:
  - `commands` leaves out the invented `remote-internal.*` ids that the issue lists: sshHostsChanged, getActiveSshRemote, getConfiguredHostnames, getSshFoldersHistory, deleteSshFolderFromHistory and openRemoteSshTarget.
  - It also leaves out `workbench.action.openIssueReporter`.
  - Cite F-5301 is missing.
  - The row does not record that `contribRemoteHelp` is deliberately not requested.
- **F-5902 (#14)**: cites `remote-explorer#F-5301`, `remote-server#F-8302` and `remote-server#F-8902` are missing.
- **F-5001 (#17)**: cites F-5102, F-5103, F-5104, F-5201 and F-5202 are missing.
- **F-5102 (#9)**:
  - `stableApi` leaves out `workspace.onDidChangeConfiguration`, which #9 names as the trigger for re-reading the host list.
  - `localFiles` and `workspace.fs` describe reading the SSH config directly, but F-5902 says the config is read only through the companion.
  - `commands` leaves out `remote-internal.getConfiguredHostnames` and `remote-internal.sshHostsChanged`, which F-5902 specifies for this flow.
- **F-5104 (#11)**: #11 lists `remote.SSH.foldersSortOrder` as a legacy key with no effect. The row should mark it that way and drop its "typo?" question. `menus` leaves out view/item/context#19, an owned atom.
- **F-5301 (#16)**: the stored view-state keys the issue checks are missing: `~remote.forwardedPortsContainer` (with `.hidden`), `workbench.view.remote.state.hidden` and `workbench.explorer.views.state.hidden`.

## 3. Component doubts

- **F-5901 and F-5001** describe the same thing under two names (`explorer.identity-and-standdown` and `explorer.package-and-activation`): package properties, activation and the R-54 stand-down. Their libraries disagree: lib-standdown and lib-identifiers. F-5001 names the gating key `remote-explorer.serving`, but F-5901 leaves it unnamed.
  - Fix: merge them into one component with the stand-down step in lib-standdown, and add the key to F-5901's table of invented ids.
- **The R-46 no-row guard** is owned by F-5002, but the same behaviour appears in:
  - F-5101 6.7
  - F-5102 6.6
  - F-5103 7.E5
  - F-5104 7.E6 and §19
  - F-5201 §19
  - F-5202 7.E9 and §19
  - F-5001 7.E1

  F-5002 names `lib-identifiers` as its library, which is wrong.
  - Fix: one shared command-guard helper that all 13 handlers reuse, with the other rows pointing to it.
- **F-5102** uses `lib-ssh` and reuses `remote-ssh-config-parser`. That conflicts with F-5902, where hosts come from the companion and the explorer reads no files.
  - Fix: use `lib-companion` and drop the parser reuse.
- **F-5201** has `candidateLibrary: none`, but its sign-in state lookup is part of the F-5902 contract.
  - Fix: use `lib-companion`. The `core-authentication` reuse is doubtful, because sign-in is delegated.
- **F-5104** uses `lib-authority` only, but reading and deleting history go through the companion.
  - Fix: add `lib-companion` and keep lib-authority for the remote folder URI.
- **F-5103 and F-5104** both list `editor-cli` under reuse, but neither issue uses the CLI.
  - Fix: drop it.
- **F-5301** is an integration matrix, not a runtime component (`explorer.family-matrix`).
  - Fix: mark it as a test target with no component.
- **F-5202**: the companion extensions are listed under `processes`.
  - Fix: move them to `reuse`.

## 4. Dangling citations

- F-5102 row: `remote-ssh#config-parsing` is not an id. The likely target is `remote-ssh#F-2202`.
- F-5202 row: `remote-explorer#F-8201` points to the wrong repo. It should be `remote-server#F-8201` (remote-server #14).

## 5. Shared-behaviour candidates

- **R-54 stand-down**:
  - Rows that use lib-standdown: explorer F-5901, containers F-1406, wsl F-6001.
  - Rows that use lib-identifiers: explorer F-5001, ssh F-3901, server F-8901.
  - Pick one library for all of them.
- **R-46 out-of-context guard**: the same flow appears in rows in remote-containers-03, remote-server-19, remote-ssh-22 and remote-wsl-32/33. It should be one helper.
- **Companion command contract**: explorer F-5902, ssh F-3906, F-2503 and F-2202, and server F-8201 should share one `lib-companion` (typed client plus serving helper). ssh F-2503 is marked `lib-identifiers`, which does not match.
- **`remote.SSH.configFile` host list**: explorer F-5101, F-5102 and F-5103, plus the ssh host-list rows (F-2202, lib-ssh). There should be a single parser on the ssh side; the explorer consumes it through the companion.
- **`ssh-remote+<alias>` authority and the vscode-remote folder URI**: explorer F-5103 and F-5104 plus ssh rows in remote-ssh-22, -29 and -31. Put them in `lib-authority`.
- **`contribViewsRemote` view registration**: explorer F-5101, containers F-0906 (lib-product), ssh-22 and wsl-32. This could be one shared `views.remote` registration helper.
- **Recent folders under a target**: explorer F-5104 and wsl F-6503 (`wsl.explorer-recent-folders`, library none) describe the same flow and should share one component or library.
