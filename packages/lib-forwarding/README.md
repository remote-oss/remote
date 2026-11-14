# lib-forwarding

The port search for the local tunnel ports: the range parsed from the setting, and the first port a probe finds
free. It is bundled into the extensions that use it and never published on its own.

## Contract

- `parseRange(value)` reads the preferred local port range from the setting value; a value that is not a string,
  not `A-B`, out of bounds, reversed or empty is ignored with a reason, never an error.
- `findFreePort(prober, range, options?)` probes until a port refuses a connection: the range's ports in order, or
  up to ten random candidates in the ephemeral range when there is no range. An open or failing probe continues; a
  time budget (default 3 s, default clock Date.now, checked before each probe) ends the search with `noFreePort`.
- `openRelayTunnel(request)` opens the window's tunnel through the shared connection: it listens on the window's port
  on 127.0.0.1, dials the server's port on the host's IPv4 loopback for each connection and passes the bytes both
  ways. It is open once a probe through the dialer has worked, and `tunnelNotReady` at the bound, even if the dialer
  never answers. The bytes a client sends before the host side opens are held, up to `limits.heldBytesMaximum`; a
  chunk that would take the held total past it closes the client, and the host side is closed without sending
  anything when its dial completes. `openForwardedTunnel(request)` waits the same way for a port that a second
  `ssh -N -L` session owns,
  and ends that session when it is not ready.
- `factoryFor(init)` gives the tunnel factory of a connection: it forwards ports through the dialer, lists them, and
  after a reconnection runs them over the new dialer on the same local ports, reporting the ones the new connection
  could not reach. Its features are private forwards without elevation.
- Probing goes through a `PortProber`; the library never binds and never dials. `FakeProber` under `src/testing/`
  answers from a port map and records the probed ports in order.

## For maintainers

|                     |                                                                         |
| ------------------- | ----------------------------------------------------------------------- |
| Maintainers         | remote-oss                                                              |
| Entry points        | `lib-forwarding` (`src/index.ts`), `lib-forwarding/testing/*` |
| Allowed imports     | `lib-helper`, `lib-log`                                                 |
| Coverage exclusions | none |
