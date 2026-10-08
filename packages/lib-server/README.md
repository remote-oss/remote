# lib-server

Installs and starts the editor's server on a host through a host channel: the probe, the download and
unpack, the start with the right options, and the cleanup, all driven by one flat policy record per
extension. A package never branches on which extension calls it; the record says where the archive
comes from, how it is checked, what may be added at start, and what is kept afterwards. Prefetches a
server for the next product update where the extension opts in.

It is bundled into the extensions that install a server and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-server` (`src/index.ts`) |
| Allowed imports | `lib-host`, `lib-product`, `lib-log` |
| Coverage exclusions | `src/policy/record.ts`: types only, no executable code |
| Notes | `CONTAINERS_POLICY`'s `verification` and `cleanup` are provisional (F-1402 Q4, area C) |
