# lib-forwarding

The port search for the local tunnel ports: the range parsed from the setting, and the first port a probe finds
free. It is bundled into the extensions that use it and never published on its own.

## Contract

- `parseRange(value)` reads the preferred local port range from the setting value; a value that is not a string,
  not `A-B`, out of bounds, reversed or empty is ignored with a reason, never an error.
- `findFreePort(prober, range, options?)` probes until a port refuses a connection: the range's ports in order, or
  up to ten random candidates in the ephemeral range when there is no range. An open or failing probe continues; a
  time budget (default 3 s, default clock Date.now, checked before each probe) ends the search with `noFreePort`.
- Probing goes through a `PortProber`; the library never binds and never dials. `FakeProber` under `src/testing/`
  answers from a port map and records the probed ports in order.

## For maintainers

|                     |                                                                         |
| ------------------- | ----------------------------------------------------------------------- |
| Maintainers         | remote-oss                                                              |
| Entry points        | `lib-forwarding` (`src/index.ts`), `lib-forwarding/testing/fake-prober` |
| Allowed imports     | `lib-log`                                                               |
| Coverage exclusions | none                                                                    |
