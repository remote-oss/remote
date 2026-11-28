# lib-tunnels

The protocol between a Remote - Tunnels window and the profile's local proxy, the helper process that holds the tunnel
connection (`brief-client.md` §5.1): the requests a window sends, the proxy's replies, and a reader for each that
refuses anything else. It is plain data only. The SDK calls are the proxy program's, in the `tunnel-proxy` service;
the window side is the `remote-server` extension's. Both import this library, and nothing in it touches a socket,
a file or the editor.

It is bundled into the extension and the proxy program, and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-tunnels` (`src/index.ts`) |
| Allowed imports | `lib-helper` (its `PlainData` type) |
| Coverage exclusions | none |
