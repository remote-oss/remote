# Task card connect-21: the connect commands and Kill Local Connection Server, registered (F-2301, F-2302, F-2303, F-2102)

Issue: #529. Why: a live VSCodium run (the user, 2026-10-13 00:34Z) showed `command 'opensshremotes.openEmptyWindow'
not found`. The manifest declares the commands (card remote-ssh-01), and the pure parts of the flows are built: card
remote-ssh-02's `picker-model.ts`, `typed-input.ts` and `window-target.ts`; lib-ssh's `listHosts`; lib-authority's
opener; lib-ssh's `killConnection`. But no card registered the handlers. The brief named them
(`brief-remote-ssh-connect.md`, connect-03's `ssh.connect-flows`), and the card was never written: the lead
engineer's gap. Slice 1 needs "Connect to Host..." (#40: "Run **Connect to Host...**") and Kill Local Connection
Server (F-2102). The two other `openEmptyWindow` commands are slice 3's (F-2302, F-2303), but they share the same flow,
and the remote indicator already offers `openEmptyWindowInCurrentWindow`, so they're registered here too.
Builder: hestia or iris (hermes assigns). Size: M.

Not in this card (slice 3, #42; carded with it): `addNewSshHost` (F-2204), `cleanRemoteServer` and
`cleanCurrentRemoteServer` (F-2411), `cleanDevBox` (F-2412), `clearAllSessionHints`.

## 1. The commands

| Command | Feature | What it does |
|---|---|---|
| `opensshremotes.openEmptyWindow` | F-2301 | the host picker, then the picked host in a **new** window |
| `opensshremotes.openEmptyWindowInCurrentWindow` | F-2302 | the same picker, then the host in the **current** window |
| `opensshremotes.openEmptyWindowOnCurrentHost` | F-2303 | no picker: the active host (`activeHostTarget`) in a new window, when `isActiveHostAvailable` |
| `opensshremotes.cleanLocalServer` | F-2102 | the host picker, then the picked host's local connection server ended |

Each is registered in `register-connect.ts`, behind the stand-down gate, as `openWebUI` and `showDetails` are. Each
handler is a pure function over ports in a new `src/connect/connect-commands.ts`, so the rows need no editor. The
editor adapters live with the existing ones (`surfaces/editor-adapters.ts`).

## 2. The picker flow (F-2301 5.0; F-2302 the same)

1. `argumentChoice(argument)`: a `{host}` argument skips the picker.
2. Otherwise a quick pick, re-built on every change of the typed value: `pickerModel(listHosts(<remote.SSH.configFile>,
   <client locations>, <the node reader>), typedText)`. The rows and the placeholder are the model's string ids,
   resolved through the string table. The quick pick stays open when focus moves (`ignoreFocusOut: true`), as F-2301
   §3.1 says; check the spec's 5.0 for anything this card leaves out, and follow the spec.
3. A listing that is a parse error opens **no picker** (F-2301 7.E7, F-2201 AC-19 and AC-32). The handler throws an
   `Error` whose message is the parser's `<file>: <reason>`, so core shows its "Command '<title>' resulted in an
   error" dialog, one of the two forms the spec allows (hestia on #529).
4. `outcomeOfPick(item)`:
   - `{connect: target}` opens `ssh-remote+<encodeAuthority(target)>` with lib-authority's `openRemote`, an empty
     window (no folder), in the window `windowTargetOf(source)` gives;
   - `{handOver: 'configure'}` runs `opensshremotes.openConfigFile`;
   - `{handOver: 'addHost'}` runs `opensshremotes.addNewSshHost`. Until slice 3 registers it, that shows the editor's
     own "command not found": record it in the PR, don't hide the row.
5. Escape closes the pick and does nothing else.

## 3. Kill Local Connection Server (F-2102 §6.4)

The same picker (F-2102 6.4 step 2 names it). Then `killConnection` (lib-ssh `connection-server/client.ts`) for the
picked host string, with the window's helper client, and the notice F-2102 gives for a server that ended or wasn't
running. In terminal mode (`useLocalServer` off) the command isn't in the palette (manifest), and a call by keybinding
shows nothing and changes nothing (F-2102 AC-21). Follow F-2102's 6.4 and ACs; ask on #142 for anything they leave
open.

## 4. Rows

Unit rows (`test/unit/connect-commands.test.ts`), one assertion each, named by the AC or BR they prove:
- **The picker flow:** rows over a recording opener, a scripted pick and a memory reader:
  - picked host → `openRemote` with the encoded authority, new window;
  - the current-window command → current window;
  - `{host}` argument → no pick;
  - typed `user@host` → its target;
  - the configure row → `openConfigFile`;
  - parse error → the handler throws `<file>: <reason>` and no pick opens;
  - Escape → nothing.
- **The active-host command:** available → the active host in a new window; unavailable → nothing.
- **Kill:** the picked host's `killConnection`; its notices; terminal mode → nothing.

Acceptance rows, in the VSCodium run (`suite-remote`):
- `F-2301 AC-1: Connect to Host... is a registered command`: `vscode.commands.getCommands(true)` holds all four ids;
- `F-2301: the command with a {host} argument opens without a picker`: run
  `opensshremotes.openEmptyWindowInCurrentWindow` with `{host: 'harness'}` from the local window. This needs tooling-20's
  agent to observe the window; if #492 isn't merged, list the row as open in the PR.

## 5. Gates and review

The repository's gates, with the changed files at 100/100/100. PR title `remote-ssh: the connect commands and Kill
Local Connection Server, registered (card connect-21)`. athena (design), themis or triton.
