# Task card ssh-provider-03: remote-ssh's `setActiveFolders` push and `sshHostsChanged` signal

Issue: #1093. Release 0.3, Remote Explorer increment 2 (#745). Size: M. Builder: `task:claude`. **Build after**
ssh-provider-02 (#1088): it adds `ConnectRegistration.onFirstResolveSettled`, which this card uses too. Like
ssh-provider-02, it touches only remote-ssh and can be built before the slice-1 gate. Until explorer-07 serves the
inbox, both calls fail, and `fireAndForget` swallows that (brief §6, as amended by #1086).
Design: `docs/architecture/l3/windows-and-explorer/brief-explorer-increment-2.md` §2 rulings 3 to 7, §3.3, §3.4 and
§4.4's last item.

Sources: F-3906 (`remote-oss/remote-ssh#83`) rule 7 and C-10; F-2503 BR-14; F-2203 BR-9; F-2204 §16; F-5902
(`remote-oss/remote-explorer#14`) §5, AC-9, AC-29, AC-30, AC-31; card remote-ssh-19 (the configuration file command),
connect-22 (Add New SSH Host).

## 1. The push (brief §3.3)

`packages/remote-ssh/src/companion/active-folders.ts` (new):

```ts
/** What the push reads of the window, and when. */
export interface PushPorts {
  /** Whether the window has a folder or a workspace now. */
  hasWorkspace(): boolean;
  /** The window's authority, `vscode.env.remoteAuthority`, or undefined for a local window. */
  remoteAuthority(): string | undefined;
  /** The session's first resolve (`ConnectRegistration`). */
  resolve: {onFirstResolveSettled(listener: () => void): void; lastResolve(): LastResolve};
  /** Sends one push and forgets it (lib-companion's `fireAndForget`). */
  send(push: ActiveFoldersPush): void;
}

/** Pushes the window's outcome once per extension-host session, as brief §3.3 says. */
export function pushActiveFolders(ports: PushPorts): void;
```

- **No push in a window with no folder or workspace.** That's read once, at the call, and a later folder change
  in the same session doesn't push (F-5902 AC-31). A new extension host makes its own one call.
- **An `ssh-remote` window** (its authority gives a key through `hostKeyOfAuthority`) pushes when the first
  resolve settles: `{outcome: lastResolve() === 'succeeded' ? 'connected' : 'failed', hostKey}`.
- **Every other window** (local, container, WSL, tunnel; ruling 3) pushes right away: `{outcome: 'none'}`, with no
  `hostKey`.
- **No `folders` field, ever** (ruling 4). Build the payload with `writeActiveFoldersPush`.
- **Delivery:** `send` is `protocol.fireAndForget(EXPLORER_INBOX.setActiveFolders.commandId, push)`. A rejection,
  core's "not found" included, is swallowed with no UI and no log line.
- **`extension.ts`:** call `pushActiveFolders` after the companion protocol and the connect registration exist.
  remote-ssh activates lazily, so in a local folder window the push follows that activation. The explorer's
  `getActiveSshRemote` is still the first call it receives (F-5902 AC-30): the push is sent after activation, and the
  explorer's call is what activated remote-ssh.

## 2. The signal (brief §3.4)

One function sends it, `signalHostsChanged(protocol)`, as
`protocol.fireAndForget(EXPLORER_INBOX.sshHostsChanged.commandId, writeEnvelope())`. It has exactly two callers, and
each sends one signal per event, with no debounce (ruling 5):

1. **A save of a tab the configuration file command opened, while that tab stays open** (F-2203 BR-9):
   - `config/open-config-file.ts`: `ConfigFileEditor` gains
     `watchSaves(opened: OpenedEditor, onSave: () => void): void`. `openConfigFileHandler` calls it right after
     `editor.open(file)` (and after the template insert, when there is one), with `onSave` the signal. The system-wide
     file counts too.
   - The editor adapter (where `ConfigFileEditor` is made from `vscode` today) subscribes to
     `workspace.onDidSaveTextDocument` for that document's `uri`. It ends the subscription when
     `window.tabGroups.onDidChangeTabs` reports the last tab of that `uri` closed.
   - A save of the same file from a tab this command didn't open, while no such tab is open, sends nothing (brief
     §7 row 6). So does a save of an included file, a change by another program, or a save of an unrelated file.
     Nothing watches the file system.
2. **Add New SSH Host... wrote a host entry** (F-2204 §16): `config/add-host-command.ts` calls the signal right after
   `files.write(…)` succeeds, before the follow-up notice. A run that writes nothing (cancelled, a parse problem, a
   failed write) sends nothing. `AddHostPorts` gains `hostsChanged: () => void`.

No signal for a `remote.SSH.configFile` change (the explorer has its own listener, RR-3), and none for a history
change.

## 3. Identifiers (brief §4.4)

`packages/remote-ssh/identifiers.json`:
- `remote-internal.sshHostsChanged` (called) has its `kind` corrected from `change` to `push` (ruling 6);
- `remote-internal.setActiveFolders` is added as `called`, kind `push`.

Regenerate `identifiers.generated.ts` (`node tools/identifiers.ts`). The explorer's two inbox allowlist entries stay
for explorer-07, which serves them.

## 4. Rows

Unit rows over fakes: a fake resolve handle, a recording `send`, lib-companion's recording fake for the protocol,
and fakes of the editor's save and tab events.

| File | Cite | Given | Expected |
|---|---|---|---|
| `active-folders.test.ts` | F-3906 rule 7, F-2503 BR-14 | `ssh-remote+host-a`, a folder, the first resolve settles `succeeded` | one push `{outcome: 'connected', hostKey: 'host-a'}`, no `folders` |
| | rule 7 | the same, settling `failed` | `{outcome: 'failed', hostKey: 'host-a'}` |
| | ruling 3 | a local window; a `dev-container+…` window; each with a folder | one push `{outcome: 'none'}`, no `hostKey`, sent at the call |
| | F-5902 AC-31 | no folder at the call | no push, even after the resolve settles |
| | once per session | the listener fires twice | one push |
| | rejection | `send` throws | no throw out of `pushActiveFolders`, no log line |
| `open-config-file.test.ts` | F-2203 BR-9, F-5902 AC-9 | the command opens a file; two saves of that document | two signals |
| | AC-29 | the tab is closed, then a save | no signal after the close |
| | brief §7 row 6 | a save of another document | no signal |
| `add-host-command.test.ts` | F-2204 §16 | a run that writes the block | one signal, after the write |
| | F-2204 §16 | a cancelled run; a parse problem; a failed write | no signal |
| identifiers rows | ruling 6 | `identifiers.json` | `sshHostsChanged` is a called `push`, and `setActiveFolders` is a called `push` |

The acceptance rows (the explorer's host row appearing after a save or after New Remote, and the first call in a
local window) are the gate card's: brief §7 rows 5, 6 and 8, after explorer-07.

## 5. Gates and review

All gates, the changed files at 100 %, `check-identifiers` and `check-consumed` clean. PR title: `remote-ssh: the
active-folders push and the hosts-changed signal (card ssh-provider-03, #1093)`. Request athena only; hermes assigns
the peer.

## 6. Open rows (stop and report on the issue)

1. `window.tabGroups` doesn't report a closed tab of a configuration file opened as a preview editor.
2. `vscode.env.remoteAuthority` is undefined in an SSH window when remote-ssh activates.
