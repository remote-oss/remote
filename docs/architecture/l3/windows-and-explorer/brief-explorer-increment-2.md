# Design brief: Remote Explorer increment 2 (0.3), recent folders and the companion's other four ids

Issued by athena on 2026-10-19 for daedalus, who writes the cards from it. Tracking issue: #745. This brief extends
`brief-remote-explorer.md` ("Increment 2") and leaves slice 1 as built.

**Sources:**
- remote-oss/remote-explorer: #11 F-5104 (reviewed), #9 F-5102 (reviewed), #8 F-5101 (reviewed), #14 F-5902 §5
  (reviewed, the interface's single text, copied in `packages/lib-companion/docs/companion-interface.md` 1.0);
- remote-oss/remote-ssh: #61 F-2503 (reviewed; Q4 open), #83 F-3906 rules 3, 5, 7, 9 and 11;
- `contracts.md` §4 and §6 (this folder) and `components.md`.

Cards are written after the slice-1 gate passes (#745).

## 1. Scope

**In:**
- **F-5104, the recent folders**, for SSH hosts: folder rows under each host row, the two settings, the three
  folder commands and "Remove from Recent List".
- **The companion's other four ids:**
  - remote-ssh serves `getSshFoldersHistory` and `deleteSshFolderFromHistory`;
  - remote-ssh pushes `setActiveFolders` to the explorer;
  - remote-ssh signals `sshHostsChanged` to the explorer.
- **The folder history store** in remote-ssh (F-2503 BR-1 to BR-15), which the two history ids read and change.
- **F-5102's two hand-overs** on the "SSH" group row: "Open SSH Config File" runs `opensshremotes.openConfigFile`,
  and "New Remote" runs `opensshremotes.addNewSshHost`.

**Out:**
- **Tunnels (D-55):** the `folder-active` mark (it comes only from the tunnels companion's `getActiveRemote`), the
  `tunnelWsl` rows and their actions, folder rows under tunnel machines, and remote-server's `setActiveFolders`
  push. So increment 2 has one push caller, remote-ssh, and the inbox doesn't wait for a second.
- **Windows and macOS SSH hosts:** F-2503 Q4 (the path form on those hosts) is open. As in ssh-provider-01, build
  and test for Linux SSH hosts only; the criteria that need the other path forms stay `deferred` with the reason
  `F-2503 Q4: path form on Windows and macOS hosts`.
- **F-5301** stays in increment 3.

## 2. The interface stays 1.0

Nothing below adds a field or changes a payload. The rulings in this section settle what F-5902 §5, F-2503 and
F-3906 leave open between the two packages. They're also recorded in `contracts.md` §6 next to RR-1 to RR-5.

1. **Duplicates.** The store never holds a path twice under one key (F-2503 BR-1: a re-recorded path moves to the
   top). The explorer still renders whatever it receives, one row per entry and repeats kept (F-5104 BR-3,
   interface "repeats kept"). Both rules hold at once.
2. **A host's last entry.** When a delete removes a host's last entry, the store drops the host (F-2503 BR-7).
   `getSshFoldersHistory` therefore never sends a host with no entries. The explorer treats a host with no entries
   and a host that's absent the same way: a leaf row, or collapsed when the collapse setting is on.
3. **Window kinds for the push.** F-3906 rule 7 names SSH windows and local windows. Any window whose authority
   isn't `ssh-remote` (a container, WSL or tunnel window, or a local one) pushes as a local window does: outcome
   `"none"` and no `hostKey`. The push only wakes the explorer, so this is all that window has to say.
4. **`folders` is never sent.** The field is optional, and the receiver uses nothing of the push (F-5902 §5).
   remote-ssh leaves it out in every window.
5. **One signal per trigger, with no debounce.** Each qualifying save and each host written by "New Remote" sends
   exactly one `sshHostsChanged`, within 1 s (F-5902 AC-9, AC-29). Two saves send two signals.
6. **`sshHostsChanged` is a push:** the envelope only, no result. remote-ssh's `identifiers.json` lists it as
   `called`, kind `change`. The card corrects that to `push`, as in lib-companion and the explorer.
7. **The host key has one source.** Both packages take it from lib-companion's `hostKeyOfAuthority`: the
   authority's host part as written (RR-2, F-2503 BR-4). So the key the store writes and the alias the explorer
   matches it against (exactly, case-sensitive, F-5104 BR-2) come from the same function.
8. **Which side decides the kind.** The explorer decides how a row is labelled and how it opens from the row's path
   (F-5104 BR-15; F-5902 §5, "The view decides the kind exactly as it labels the row"). It reads the history entry's
   `kind` field but doesn't use it. remote-ssh opens by the `kind` that `openRemoteSshTarget` carries and never runs
   its own path test.

## 3. Provider side: remote-ssh's `ssh.companion-endpoints`

This component (`components.md`) gains everything it doesn't serve yet: the history store, the two history ids,
the push and the signal. It keeps slice 1's three ids as they are.

### 3.1 The history store (F-2503)

- **Shape and order:** one ordered list per host key, most recent first, with folders and workspace files in the
  same list (BR-1). There's no limit and no pruning (BR-6, BR-12).
- **Where it lives:** `ExtensionContext.globalState` of `remote-oss.remote-ssh`, under the key `folder.history.v1`.
  F-2503 BR-10 makes the name reference data, not a contract, so the family's convention decides it. F-3901 records
  that convention for remote-ssh's other stores (F-2102, F-2305, F-2306, F-2307, F-2501, F-2702): our id, the
  reference's inner names, and nothing migrated. The value format is ours, and another extension's global state
  can't be read anyway.
- **What is recorded:** once per extension-host session, in an SSH window with a folder or a workspace whose first
  resolve succeeded (BR-2, BR-5). remote-ssh learns this from lib-authority's resolver handle, through
  `onFirstResolveSettled` and `lastResolve() === 'succeeded'`. No lib-authority change is needed.
  - The entry is written before anything waits on workspace trust (BR-2).
  - A multi-root workspace records its workspace file.
  - The path is the `vscode-remote` URI's path with no trailing `/` (BR-3).
  - The key is per section 2 ruling 7 (BR-4).
  - Empty windows, file-only windows, local windows and failed connections record nothing (BR-5; F-2503 AC-28).
- **Writes survive across windows** (BR-15): every write reads the stored value at that moment and writes the
  result, never from a copy kept in memory. Two windows writing a second or more apart both survive.
- **Nothing notifies other windows** of a change (BR-11). The explorer in another window sees it after Refresh
  (F-5902 AC-10).

### 3.2 The two history ids (F-3906 rules 3, 5, 9 and 11)

- **`getSshFoldersHistory`** (query) returns the store in its own order. It never sorts by a view setting and never
  sends a host with no entries (section 2 ruling 2).
- **`deleteSshFolderFromHistory`** (change) removes every copy of `path` under `hostKey` and nothing under any
  other key, keeps the order of the rest, drops a host left empty, and answers `{changed}`. It shows nothing and
  logs nothing (rule 5).
- **Foreign, missing or unknown-major arguments** go through lib-companion's `serve` as in slice 1: never acted
  on, silent (rule 11). On the first unknown-major payload, the existing mismatch line is written once.
- **The `onCommand:` events** for both ids stay as they are on main. Their registrations replace the "not
  registered" of ssh-provider-01.

### 3.3 The `setActiveFolders` push (F-3906 rule 7, F-2503 BR-14)

- **Once per extension-host session**, and only in a window with a folder or a workspace. It's never sent in an
  empty window, and never again after a folder change within the session (F-5902 AC-31). A new extension host makes
  its own one call: a reload, or the first folder added to an empty window.
- **In an SSH window:** sent when the session's first resolve settles, through `onFirstResolveSettled`, with outcome
  `"connected"` or `"failed"` and the host key. Timing: within 2 s after the resolve ends (F-3906 C-10).
- **In any other window** (section 2 ruling 3): sent right after remote-ssh activates, with outcome `"none"` and no
  host key. remote-ssh activates lazily, so in a local folder window the push follows that activation, and the
  first call it receives is still the explorer's `getActiveSshRemote` (F-5902 AC-30).
- **Delivery:** with lib-companion's `fireAndForget`. A rejection, including a missing explorer and core's
  "not found", is swallowed with no UI and no log line. No `folders` field (section 2 ruling 4).

### 3.4 The `sshHostsChanged` signal (F-3906 rule 7, F-2203 BR-9, F-2204)

There are exactly two triggers, each sending one signal within 1 s (section 2 ruling 5), delivered with
`fireAndForget`:
1. **A save of a tab that remote-ssh's own "Open SSH Configuration File..." opened,** while that tab stays open.
   The system-wide file counts too. The watch belongs to the tab and ends when the tab closes. Saves from any other
   editor, of an included file, by another program, or of an unrelated file send nothing, and neither side watches
   files. Card remote-ssh-19 left this save watch out, waiting for F-3906; this card adds it to the command that
   already exists.
2. **"Add New SSH Host..." has written a host entry:** sent after the write, and not when nothing was written (F-2204
   §16). It goes into connect-22's existing command.

No signal is sent for a `remote.SSH.configFile` change, because the explorer has its own listener (RR-3), and none
for a history change.

## 4. Explorer side

### 4.1 `explorer.recent-folders` (F-5104)

**Rows**
- Folder rows are children of the SSH host row whose alias equals the history key exactly (BR-1, BR-2). Keys that
  match no host appear nowhere.
- One row per entry, repeats kept, no limit (BR-3).
- Context value `remote-explorer.remoteFolder`. A row is a leaf with no icon and no command, and Enter and Space run
  nothing (§3.3).
- Each row's id is unique per row, built from the alias and the position, never from the path alone (§16).

**Presentation** (BR-14). One pure function gives a row's label, description, tooltip and accessible name from the
path, the alias and the client platform, by BR-14's table and its Windows-form column. Slice 1's `fsPath` recipe
matches only the Linux column, so the card doesn't reuse it.
- The label is the base name, with " (Workspace)" for a workspace.
- The tooltip is `'<path>' on <alias>`, and the accessible name adds ", has actions" (decision Q4).

**Workspace or folder** (BR-15, remote-explorer#18, AC-53). A path whose base name ends in lower-case
`.code-workspace` and has something before it is a workspace. Anything else is a folder, so a file named just
`.code-workspace` is a folder row labelled ".code-workspace". The slice-1 row model's test (`endsWith`) labels and
opens that case wrongly, and the card fixes it for both the label and the open kind (section 2 ruling 8).

**Settings** (§3.2, BR-4 to BR-7, BR-12)
- `remote-explorer.foldersSortOrder` and `remote-explorer.collapseRecentFolders`, both `application` scope, are
  contributed with the spec's texts. STR:S004 is a runtime `l10n` string.
- Only the user value counts. A folder value, any other value and the legacy `remote.SSH.foldersSortOrder` give the
  default (BR-6).
- "alphabetical" compares the full recorded string by code unit, case-sensitive and not locale-aware, so
  duplicates stay adjacent (BR-5).
- Collapse is read by truthiness (BR-7).

**Expansion** (BR-7, BR-8)
- A host row has three states: expanded (it has history and collapse is off), collapsed (collapse is on), or a leaf
  (no history and collapse is off). Slice 1's tree item knows only expanded or none, so the card adds the collapsed
  state.
- Expansion isn't remembered across a window start. A manual expansion survives Refresh (BR-9).

**Builds** (F-5104 BR-9, BR-10; F-5902 §5 "Order and failures")
- Every full build (first show, window start, Refresh) calls `getSshFoldersHistory` together with
  `getConfiguredHostnames`, right after `getActiveSshRemote`, each with its 10 s limit. It renders when all have
  answered or failed.
- A full build re-reads both settings. A setting change doesn't rebuild by itself (BR-10).
- A failed history call shows the host rows as leaves (F-5902 AC-16).
- An `sshHostsChanged` build rebuilds the host rows only, and the folder rows keep the last list read (F-5902 §5).

**Commands and menus** (§3.1)
- `remote-explorer.connectToFolderInCurrentWindow` and `connectToFolderInNewWindow` are inline and in the context
  menu. `remote-explorer.deleteFolderHistoryItem` is in the context menu only. All three are hidden from the palette
  (`when: false`).
- **`when` clauses:**
  - the connect clause keeps the spec's `viewItem == remote-explorer.remoteFolder || viewItem ==
    remote-explorer.tunnelWsl` under D-55 (AC-34), as slice 1's host menus keep `tunnelRemoteTarget`;
  - remove is `remoteFolder` only;
  - every entry also has `&& !remote-explorer.standingDown`.
- **Opening a row** calls `openRemoteSshTarget` with the host key, the path, the kind from the path rule, and the
  window. This is connect-actions' existing path with the row's path and kind added.
- **Out of context** use is safety only (7.E6, §19).

**Remove** (BR-13, 7.E7, AC-20, AC-39)
- "Remove from Recent List" calls `deleteSshFolderFromHistory` with no confirmation and no undo.
- On any answer, `changed` true or false, the view drops every row of that path under that host at once and
  doesn't re-read the history. On a rejection or the 10 s limit, the rows stay where they were.
- The extension shows nothing in any case (BR-16).

**Without the companion:** without remote-ssh (C0) there are no folder rows (7.E5). The web entry always behaves as
C0.

### 4.2 `explorer.inbox`

- **`setActiveFolders`** is served as a push that does nothing. Its `onCommand:` event is what wakes the explorer;
  nothing in the payload is used or stored, and it isn't checked against workspace trust (F-5902 §5, F-5101). A
  call with no argument or a foreign one is silent (F-5001 AC-11, through `serve`).
- **`sshHostsChanged`** is served as a push that starts a host-rows build. It doesn't activate the explorer
  (`activates: false`, #638). When the explorer isn't active, the call fails, and remote-ssh's `fireAndForget`
  swallows that.
- **Both entries register the inbox.** In the web entry nothing calls it.

### 4.3 `explorer.ssh-group`: the two hand-overs (F-5102)

- `remote-explorer.configureSsh` ("Open SSH Config File", `$(gear)`) and `remote-explorer.add` ("New Remote",
  `$(plus)`) appear inline and in the context menu of the "SSH" group row only (`viewItem ==
  remote-explorer.sshGroup`, AC-1, AC-2, AC-15, AC-30). There's no view-title action and no welcome content.
- Each runs its remote-ssh command with no argument and no envelope (§16; F-5902 §5). It awaits the command and
  swallows a rejection: no notification, no dialog, and none of core's "Error running command" (F-5902 AC-22,
  F-5102 BR-12).
- Neither runs without the companion (7.E7). A host the companion adds appears through `sshHostsChanged`, with no
  Refresh (AC-13, AC-22). `remote-explorer.add` on the tunnels group is out with D-55; the handler tells the groups
  apart by the row argument.

### 4.4 Manifest and identifiers

- **The explorer's `identifiers.json`:**
  - gains `getSshFoldersHistory` and `deleteSshFolderFromHistory` as called;
  - gains the two settings;
  - gains the three folder commands and the two hand-over commands.
- **The allowlist:** the four #745 entries in `tools/unconsumed-allowlist.json` (explorer's `setActiveFolders` and
  `sshHostsChanged`, remote-ssh's two history ids) come out with the cards that consume them.
- **Activation events stay as they are** (F-5001 AC-15; `sshHostsChanged` has `activates: false`).
- **remote-ssh's `identifiers.json`** gains `setActiveFolders` as called (push) and corrects `sshHostsChanged` to
  `push` (section 2 ruling 6).

## 5. One spec question, which blocks no explorer card

**"New Remote" into a configuration file that doesn't parse.**
- F-5102 7.E5 (reviewed) says the companion's own parse error shows, as it does from the companion's palette
  command.
- F-2201 7.E1 and AC-32 (draft), with my Q1(a) ruling of 2026-10-14 on remote-ssh#28, say the Remotes-view route
  shows nothing.
- The explorer calls `opensshremotes.addNewSshHost` with no argument, exactly as the palette does, so remote-ssh
  can't tell the two routes apart. The specs ask one command for two behaviours.
- Under Q1(a) the command throws: core shows the error on the palette route, and on the Remotes-view route the
  error lands in the explorer's awaited call, which shows nothing.
- The question for the spec side: should remote-ssh show its parse error itself, on every route?
- The explorer's card is the same under either answer (section 4.3), and F-5102 AC-36 tests only safety. So the
  question holds only remote-ssh's wording in F-2201, and Q1(a) stands until it's answered. It's filed on
  remote-ssh#28 and goes to the spec side through hermes.

## 6. Cards, in this order

| # | Card | Package | Content | After |
|---|---|---|---|---|
| 1 | ssh-provider-02 | remote-ssh | the history store and its recording (section 3.1), and the two history ids (3.2) | the slice-1 gate |
| 2 | explorer-06 | remote-explorer | the recent folders (4.1): rows, presentation, the workspace rule fix, settings, expansion, builds, the three commands, Remove; built against lib-companion's recording fake, which already answers history and delete | the slice-1 gate; in parallel with 1 |
| 3 | ssh-provider-03 | remote-ssh | the push (3.3), the signal on both triggers (3.4), and the `identifiers.json` fixes (4.4) | 1 |
| 4 | explorer-07 | remote-explorer | the inbox (4.2), the two hand-overs (4.3), and the identifier and allowlist entries (4.4); against the fake, which already records the push's `outcome` | 2; in parallel with 3 |
| 5 | coverage and gate | both | the tags of the increment-2 criteria and the gate rows below | 1 to 4 |

Each card cites the rules it implements, and each card's rows are unit rows over fakes plus the acceptance rows
that need the editor. A criterion that needs the Windows or macOS path forms is deferred (section 1).

## 7. Acceptance: the increment-2 gate

**Coverage.** Every criterion tagged `explorer slice 1: increment 2` in `coverage-explorer-slice1.tsv`, and F-2503's
criteria that the cards build, gets its final tag. `check-coverage` is green.

**Rows in the VSCodium run**, in a plain editor with both extensions and their proposals:
1. After connecting to `harness` on a folder, then on a workspace file, the "harness" row expands to both, most
   recent first, in a second window after Refresh (F-5104 BR-1, BR-3; F-5902 AC-10).
2. With `foldersSortOrder` set to "alphabetical" and Refresh, the rows sort by code unit. With
   `collapseRecentFolders` on and Refresh, every host row starts collapsed (BR-5, BR-7).
3. "Connect in New Window" on a folder row opens that folder on `ssh-remote+harness` in a new window, and "Connect
   in Current Window" on the workspace row opens the workspace (BR-15).
4. "Remove from Recent List" removes the row at once and, after a reload, it's still gone (BR-13; F-2503 BR-7).
5. "New Remote" with a new host: the host row appears within 2 s, with no Refresh (F-5102 AC-13).
6. "Open SSH Config File", an edit adding a `Host` and a save: the host row appears within 5 s. A save of the same
   file opened through Quick Open changes nothing (F-5102 AC-22, AC-44).
7. Without remote-ssh: no folder rows, the absent-companion state, and nothing fails (F-5104 7.E5).
8. In a local folder window, opening the Remote Explorer view activates both extensions, and the companion's first
   call received is `getActiveSshRemote` (F-5902 AC-30).

Rows 5 and 6 need connect-22's and remote-ssh-19's commands, which are on main. Row 8 reads the test build's
record, as slice 1's gate does.
