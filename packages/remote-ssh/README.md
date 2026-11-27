# Remote - SSH

Work on any machine you can reach over SSH as if the code were on your own disk.

## Installing

- From Open VSX, by the extension's id, `remote-oss.remote-ssh`.
- In an editor whose gallery is not Open VSX, from a VSIX file on
  [this repository's releases page](https://github.com/remote-oss/remote/releases). The two
  companions, `remote-oss.remote-ssh-edit` and `remote-oss.remote-explorer`, are installed the
  same way, from their VSIX files on the same page. The editor installs the companions together
  with the extension only from Open VSX.

## Updates

In an editor whose gallery is not Open VSX, a VSIX install gets no automatic updates and no
pre-release channel. A newer version is installed by hand, the same way as the first one.

## Uninstalling and disabling

Uninstalling the extension uninstalls both companions; disabling it disables both.

## One at a time

Only one extension for the `ssh-remote` authority may be enabled at a time. If another one is
enabled, it must be disabled.

## The proposed API

The extension needs the editor's proposed APIs enabled for it. Add the extension's id to
`enable-proposed-api` in the editor's `argv.json`, then restart the editor:

```json
{
  "enable-proposed-api": [
    "remote-oss.remote-ssh"
  ]
}
```

## Session hints

Every resolve keeps a record of what it knew and what went wrong, for troubleshooting. The records live in files of the
extension's global storage folder, `connection-hints` (under the profile's `User/globalStorage/remote-oss.remote-ssh`),
one file `<session>.json` for each window, which the window writes whole under a temporary name and renames over the old
file, so that no window's write drops another's. Nothing in them leaves the machine, and the clear command,
"Remote-SSH: Clear previous session metadata (used for enhanced error reporting)", removes them all. This section is the
documented accessor: a test reads the records through these files and these field names.

A file holds `{"events": [...]}`; an event has a `time` (milliseconds since the epoch) and a `kind`:

- `record`, with a `record` that is the whole record of one resolve as it was when the event was written;
- `clear`, with `clearedAt`, the ISO 8601 time of the clear.

The records are read from the files of every window (a file named `<session>.json`, or `<session>.claim-<id>` while
another window folds it into its own; a name ending in `.tmp-<id>` is a write not yet renamed and is not read), as
follows. The newest event of each record, told by its `started`, decides: a record that a window writes again with more
hints replaces its earlier state, and of two events of one time the one of the greater session name decides (a window's session is its file's name before `.json`, or before `.claim-` for a claim). The newest
`clearedAt` hides every record that started before it, whichever window wrote it and whenever. The two newest
of the records that are left, by `started`, are the records of the store, oldest first. A window keeps in its file only its
two newest records and its newest clear. The value an earlier version kept in the extension's global state under
`remote.ssh.hints` is read by the extension as the oldest layer and is never written; a test needs only the files.

A record has:

| Field | Meaning |
|---|---|
| `started` | The ISO 8601 time the resolve started. |
| `hints` | The ordered list of hints: the environment hints first, then the error hints and the log hint in the order they were recorded (an error recognised after the resolve step ended follows the log hint). |

A hint has a `kind`, and its other fields depend on it:

| `kind` | Fields |
|---|---|
| `environment` | `message`; `details`, the setting's description, for the settings that have one. There are 25: one for each of the 22 settings below, in this order, then `VS Code version: <version>`, `Remote-SSH version: remote-ssh@<version>` and `<platform> <architecture>`. |
| `error` | `status`, the code name of the error; `statusNumber`, its number in the table below (absent in a record written before the table); `message`; `details`, or `mitigations` and `resources` (lists of texts, in table order). |
| `log` | `text`, the lines the extension's log gained during that resolve, from the line where the record began to the end of the resolve step. |

The 22 settings, as `Extension setting '<name>' is set to value '<value>'` (a string as it is, anything else as JSON text,
nothing as `undefined`), are, without the `remote.SSH.` prefix: `useLocalServer`, `useExecServer`, `bindHost`, `path`,
`configFile`, `useFlock`, `lockfilesInTmp`, `localServerDownload`, `remoteServerListenOnSocket`, `defaultExtensions`,
`defaultExtensionsIfInstalledLocally`, `loglevel`, `enableDynamicForwarding`, `enableRemoteCommand`,
`serverPickPortsFromRange`, `serverInstallPath`, `permitPtyAllocation`, `preferredLocalPortRange`,
`useCurlAndWgetConfigurationFiles`, `experimental.enhancedSessionLogs`, `httpProxy` and `httpsProxy`. The extension reads
each by exactly that name, so `defaultExtensionsIfInstalledLocally` and `loglevel`, which it does not declare, show
their value only when the user wrote exactly that key. Those two have no details.

The status numbers only grow: a new status takes the next unused number, and no number is changed or used twice.

| `status` | `statusNumber` |
|---|---|
| `PermissionDenied` | 1 |
| `InvalidHostName` | 2 |
| `OfflineError` | 3 |
| `MitmPortForwardingDisabled` | 4 |
| `AllowTcpForwardingDisabled` | 5 |
| `SendDisconnectBrokenPipe` | 6 |
| `ServerDownloadFailed` | 7 |
| `NoDownloaderAvailable` | 8 |
| `InvalidProxyUrl` | 9 |

## Folder history

Remote Explorer lists, under each host, the folders and workspaces the user opened on it, most recent first. The history lives in
files of the extension's global storage folder (`remote-oss.remote-ssh`), in the folder `folder-history`. Nothing in
it leaves the machine, and "Remove from Recent List" on a row records a `removed` event. This section is the
documented accessor: a test reads the files through this layout and these field names.

Each window writes its own file, `<session>.json`, where `<session>` is a random UUID the window picks when it starts, so
no window's write can drop another's. A window writes its file whole, under a temporary name that it renames over the
file. The folder is created with mode 0700 and each file with mode 0600.

A file holds `{"events": [...]}`, one event for each change to an entry, and an event has:

| Field | Meaning |
|---|---|
| `host` | The key of the host the entry belongs to. |
| `entry` | The entry as the endpoint returns it: `{"path": ..., "kind": ...}`, where `kind` is `folder` or `workspace`. |
| `kind` | `opened` when the entry was opened, `removed` when it was removed from the list. |
| `time` | When the change happened, in milliseconds since the epoch. |

A window holds one event for each entry, the newest it knows. To read the history, take every window's file and, for each
host and path, the newest event over all of them: it decides, and an entry whose newest event is `removed` is not listed.
Two events at the same time are decided by the later session, comparing the session names as text. The entries of a host
are listed by time, the most recent first, and the later session first at the same time. The hosts are ordered as the earlier
version's value ordered them, then, for the others, the host whose oldest entry is oldest first.

Two kinds of name in the folder are not a window's file:

| Name | Meaning |
|---|---|
| `<session>.claim-<hex>` | A file of a window that has not changed for a day, renamed by another window while it folds the file's events into its own. It is read as the file of `<session>` until the folding window has written its own file and deleted it. |
| `<session>.json.tmp-<hex>` | A write that is not yet renamed into place. It is never read, and the next window to write removes it once it is a day old. |

A file that has not changed for a day is folded this way by the next window that writes, so the files of windows that ended
do not pile up. An earlier version kept the whole history in one value of the extension's global state, under
`folder.history.v1`. That value is read as the oldest layer, every entry at time 0 in its order, and is never written.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | the connect flow: connecting the current window, a new window or an empty window to a host, the login terminal, and port forwarding |
| Components | the shared connection helper and the askpass program, two programs of their own in `src/programs/` that run outside the editor and ship as `dist/connection-helper.js` and `dist/askpass.js` |
| Allowed imports | `lib-helper` and `lib-ssh` in `src/programs/`; `lib-authority`, `lib-helper`, `lib-host`, `lib-log`, `lib-product`, `lib-server` and `lib-ssh` in `src/pipeline/`; the entry point imports nothing; no program imports `vscode`; `lib-authority`, `lib-companion`, `lib-log` and `lib-ssh` in `src/companion/`; `lib-companion` in `src/extension.ts` |
| Coverage exclusions | `src/extension.ts`: it loads the editor, which exists only in the extension host. `src/programs/connection-helper.ts` and `src/programs/askpass.ts`: each runs as a program of its own over real sockets, files and processes, which the acceptance run covers. `src/pipeline/steps.ts`: types only, no executable code |
