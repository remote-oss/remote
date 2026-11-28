# tunnel-proxy

The Remote - Tunnels local proxy: the program that holds a profile's tunnel connections, so that every window of the
profile shares one (`brief-client.md` §5.1, F-8103 BR-6). The `remote-server` extension starts it, through lib-helper,
on the editor's own runtime, and the build copies its bundle into the extension as `dist/proxy.js`. It's a service
(layout rule 5): it runs outside the editor, and nothing imports it.

It holds the dev tunnels SDK's client leg and management client (brief §2, §5.3; `ruling-3340-proxy-package`). The
extension's manifest names none of the SDK's packages. A window reaches a tunnel's port through the proxy's
owner-only data socket, with a one-time ticket per stream.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `src/main.ts`, bundled into `remote-server`'s `dist/proxy.js` |
| Allowed imports | `lib-helper`, `lib-tunnels`, the dev tunnels SDK at the agent's pin (ADR-0016) |
| Coverage exclusions | none |
