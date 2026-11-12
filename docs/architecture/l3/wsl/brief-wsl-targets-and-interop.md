# Brief: the WSL Targets view and the nested route (F-6503, F-6701; F-6501, F-6502)

Part of `brief-remote-wsl.md` (#2348), whose §2 rulings apply here. Owner components: `wsl.targets-view` (area B), D9a
exec-spawner and D9b outer-context (D9, no longer provisional).

## 1. Recent folders (F-6503)

- **Parts of `wsl.targets-view`:**
  - `wsl.recent-folders` (pure): core's entries to rows (BR-2 filter, BR-3 grouping, BR-4 order, BR-7 presentation,
    BR-8 active mark);
  - the recent-list port, lifted from remote-containers' `recent-editor.ts` into lib-authority, with a recording fake (it
    reads core's list; there is no store of ours, BR-10, AC-27);
  - the tree adapter and the three handlers.
- **Which entries a window shows:** a local window shows entries with no outer hop; a window whose outer is `<h>` shows
  entries whose raw outer text after `@` equals `<h>`, never re-encoded. The active mark compares the whole authority. An
  entry whose distro doesn't match the live list is hidden (BR-5).
- **Opening:** the entry's authority text goes to the opener unchanged; D6's match is the one place that folds case.
  Nothing passes `isTrusted` (BR-13, AC-25).
- **The handlers** accept only a node of the current model; a string or a missing argument does nothing (BR-11, AC-19),
  and the out-of-context policy is `silent`. "Remove" changes core's list for every window of the user, so it runs only
  on the user's own action.
- **Texts:** labels and tooltips are plain strings with `$(` escaped; STR:S004's `{0}` is the stored path, escaped as
  brief-remote-wsl §2 item 4 says. The icon is the `folder-active` codicon. The menu groups are quoted verbatim
  (`2_folder@`, `inline@1`, `inline@2`).
- **A deleted folder (AC-26), `reading-2348-deleted-folder`:** the extension doesn't stat folders (R-60), so the row goes
  only when core has removed the entry; a spec question asks which was meant.
- **An already-open folder (AC-8):** the card checks on the Windows launch whether core's existing-window check runs
  before the force flags; if it doesn't, the handler uses the opener's "core decides" target.
- **Expanded state:** stable item ids per distro and `Expanded` when the rows load, decided with F-6501 when it is
  reviewed.

## 2. The view itself and its distro actions (F-6501, F-6502, pending)

Both specs have no body yet. Their provisional placement, so nothing else has to wait:
- the view `targetsWsl`, its distro rows and title actions are `wsl.targets-view`'s, fed by D2's `distros` and
  `onDidChange`;
- the distro actions (set default, delete, add, connect) are D12 handlers through D2, with F-6102's flow for "add";
- F-6103's STR:S016 and STR:S008 belong to F-6502; their text is carried now and their ids re-homed when it lands.

They are carded when they are reviewed.

## 3. The nested route (F-6701): D9a and D9b

R-89 and F-6701 BR-8 settle dossier question 3, so D9 is final.
- **D9a exec-spawner:** lib-wsl's spawner, files and session ports over a structural `ExecServer` (`spawn`, `fs.stat`,
  `env()`). Everything above D1 is unchanged. `osPlatform === 'win32'` is the "remote is Windows" test; `osRelease`
  feeds D2's build rules.
- **D9b outer-context:** decodes the window's authority, refuses an outer that isn't `ssh-remote` before any spawn, gets
  the exec server afresh at each use and follows its transport loss, and sets `wslFeatureInstalled` to the outer host's
  WSL presence (brief-remote-wsl §2 item 11).
- **`ConnectInput.execServer`** in lib-authority is landed by this brief's card; remote-containers' F-1302 card builds on
  it. remote-wsl registers no `resolveExecServer`: containers' WSL windows aren't nested (AC-26, AC-27 need no code).
- **The server on this route** comes as on the local route (brief-wsl-connect §2): the client resolves the source,
  downloads into its own kept cache (lib-server's cache root for the client's platform), and the stepwise driver streams
  the archive over the exec server; nothing downloads in the remote distro. F-7902's dialogs are the same (BR-8, AC-34,
  AC-35).
- **The proxy:** D5h runs on the client, keyed with the outer authority, and every relay is a `wsl.exe` spawned on the
  outer host through the exec server; the relay cap of brief-wsl-connect §4 applies. D6's session table and D11's record
  are keyed with the outer authority too.
- **No exec server** (remote-ssh's direct mode, or no CLI for the host): `wslFeatureInstalled` stays false and the reason
  goes to the log; in a nested window core ends the chain with remote-ssh's message.
- **A lost connection (Q3, AC-22, 7.E2), `reading-2348-nested-reconnect`:** core's own "cannot reconnect" surface with no
  S053 toast (option (b)), since a reconnect that never settles breaks R-79.
- **Commands in an SSH window** act on the outer host's WSL (BR-3). "Add a Distro" types its line into a terminal of the
  window, which opens on the window's remote, so the line runs on the outer host; the card verifies the placement.
- **Texts and phases:** STR:S031 "Installing server in {0}" is the install stage with `{0}` the distro; STR:S013 shows on
  the local route only; STR:S029 and STR:S012 never. `docker-desktop` and `docker-desktop-data` are hidden. The clause
  `(wslFeatureInstalled || wslFeatureInstalled)` is quoted verbatim.
- **AC-25 (Open Recent from a local window):** if remote-ssh's nested resolve shows its own progress where the reference
  showed none, that is remote-ssh's surface, and the row records it.
- **Hosts:** the rows need a Windows SSH host with WSL: `windows-2025` serves SSH to itself with an admin key login
  (brief-remote-wsl §5.2), so they are `acceptance-win`; AC-4 runs on the Linux SSH container (`acceptance-linux`). A
  non-admin login is unmeasured, so a row that needs one is `host:`.

## 4. The cut

| Card | Scope | Test kinds |
|---|---|---|
| tgt-1 | lib-authority's recent-list port | unit |
| tgt-2 | F-6503 (§1) | unit, manifest, acceptance-win |
| tgt-3 | lib-authority's `ConnectInput.execServer` | unit |
| tgt-4 | D9a, D9b, the nested keys, the server over the exec server (§3) | unit, acceptance-win |
| tgt-5 | F-6701's rows: clauses, commands over SSH, the end states (§3) | manifest, acceptance-linux, acceptance-win |
| later | F-6501 and F-6502 (§2), once reviewed | |
