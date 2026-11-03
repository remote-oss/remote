# Remote - SSH

Work on any machine you can reach over SSH as if the code were on your own disk.

This extension is under development; its features arrive in coming releases.

## Session hints

Every resolve keeps a record of what it knew and what went wrong, for troubleshooting. The records live in the extension's
global state, under the sub-key `remote.ssh.hints` of its state entry (`remote-oss.remote-ssh`). Nothing in them leaves
the machine, and the clear command, "Remote-SSH: Clear previous session metadata (used for enhanced error reporting)",
removes them all. This section is the documented accessor: a test reads the store through this key and these field names.

The value under the key is `{"records": [...]}`, the two newest records, oldest first. A record has:

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

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Features | none yet (the connect flow arrives in a later release) |
| Components | the shared connection helper and the askpass program, two programs of their own in `src/programs/` that run outside the editor and ship as `dist/connection-helper.js` and `dist/askpass.js` |
| Allowed imports | `lib-helper` and `lib-ssh` in `src/programs/`; `lib-authority`, `lib-helper`, `lib-host`, `lib-log`, `lib-product`, `lib-server` and `lib-ssh` in `src/pipeline/`; the entry point imports nothing; no program imports `vscode`; `lib-authority`, `lib-companion`, `lib-log` and `lib-ssh` in `src/companion/`; `lib-companion` in `src/extension.ts` |
| Coverage exclusions | `src/extension.ts`: it loads the editor, which exists only in the extension host. `src/programs/connection-helper.ts` and `src/programs/askpass.ts`: each runs as a program of its own over real sockets, files and processes, which the acceptance run covers |
