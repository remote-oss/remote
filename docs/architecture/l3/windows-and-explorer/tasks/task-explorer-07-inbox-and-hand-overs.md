# Task card explorer-07: the explorer's inbox, and the SSH group's two hand-overs (F-5102, F-5902)

Issue: #1097. Release 0.3, Remote Explorer increment 2 (#745). Size: M. Builder: `task:claude`. **Build after**
explorer-06 (#1096), which is built after the slice-1 gate rows (#645). It can run in parallel with ssh-provider-03
(#1093), because it's built against lib-companion's recording fake, which already records the push's `outcome`.
Design: `docs/architecture/l3/windows-and-explorer/brief-explorer-increment-2.md` §4.2, §4.3, §4.4 and §5 (the
failed "New Remote", ruled (a)).

Sources: F-5102 (`remote-oss/remote-explorer#9`) §3.1, BR-12, 7.E5, 7.E7, AC-1, AC-2, AC-13, AC-15, AC-22, AC-30,
AC-36, AC-44; F-5902 (`#14`) §5, AC-9, AC-22, AC-29, AC-30, AC-31; F-5001 AC-11, AC-15; card explorer-03b (the
activation and command registration), explorer-06.

## 1. The inbox (brief §4.2)

`packages/remote-explorer/src/companion/inbox.ts` (new): `serveInbox(protocol, targets)` registers both through
lib-companion's `serve`.
- **`remote-internal.setActiveFolders`:** a push that does nothing. Its `onCommand:` activation event is what wakes
  the explorer. Nothing in the payload is used or stored, and it isn't checked against workspace trust (F-5902 §5,
  F-5101). A call with no argument or a foreign one is silent (F-5001 AC-11, through `serve`).
- **`remote-internal.sshHostsChanged`:** a push that starts `targets.rebuildHosts()`, so the folder rows keep the
  last history read (explorer-06). It doesn't activate the explorer (`activates: false`, #638). When the explorer
  isn't active, the call fails, and remote-ssh's `fireAndForget` swallows that.
- **Both entries register the inbox** (`extension.ts` and `web-extension.ts`). In the web entry nothing calls it.

## 2. The hand-overs (brief §4.3)

`packages/remote-explorer/src/view/hand-overs.ts` (new): the handlers of `remote-explorer.configureSsh` ("Open SSH
Config File", `$(gear)`) and `remote-explorer.add` ("New Remote", `$(plus)`).
- **Placement:** inline and in the context menu of the "SSH" group row only (`viewItem == remote-explorer.sshGroup`,
  AC-1, AC-2, AC-15, AC-30). No view-title action and no welcome content. Every entry has `&&
  !remote-explorer.standingDown`. Both are hidden from the palette.
- **What each runs:** its remote-ssh command, with no argument and no envelope: `opensshremotes.openConfigFile` and
  `opensshremotes.addNewSshHost` (§16; F-5902 §5).
- **No error shows:** it awaits the command and swallows a rejection. There's no notification, no dialog, and none
  of core's "Error running command" (F-5902 AC-22, F-5102 BR-12, brief §5 ruling (a), AC-36).
- **Without the companion,** neither runs (7.E7).
- **A host the companion adds** appears through `sshHostsChanged`, with no Refresh (AC-13, AC-22).
- **`remote-explorer.add` on the tunnels group** is out with D-55. The handler tells the groups apart by the row
  argument, and does nothing for any argument that isn't the SSH group node.

## 3. Manifest, identifiers and the allowlist (brief §4.4)

- The explorer's `identifiers.json` gains the two hand-over commands. `setActiveFolders` and `sshHostsChanged` are
  already there as served pushes (`sshHostsChanged` with `activates: false`).
- `package.json`: the two commands with their icons and titles, the two menu entries per place above, and the
  palette hiding. The string tables gain the titles in every locale.
- `tools/unconsumed-allowlist.json`: remove the explorer's `setActiveFolders` and `sshHostsChanged` entries (#745),
  which this card consumes.
- **Activation events stay as they are** (F-5001 AC-15).

## 4. Rows

Unit rows over lib-companion's recording fake and a fake command host. Each name starts with its cite. A label in
parentheses must be `[a-z0-9-]`.
- **The inbox:**
  - `setActiveFolders` with each `outcome`, and with no argument or a foreign one: no rebuild, no state, no throw;
  - `sshHostsChanged`: one `rebuildHosts` per call, so two calls give two (F-5902 AC-9, AC-29); folder rows kept;
  - both served from both entries.
- **The hand-overs:**
  - each runs its command with no argument;
  - a rejected command shows nothing and doesn't reject;
  - without the companion, nothing runs;
  - an argument that isn't the SSH group node does nothing.
- **Manifest rows:** the two commands, their icons and titles, their menu `when` clauses, and their palette hiding.
- `check-consumed` passes with the two allowlist entries removed.

The acceptance rows are the gate card's (brief §7 rows 5, 6 and 8), with ssh-provider-03 on main.

## 5. Gates and review

All gates, the changed files at 100 %, `check-identifiers`, `check-consumed` and `check-string-tables` clean. PR
title: `remote-explorer: the inbox and the SSH group's hand-overs (card explorer-07, #1097)`. Request athena only;
hermes assigns the peer.

## 6. Open rows (stop and report on the issue)

1. An inline action on the "SSH" group row needs a `view/item/context` group the slice-1 row doesn't have.
2. A swallowed rejection still makes core show "Error running command".
