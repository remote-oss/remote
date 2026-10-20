# Task card containers-72: declared `forwardPorts` are forwarded once the window connects (F-1101, C17)

Containers increment 2, ports. Size: L. Builder: `task:claude`. Design: athena's ports rulings on #1204 (2026-10-20):
- 1: C17 lives in remote-containers, with no new library;
- 2: one `workspace.openTunnel` per accepted entry, after the connect, over core's default tunnel, with no tunnel
  factory;
- 3: the list is the merged configuration the connect reads (the container's label);
- 6: S278;
- 7: the attributes are passed through to core.

Spec: remote-oss/remote-containers#42 (F-1101). **Depends on tooling-56 (#1228) and coverage-51 (#1229).** Attributes
are containers-73, and `appPort` is containers-74.

## 1. Where the list comes from

The connect already reads `bridge.readConfiguration(…, containerId)` after the container is ready
(`connect/connector.ts`). Its `mergedConfiguration.forwardPorts` is BR-1's build-time list: measured on CLI 0.89.0 by
tooling-56 §1, where an edited file's `[4000]` still gave `[3000]`. Keep it with the held connection. A reconnect or a
reload uses the list read then; there's no re-read of the file (AC-11, AC-30).

## 2. The decision (`src/ports/declared-forwards.ts`, new, pure)

```ts
export type ForwardTarget = {host: string; port: number};
export interface DeclaredForwards {
  /** The forwards to open, in order, one per distinct target (BR-26, BR-27). */
  forwards: ForwardTarget[];
  /** The entries and keys that start with a dash, as written without quotes, one S278 notice each (7.E6). */
  dashed: string[];
}
export function declaredForwards(forwardPorts: unknown, portsAttributes: unknown): DeclaredForwards;
```

Each `forwardPorts` entry, in order:
1. **A dash first:** a number below 0, a string starting with `-`, or a `host:port` string whose port starts with `-`
   is pushed to `dashed` as written (`-3000`, `-3000`, `myhost:-1234`) and isn't forwarded (7.E6, AC-13, AC-16).
2. **A number:** an integer from 1 to 65535 gives `{host: 'localhost', port}`.
3. **A string:** it must match `^[a-z0-9-]+:\d{1,5}$` (BR-19, 7.E5) with a port from 1 to 65535. That gives
   `{host, port}`, and `localhost:<p>` becomes `{host: 'localhost', port: p}`, so it's the same target as the number
   (BR-26). Anything else (an IP, a dot, uppercase, an underscore, a bare `"3000"`) is dropped silently (AC-26, AC-31,
   AC-32).
4. **Anything else** is dropped silently.
5. **Duplicates** (the same host and port) are kept once, at the first position (AC-37).

`portsAttributes` keys that start with `-` are pushed to `dashed` too (7.E6: a key `"-3000"`, `"-3000-4000"`).
containers-73 leaves them out of the settings it writes.

## 3. Opening the forwards (`src/ports/forwarder.ts`)

- After the resolve has handed core the connection (the window's attempt 1, and every later attempt that connects
  again: a reload reapplies, BR-16, AC-22), call `vscode.workspace.openTunnel({remoteAddress: {host, port}})` once per
  forward.
  - Use `protocol: 'https'` for ports 443 and 8443 when no `portsAttributes` entry for that port and no
    `otherPortsAttributes` sets a `protocol` (BR-11, AC-18).
  - Pass no label: core applies `portsAttributes` labels from the settings (containers-73).
  - Pass no local port: core picks the same number when it's free (BR-27).
- **When to call:** measure with the [oss] lines (`extHostTunnelService.ts`, `mainThreadTunnelService.ts`; the
  scratchpad copies are 1.139.1) when `openTunnel` from the resolving extension is first accepted. Then call it there,
  for example after the resolver's promise settles with a short retry on the "no remote" rejection. Cite the lines in
  the PR.
- `remote.autoForwardPorts: false` changes nothing here (BR-25, AC-36).
- Each rejection logs one line and is dropped. Nothing is shown.
- **S278:** one non-modal `showErrorMessage('Port number must not start with a dash: {0}')` per `dashed` value, with
  no buttons, and the connect goes on. The string goes in the containers string table as `S278`, with its bundle
  entries (`node tools/string-tables.ts remote-containers`).
- The Origin is our `displayName`, "Dev Containers" (D-41), so nothing is needed for it.

## 4. Rows

**Unit:** every branch of §2 (one row each, named after its criterion: AC-13, 16, 26, 31, 32, 37, and the `localhost`
equivalence); the 443/8443 protocol choice; the forwarder's calls and its rejection log; S278's notice text.

**Acceptance** (`tests/acceptance/containers-ports/forward-ports.test.ts`, with tooling-56's helpers), named `F-1101
AC-n (<case>)`:

| AC | Case |
|---|---|
| 1 | `forwardPorts: [3000]`: the status item's aria label is `Forwarded Ports: 3000` and its text an icon plus `1`; a row with Origin `Dev Containers`, before any listener |
| 11 | a new entry added, then a reload: not forwarded; Rebuild: forwarded |
| 13 | `[<P>, -3000, "-3000", "myhost:-1234"]` and a key `"-3000"`: connected, `<P>` forwarded, no dashed row, no modal |
| 16 | `[<P>, "-3000"]`: one notification, exactly `Port number must not start with a dash: -3000` |
| 18 | 443 and 8443 open `https://`, a third port `http://` (core's "Open in Browser" with the URL recorded by a fake browser, as coverage-48 records one; reuse its `xdg-open` if that card has landed, otherwise add the same here) |
| 22 | a declared row stopped, then a reload: back, with its label and Origin |
| 25 | `"side:<P>"` with `runArgs: ["--add-host=side:<ip of a sibling container>"]`: forwarded and reachable |
| 26 | `"<ip>:<P>"`: nothing forwarded, nothing shown |
| 30 | `[<P>, <Q>]`, `<Q>` removed, reload: `<Q>`'s row still there |
| 31 | the seven-entry list: exactly `<N>`, `<P1>`, `<P2>`, `<P3>` |
| 32 | `["<P>"]` not forwarded; `[<P>]` forwarded |
| 36 | `remote.autoForwardPorts: false`: both forwarded and reachable |
| 37 | `[<P>, <P>, <Q>, "localhost:<Q>"]`: two rows |
| 38 | `[<P>, "side:<P>"]`: two rows, the second on another local port |

`<P>` and the others are free five-digit ports chosen per run. Rows that need a listener use `listenIn`.

**Coverage:** each criterion above becomes `acceptance` when its row passes.

## 5. Done when

- The unit tests pass, with `src/ports/*` at 100 %.
- `pnpm package && node tools/acceptance.ts --editor vscodium --launches containers-ports,containers` passes. Paste the
  summary line.
- All gates pass. PR title: `remote-containers: declared forwardPorts are forwarded once the window connects (card
  containers-72, #1232)`. Request athena only.
