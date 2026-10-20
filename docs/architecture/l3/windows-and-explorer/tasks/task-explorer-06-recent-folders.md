# Task card explorer-06: the recent folders under the SSH host rows (F-5104)

Issue: #1096. Release 0.3, Remote Explorer increment 2 (#745). Size: L (two PRs). Builder: `task:claude`.
**Built only after the slice-1 gate rows (#645) merge**, because it changes the row model, the tree and the host
rows those rows prove (brief §6 as amended by #1086). It can be read and planned now. It's built against
lib-companion's recording fake, which already answers the history and the delete, so it doesn't wait for
ssh-provider-02 (#1088).
Design: `docs/architecture/l3/windows-and-explorer/brief-explorer-increment-2.md` §2 rulings 1, 2, 7 and 8, and §4.1
in full. Read both; this card names the files and the order, and the brief and F-5104 give each rule.

Sources: F-5104 (`remote-oss/remote-explorer#11`), all of it, BR-14's two tables in particular; F-5902 (`#14`) §5
"Order and failures", AC-10, AC-16; F-5101 3.3 (the row ids); card explorer-04 (the host rows) and explorer-05 (the
host connect actions).

## 1. The change, by file

**`model/ssh-group.ts`, the row model:**
- **The workspace rule** (BR-15, remote-explorer#18, AC-53, ruling 8): a path is a workspace when its base name ends
  in the lower-case `.code-workspace` and has at least one character before it. Today's `isWorkspacePath` uses
  `endsWith`, which labels and opens a file named just `.code-workspace` wrongly. Fix it for the label and for the
  open kind together.
- **Presentation** (BR-14): one pure function gives a row's `label`, `description`, `tooltip` and `accessibleName`
  from `(path, alias, clientPlatform)`, by BR-14's table and its Windows-form column. Slice 1's `fsPath` recipe
  matches only the Linux column, so don't reuse it. The tooltip is `'<path>' on <alias>`, and the accessible name
  adds `, has actions` (decision Q4).
- **Order** (BR-5): `orderedPaths` stays, comparing the full recorded string by code unit, so duplicates stay
  adjacent. Rows are one per entry, repeats kept, no limit (BR-3, ruling 1).
- **Row ids:** unique per row, from the alias and the position, never from the path alone (§16).

**`view/companion-calls.ts`:** gains `history()` (`getSshFoldersHistory`, `readFoldersHistory`) and
`deleteFolder(hostKey, path)` (`deleteSshFolderFromHistory`, `writeDeleteRequest`, `readDeleteResult`). `open`
gains the folder form: `open(hostKey, target, folder?: {path, kind})`, with `writeOpenRequest`'s `path` and `kind`.
The kind comes from the path rule above, not from the history entry's `kind` field (ruling 8).

**`view/targets.ts`, the builds:**
- **A full build** (first show, window start, Refresh) calls `history()` together with `hostnames()`, right after
  `activeRemote()`, each with its 10 s limit, and renders when all have answered or failed. It re-reads both
  settings at that moment. A setting change doesn't rebuild by itself (BR-10).
- **A failed history call** shows the host rows as leaves (F-5902 AC-16).
- **A hosts-only build** (`rebuildHosts`, which `sshHostsChanged` will start in explorer-07) keeps the last history
  read.
- **Folder nodes** (`kind: 'sshFolder'`) are children of the host node whose alias equals the history key exactly
  (BR-1, BR-2, `isConfiguredAlias`). Keys that match no host appear nowhere.
- **Context value** `remote-explorer.remoteFolder`. A folder row is a leaf with no icon and no command.

**Expansion** (BR-7, BR-8): `TargetItem.expanded` becomes `collapsibleState: 'expanded' | 'collapsed' | 'none'`.
- A host with history and the collapse setting off is `expanded`.
- A host with the collapse setting on is `collapsed`.
- A host with no history and the setting off is `none`, a leaf (ruling 2: an absent host and a host with no entries
  are the same).
- `tree-adapter.ts` maps the three. Expansion isn't remembered across a window start, and a manual expansion
  survives Refresh (BR-9): keep the row ids stable for that.

**Settings** (§3.2, BR-4 to BR-7, BR-12): `remote-explorer.foldersSortOrder` and
`remote-explorer.collapseRecentFolders`, both `application` scope, contributed with the spec's texts and defaults.
- Only the user value counts. A folder value, any other value, and the legacy `remote.SSH.foldersSortOrder` give
  the default (BR-6).
- Collapse is read by truthiness (BR-7).
- STR:S004 is a runtime `l10n` string.

**Commands and menus** (§3.1):
- **The connect commands:** `remote-explorer.connectToFolderInCurrentWindow` and `connectToFolderInNewWindow`,
  inline and in the context menu. The `when` clause keeps the spec's `viewItem == remote-explorer.remoteFolder ||
  viewItem == remote-explorer.tunnelWsl` (D-55, AC-34), as slice 1's host menus keep `tunnelRemoteTarget`.
- **The remove command:** `remote-explorer.deleteFolderHistoryItem`, in the context menu only, with `viewItem ==
  remote-explorer.remoteFolder`.
- All three are hidden from the palette (`when: false`), and every entry also has `&&
  !remote-explorer.standingDown`.
- **Opening a row** calls `open(hostKey, target, {path, kind})`. That's explorer-05's path with the row's path and
  kind added. A handler given anything that isn't a current folder node does nothing (7.E6).

**Remove** (BR-13, 7.E7, AC-20, AC-39): `deleteFolder` with no confirmation and no undo.
- On an answer, `changed` true or false, the view drops every row of that path under that host at once, and
  doesn't re-read the history.
- On a rejection or the 10 s limit, the rows stay.
- It shows nothing in any case (BR-16).

**Without the companion** (7.E5): no folder rows. The web entry always behaves as without it.

**Manifest and identifiers** (brief §4.4):
- The explorer's `identifiers.json` gains `getSshFoldersHistory` and `deleteSshFolderFromHistory` as called, the
  two settings, and the three folder commands.
- `package.json` and the string tables gain them too, in every locale, as explorer-03a did for slice 1.

## 2. PRs

(a) The row model (workspace rule, presentation, order, ids) with its unit rows. (b) The calls, the builds,
expansion, the settings, the commands and Remove, with their rows and the manifest.

## 3. Rows

Unit rows over lib-companion's recording fake, a fake detector and fake settings. Each row's name starts with its
F-5104 cite. A label in parentheses must be `[a-z0-9-]`.
- **Model:**
  - every row of BR-14's two tables (AC-27, AC-51), on a Linux and a Windows client;
  - AC-47 and AC-53 (the workspace rule);
  - AC-52 (the alphabetical order of the Windows forms);
  - 60 entries all listed (AC-27);
  - repeats kept; the ids unique.
- **Builds:**
  - the order of the three calls in a full build;
  - a failed history call leaves leaves (F-5902 AC-16);
  - a hosts-only build keeps the history;
  - a setting change doesn't rebuild;
  - a key that matches no alias, and a case-different key, show nowhere (BR-2).
- **Expansion:** the three states; a manual expansion survives a Refresh build, through stable ids.
- **Settings:** only the user value; the legacy key ignored; collapse by truthiness.
- **Commands:**
  - each connect command opens with the path and the kind from the rule, in the right window;
  - an argument that isn't a current node does nothing;
  - Remove drops every copy at once on `changed` true and on false, keeps the rows on a rejection and on the limit,
    and shows nothing.
- **Manifest rows:** the commands, the menus with their `when` clauses, the settings with their scope and texts.

The acceptance rows are the gate card's (brief §7 rows 1 to 4 and 7), with ssh-provider-02 on main.

## 4. Gates and review

All gates, the changed files at 100 %, `check-identifiers`, `check-consumed` and `check-string-tables` clean. PR
titles: `remote-explorer: the recent folders, <part> (card explorer-06, #1096)`. Request athena only; hermes assigns
the peer.

## 5. Open rows (stop and report on the issue)

1. A row of BR-14's tables can't be produced from the path, alias and client platform alone.
2. `TreeItemCollapsibleState` doesn't keep a manual expansion across a tree refresh with stable ids.
