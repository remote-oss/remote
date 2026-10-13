# Companion interface 1.0

The calls between Remote Explorer (`remote-oss.remote-explorer`) and the family extension that serves it,
`remote-oss.remote-ssh`. The text comes from remote-oss/remote-explorer#14 (F-5902 §5), the interface's single text,
and this file is its one copy in this repository. Within version 1, fields are only added, never renamed or retyped.

## The envelope

Every argument and every result is a plain-data object (strings, numbers, booleans, arrays and plain objects) with the
field `interfaceVersion`: an object `{major, minor}` of two non-negative integers. This document is version
`{major: 1, minor: 0}`.

- A receiver ignores fields it doesn't know, and treats a missing optional field as absent.
- A payload is foreign when it isn't a plain object, has no `interfaceVersion`, has one that isn't two non-negative
  integers, lacks a required field, or has a field of the wrong type.
- A payload whose `major` isn't 1 has an unknown major version. Any `minor` is accepted.
- A path is the string the companion records, never an object.
- A query's argument is the envelope alone, `{interfaceVersion}`.

## The calls

| Id | Served by | Called by, and when | Kind | Argument | Result |
|---|---|---|---|---|---|
| `remote-internal.getActiveSshRemote` | remote-ssh | remote-explorer, as the first call of every build of the view | query | envelope | ActiveRemote |
| `remote-internal.getConfiguredHostnames` | remote-ssh | remote-explorer, on every build of the "SSH" group and on every change signal | query | envelope | Hostnames |
| `remote-internal.getSshFoldersHistory` | remote-ssh | remote-explorer, on every build of the folder rows | query | envelope | FoldersHistory |
| `remote-internal.deleteSshFolderFromHistory` | remote-ssh | remote-explorer, on "Remove from Recent List" | change | DeleteRequest | DeleteResult |
| `remote-internal.openRemoteSshTarget` | remote-ssh | remote-explorer, on the connect actions | change | OpenRequest | envelope |
| `remote-internal.setActiveFolders` | remote-explorer | remote-ssh, as "When the active folders are pushed" says | push | ActiveFoldersPush | none |
| `remote-internal.sshHostsChanged` | remote-explorer | remote-ssh, as "The change signal" says | push | envelope | none |

No id is in `contributes.commands` or in any menu. The extension that serves an id declares an `onCommand:` activation
event for it.

## The payloads

### ActiveRemote

| Field | Type | Required | Meaning |
|---|---|---|---|
| `connected` | boolean | yes | whether the window is an SSH window whose connection has succeeded |
| `hostKey` | string | when `connected` is true | the host part of the window's authority as written: the alias for a window opened from a configured host, the encoded form for a typed `user@host` |

"None" is `{connected: false}`: in a local, container, tunnel or virtual window, and in an SSH window whose connection
hasn't succeeded. The companion answers it at once outside SSH windows, with no connection attempt and no UI. A
receiver ignores a `hostKey` sent with `connected: false`.

### Hostnames

| Field | Type | Required | Meaning |
|---|---|---|---|
| `hostnames` | array of strings | yes | the SSH host aliases from the effective SSH configuration, in the companion's order, without HostName, User or Port |

### FoldersHistory

| Field | Type | Required | Meaning |
|---|---|---|---|
| `hosts` | array of HostHistory | yes | one entry per host key |

A HostHistory is `{hostKey, entries}`: the host key as in ActiveRemote, and its entries, most recent first, repeats
kept. An entry is `{path, kind}`, with `kind` `"folder"` or `"workspace"`. Only paths whose connection succeeded are
recorded. The companion always sends this order; the view sorts by `remote-explorer.foldersSortOrder`.

### DeleteRequest and DeleteResult

The request is `{hostKey, path}`, both strings and both required. The companion removes every copy of `path` under
`hostKey`, and none under any other key. The result is `{changed}`, a boolean: whether the history changed.

### OpenRequest

| Field | Type | Required | Meaning |
|---|---|---|---|
| `hostKey` | string | yes | the host key exactly as written, case kept |
| `path` | string | no | one path to open |
| `kind` | `"folder"` or `"workspace"` | no | the kind of `path` |
| `window` | `"current"` or `"new"` | yes | the window to open in |

The view sends `kind` exactly when it sends `path`: `"workspace"` for a path ending in the lower-case
`.code-workspace`, `"folder"` for any other path. The companion opens a `"workspace"` as a workspace and a `"folder"`
as a folder, as told, never by its own test of the path. A request with a `path` and no `kind` is malformed: the
companion opens nothing and rejects the call, shows nothing and writes nothing. A `kind` without a `path` is ignored,
and the host opens with no folder. The result is the envelope, sent once the companion has started the open.

### ActiveFoldersPush

| Field | Type | Required | Meaning |
|---|---|---|---|
| `outcome` | `"connected"`, `"failed"` or `"none"` | yes | the outcome of the window's first resolve attempt in this extension-host session; `"none"` in a local window |
| `hostKey` | string | no | the window's host key; absent in a local window |
| `folders` | array of strings | no | the window's workspace folder paths |

The push only wakes Remote Explorer. Remote Explorer uses nothing of its contents and stores nothing from it.

## Rules for every call

- The caller gives each call 10 seconds, measured by itself from the moment it makes the call. A call that hasn't
  answered by then has failed. No call is left pending.
- A failed call isn't retried. The next Refresh or window start makes one new attempt of each call of a build, and the
  next change signal one new attempt of the host-list call.
- A receiver never rejects a foreign argument or one with an unknown major version, and never acts on one: it writes
  nothing, shows nothing and opens no window. A query returns its empty result (`{connected: false}`,
  `{hostnames: []}` or `{hosts: []}`, each with the envelope), and a change or push returns nothing.
- A caller that gets a foreign result, or one with an unknown major version, treats the companion as unavailable,
  silently.
- Remote Explorer shows nothing and writes nothing for a version mismatch; it has no log channel. remote-ssh writes one
  line in its own log channel the first time in an extension-host session that it receives or gets back a payload with
  an unknown major version, naming the id, the received major version and its own. There's no notification.
- A pushing caller swallows every rejection, with no notification, output or status change.
- Nothing in a payload goes online, and no payload carries telemetry.

## The order of a build's calls

Each full build of the view (first show, window start, Refresh) makes `remote-internal.getActiveSshRemote` its first
call. It doesn't wait for that answer: `remote-internal.getConfiguredHostnames` and
`remote-internal.getSshFoldersHistory` follow at once, and the three run in parallel. The view renders the build when
every call has answered or failed. The "connected" marker comes from `remote-internal.getActiveSshRemote` alone, never
from a push. A change signal starts a partial build that makes only the `remote-internal.getConfiguredHostnames` call.

When a call fails, Remote Explorer writes no setting and shows no notification:

- `remote-internal.getActiveSshRemote`: no row is marked "connected";
- `remote-internal.getConfiguredHostnames`: the "SSH" group is shown, expanded, with no host rows;
- `remote-internal.getSshFoldersHistory`: the host rows are shown as leaves;
- `remote-internal.deleteSshFolderFromHistory`: the row stays where it was;
- `remote-internal.openRemoteSshTarget`: nothing opens, and the view is unchanged.

## When the active folders are pushed

remote-ssh pushes `remote-internal.setActiveFolders` once per extension-host session:

- in an SSH window with a folder or workspace open, after its first resolve attempt ends, whether it succeeded or
  failed;
- in a local window with a folder or workspace open, right after it activates, with outcome `"none"` and no host key.

It never pushes in an empty window, and never on a folder change within the session.

## The change signal

remote-ssh calls `remote-internal.sshHostsChanged` in exactly two cases, each within 1 second:

- the user saves an editor that remote-ssh's own "Open SSH Config File" flow opened, measured from the save completing;
- remote-ssh's "New Remote" flow has written a host entry, measured from the write.

It sends nothing for a save from an editor its flow didn't open, a save of an included file, a change made by another
program, or a save of an unrelated file. Neither side watches files. On the signal, Remote Explorer rebuilds the "SSH"
group's host rows only, not the folder rows. A change of `remote.SSH.configFile` needs no signal: Remote Explorer
reacts to that setting itself. History changes are never signalled.

## Detection

Remote Explorer decides that the "SSH" group exists from `remote-oss.remote-ssh` being installed and enabled, never by
calling a command. It looks across extension hosts with the `extensionsAny` proposal. Without the grant, it looks in its
own extension host only, and a companion in another host counts as absent, silently. Microsoft's ids and community
forks never count. When the companion is absent, Remote Explorer calls none of its ids, internal or public. A companion
that arrives while the window runs is seen within 10 seconds. One that is disabled or uninstalled while the window runs
keeps its group until the extension host restarts. Every call goes through `commands.executeCommand`, and exports are
never used.

## Hand-over commands

Remote Explorer also calls two public commands of remote-ssh, with no argument and no envelope:
`opensshremotes.openConfigFile` ("Open SSH Config File") and `opensshremotes.addNewSshHost` ("New Remote"). It calls
them only when remote-ssh is present. When one fails, remote-ssh's own error is what the user sees, and Remote
Explorer adds nothing and doesn't hand the rejection on to the editor.

## Not in this release

The tunnels part of F-5902 §5 (the family's tunnels companion, `remote-oss.remote-server`, and its `remote-tunnels.*`
ids) isn't built in this release, by decision D-55. It joins this document as an added section, under a new minor
version, when it is built.
