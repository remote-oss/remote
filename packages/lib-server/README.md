# lib-server

Installs and starts the editor's server on a host through a host channel: the probe, the download and
unpack, the start with the right options, and the cleanup, all driven by one flat policy record per
extension. A package never branches on which extension calls it; the record says where the archive
comes from, how it is checked, what may be added at start, and what is kept afterwards. Prefetches a
server for the next product update where the extension opts in.

The archive reaches the host through a download on the host, a download on the client, or both in the order the
plan gives. The client side is two ports the extension wires: the editor's proxy-aware download, and removal of the
temporary file. The library makes no request of its own and reads no proxy setting.

On the CLI path, one connection token serves every connect to a host: the first CLI start makes
`<CLI data folder>/connection-token` (mode 600) and every start reads it, because the server the CLI starts keeps the
token it was first given. Deleting that file while the server runs makes the next connect's token one the server
refuses, until that server ends and the next connect starts one with the new token.

Kill and uninstall stop the user's server processes, those of a direct install under `bin/` and those of the CLI path
under `cli/servers/`, and never the CLI's own processes (`command-shell`, its supervisor), which run the CLI file. Kill
removes `bin/` and keeps `cli/servers/`, `cli/connection-token` (and the CLI's own `cli/agent-host-token`), the data folder's other contents, the extensions and
the logs; uninstall removes the whole data folder. A deleted `cli/connection-token` is recovered by kill: it ends the
server that holds the old token, and the next connect makes a fresh token and a fresh server.

It is bundled into the extensions that install a server and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-server` (`src/index.ts`) |
| Allowed imports | `lib-host`, `lib-product`, `lib-log` |
| Coverage exclusions | `src/policy/record.ts` and `src/transfer/ports.ts`: types only, no executable code |
| Notes | `CONTAINERS_POLICY`'s `verification` and `cleanup` are provisional until the containers design settles them |
