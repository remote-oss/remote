# lib-server

Installs and starts the editor's server on a host through a host channel: the probe, the download and
unpack, the start with the right options, and the cleanup, all driven by one flat policy record per
extension. A package never branches on which extension calls it; the record says where the archive
comes from, how it is checked, what may be added at start, and what is kept afterwards. Prefetches a
server for the next product update where the extension opts in.

The archive reaches the host through a download on the host, a download on the client, or both in the order the
plan gives. The client side is two ports the extension wires: the editor's proxy-aware download, and removal of the
temporary file. The library makes no request of its own and reads no proxy setting.

It is bundled into the extensions that install a server and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-server` (`src/index.ts`) |
| Allowed imports | `lib-host`, `lib-product`, `lib-log` |
| Coverage exclusions | `src/policy/record.ts` and `src/transfer/ports.ts`: types only, no executable code |
| Notes | `CONTAINERS_POLICY`'s `verification` and `cleanup` are provisional (F-1402 Q4, area C) |
