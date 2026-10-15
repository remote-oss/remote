# Task card containers-30: the Dev Containers view registered, its tree adapter, welcome and placements

Issue: #963. Milestone 0.4. Size: L. Builder: `task:claude`.

**Design:** athena's ruling on #960 (§1, §3, §4; card 1, the adapter half), `brief-release-1.md` and `components.md`
as amended in #961. **Builds against** containers-29's interface (#962, §2). Start in parallel and merge after it.

Sources: F-0906 (remote-oss/remote-containers#72) §3.3, 7.E1, §16; F-0901 (#76) §3.1, §3.3 (welcome, title and item
menus), 6.1, 6.7, 7.E1, BR-6, BR-7, BR-12, BR-13, §16; F-1406 §3 and §5 (stand-down); F-0101 BR-9; tooling-31.

## 1. The change

### 1.1 The gate identity and the probe (#960 §4)

- `src/extension.ts`: the gate identity's `viewIds` goes from `[]` to `[views.targetsContainers]` (the generated
  identifier). `contribViewsRemote` is then probed, and a missing grant joins F-0101 BR-9's one setup notice. No new
  text.
- Ruling 9 as amended: a missing `contribViewsRemote` holds back only this view. Commands stay registered.

### 1.2 The adapter (`src/explorer/targets-view.ts`, new; the editor adapter in `extension.ts`)

Modelled on remote-explorer's `view/tree-adapter.ts` (`showTargets`):
- **The focus check:** create the tree view only when `targetsContainers.focus` is among the commands. Otherwise create
  nothing and register nothing (7.E1, F-0906 AC-16: no "No view is registered" notification).
- **The tree:** `createTreeView('targetsContainers', {treeDataProvider, showCollapseAll: false})`. Every node's `id`
  is the model's id (BR-13). Headers and rows start `Expanded`. A row with no children is `None`.
- **Icons:** `vmActive` is the package's `resources/light|dark/vm-active.svg`. The others are
  `ThemeIcon('vm-running')`, `ThemeIcon('vm')` and `ThemeIcon('vm-outline')`. Add the two SVGs (light and dark) as
  the package's own art, under its licence notes. Never copy a reference file.
- **A rebuild (BR-12):** read the engine, build the next tree with `targetsTreeOf`, then swap it in and fire
  `onDidChangeTreeData(undefined)` once. While a read runs, `getChildren` answers from the previous tree, never with
  `[]`. Concurrent requests share one read.
- **The context keys:** after each rebuild, `setContext` the three keys `remote-containers:needsDockerStartOrInstall`,
  `remote-containers:noContainersWithFolder` and `remote-containers:noContainersWithoutFolder` to whether the
  tree's `welcome` is that key. Add each to `identifiers.json` with setter `extension`, verbatim (tooling-31).
- **Reads:**
  - the list through C2 (`EngineHost.run` with `LIST_ARGUMENTS`, then `inspectArguments`). **The engine:** while C10
    holds a connection, the held connection's engine (`heldConnection().engine`), whatever `dockerPath` says now
    (F-0901 6.21 step 4, AC-45; athena on #965). Otherwise, the engine C10's `toolsOf` makes for the current
    `dockerPath`. A failed run, or a list `listedContainersOf` can't read, is `'unreachable'`;
  - `window.folderOpen` from `workspace.workspaceFolders`;
  - `window.connection` from a new C10 accessor, `heldConnection(): {containerId, hostPath, remoteWorkspaceFolder,
    engine} | undefined`, next to `heldIdentity` in `connector.ts`. It reads `Held`, which already carries the
    engine, and never derives anything from labels. The model gets the first three fields;
  - `withConfiguration`: for each dev container, a file-exists port decides BR-11 by AC-43's cases. The
    configuration is the `devcontainer.config_file` label when it names an existing file. Otherwise it's the
    folder's `.devcontainer/devcontainer.json`, then `.devcontainer.json`. A missing folder means no configuration.
- **When it rebuilds in this card:** when the view becomes visible (`onDidChangeVisibility`), and on Refresh.
  containers-31 adds the events and the `dockerPath` change. No timer.

### 1.3 The manifest (`package.json`, the nls files)

- **`views.remote`:** exactly F-0906 §3.3's `targetsContainers` row: name `Dev Containers` (nls), group
  `targets@2`, `when` `!hideConnectCommands` verbatim (no stand-down clause on a view, #960 §3), `remoteName`
  `["dev-container", "attached-container", "exec", "k8s-container", "apple-container"]`. Contribute no
  `detailsContainers` and no `devVolumes`.
- **The command** `remote-containers.explorerTargetsRefresh`: title `Refresh`, category `Dev Containers`, icon the
  package's `resources/light|dark/refresh.svg`. `menus.commandPalette` gets `when: "false"` (BR-7).
- **`viewsWelcome`** for `targetsContainers`, with #960's link rule. Each `when` adds
  `&& !remote-containers:standingDown` on each top-level alternative:
  - **#0** on `remote-containers:needsDockerStartOrInstall`: "Get started with containers by installing Docker or by
    visiting the help view. [Refresh](command:remote-containers.explorerTargetsRefresh) after installation and
    startup." `installDocker` and `~remote.helpPanel.focus` aren't registered in 0.4, so their words stay and their
    markup goes;
  - **#2** on `remote-containers:noContainersWithFolder`: F-0901's text. The links to `newContainer`, `trySample`
    and `openFolder` become plain words (`openFolder` turns back into a link with containers-17, #936). The link to
    `remote-containers.reopenInContainer` stays;
  - **#3** on `remote-containers:noContainersWithoutFolder`: F-0901's text, with `newContainer` and `openFolder` as
    plain words;
  - no #1 (`needsSSHCredentials`).

  Keep each sentence's words and punctuation exactly as authored. Only the `[…](command:…)` markup of an
  unregistered command goes. The l10n bundles carry the same texts.
- **`menus["view/title"]`:** `#0` only, Refresh, group `navigation@3`, `when` `view == targetsContainers &&
  !remote-containers:needsDockerStartOrInstall && !remote-containers:noContainersWithFolder &&
  !remote-containers:noContainersWithoutFolder && !remote-containers:standingDown`. No `#1` or `#2` (their commands
  aren't in 0.4).
- **`menus["view/item/context"]`:**
  - `#10` `workbench.action.closeFolder`, group `1_folder@1`, `when` `view == targetsContainers && viewItem =~
    /(^| )activeFolder( |$)/ && !remote-containers:standingDown`;
  - `#21` `remote-containers.rebuildContainer`, group `2_container@1`, `when` `view == targetsContainers && viewItem
    =~ /(^| )own( |$)/ && viewItem =~ /(^| )dev( |$)/ && !hideRebuildCommands && !remote-containers:standingDown`.
- **tooling-31:** the view is consumed through `createTreeView`, and the three keys through `setContext`. Nothing is
  allowlisted.

### 1.4 Refresh

`remote-containers.explorerTargetsRefresh` rebuilds now (6.7). It's registered with the package's other commands,
under the stand-down rule.

## 2. Rows

### 2.1 Unit

- `targets-view.test.ts` over a fake editor:
  - no `.focus`, no tree view;
  - the tree's items: ids, icons, states, tooltips, descriptions, `contextValue`;
  - one `onDidChangeTreeData` per rebuild;
  - `getChildren` during a read answers the previous tree, never `[]`;
  - two Refreshes during one read make one read;
  - the three `setContext` calls for each welcome key and for none;
  - an unreachable read sets `needsDockerStartOrInstall`.
- `connector.test.ts`: `heldConnection()` while held, with the held engine, and none before and after.
- In a dev container window, the list read uses the held engine, also after a `dockerPath` change.
- `withConfiguration`: AC-43's cases (a)–(d), and a missing folder.
- The manifest test: the view row, the welcome texts (no `command:` link to an unregistered command), the two
  placements, the title action, `commandPalette` `false`, and the stand-down clause on every welcome and menu
  entry, never on the view.
- The identity: `viewIds` is `['targetsContainers']`.

### 2.2 Acceptance (the containers launches; renderer helpers in `windows/renderer.ts`)

Add a renderer helper `viewRows`-style reader for the Remote Explorer, if `viewRows` doesn't already read a
`views.remote` view (try it first), and `remoteExplorerOptions(name)` (the "Switch Remote" select's options).

| # | Launch | Rows |
|---|---|---|
| Gate 13 | `containers` | "View: Show Remote Explorer" (`workbench.view.remote`) in a local folder window shows a "Dev Containers" view. The dev container of a reopened folder (as gate row 1 makes it) is a row under "Dev Containers" labelled with the folder's name. A `docker run -d --label remote-oss.acceptance.run=<id> <image> sleep 600` container is a row under "Other Containers" labelled with the image (F-0906, F-0901 AC-7) |
| Gate 15 | `containers` | with no container of the run and a folder open (remove the run's containers first), the view shows #2's text, and its "reopen the current folder in a container" link starts Reopen (F-0901 AC-1) |
| Gate 16 | `containers` | in the dev container window, its own row's icon is `vm-active` and its tooltip ends `Connected` (F-0901 AC-4) |
| Gate 17 | `containers-no-proposals` | the Remote Explorer has no "Dev Containers" view, no error notification appears, and the setup notice names Dev Containers (F-0906 AC-16, F-0101 BR-9). Extends gate row 10's file |
| Coexistence | a launch with remote-explorer installed too: add `remote-oss.remote-explorer` to a new launch `containers-explorer`'s `withExtensions` | the "Switch Remote" options are "Remotes" and "Dev Containers"; each shows its own view; no error notification in either |

## 3. The catalogue

F-0906 and F-0901 ACs that these rows prove become `acceptance` or `unit`. Leave the rest to containers-32 (the
coverage card).

## 4. Gates, review and open rows

Run all gates, the containers launches and the VSCodium run. PR title: `remote-containers: the Dev Containers view
registered, its tree adapter, welcome and placements (card containers-30, #963)`. Request athena only.

**Open rows (stop and report on #963):**
1. Core creates the view without `contribViewsRemote`, or `.focus` exists without it.
2. `createTreeView` keeps a collapsed header collapsed only with something beyond stable ids.
3. "Switch Remote" orders the two options differently from F-0906 BR-3.
4. A welcome text needs a change beyond dropping an unregistered command's markup.
