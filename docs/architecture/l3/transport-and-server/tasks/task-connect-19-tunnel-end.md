# Task card connect-19: the window tunnel's own end is a lost transport

Why: found while carding T7b (daedalus on #299), ruled by athena (contracts §3.2). Contracts §W2 (#253 Q1) gives the
window tunnel `onClosed(listener)` for "a tunnel can end after `open` without being asked to", for example when its
local listener fails. The tunnel step drops it: `TunnelOpening` is `{opened, close}`, and the pipeline's
`Connection.onTransport` reports only the lease's notices. So when the window's tunnel dies, nothing tells the
resolver, the window keeps a dead port, and no reconnection starts. **Ruled:** the window tunnel's own end is reported
as `'lost'`, like the lease's `transportLost`. A dead tunnel is a lost transport from the window's side, and core's
reconnect makes a fresh connection and a fresh tunnel (F-2505 BR-1). Safe because W2 never fires `onClosed` for a
`close()` the caller asked for, so a teardown can't start a reconnection. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/pipeline/steps.ts` | `TunnelOpening` gains `onClosed` (section 2.1) |
| `packages/remote-ssh/src/pipeline/tunnel-step.ts` | the SOCKS path passes the relay's `onClosed` through |
| `packages/remote-ssh/src/pipeline/connect.ts` | `onTransport` also reports the tunnel's end as `'lost'` (section 2.2) |
| `packages/remote-ssh/test/unit/pipeline.fixture.ts` | the fixture tunnel gains `onClosed` and a way to end it |
| `packages/remote-ssh/test/unit/tunnel-step.test.ts`, `connect.test.ts`, `connector.test.ts` | rows (section 3) |

## 2. Contract

### 2.1 `TunnelOpening`

```ts
export interface TunnelOpening {
  opened: OpenedTunnel;
  close(): void;
  /**
   * Calls `listener` once when the tunnel ends without being asked to (its listener failed, or its own session
   * ended), at once if it already has. A `close()` the caller asked for never calls it.
   */
  onClosed(listener: (detail: string) => void): void;
}
```

The SOCKS path's `onClosed` is the relay outcome's `onClosed` (lib-forwarding already keeps W2's rule: once, never
for a requested `close()`, at once for a late listener).

### 2.2 `onTransport`

`Connection.onTransport(listener)` subscribes to both:
- the lease's notices, as today (`transportLost` → `'lost'`, `helperGone` → `'closed'`);
- the tunnel's `onClosed`, which calls `listener('lost')` and logs the detail (`the window tunnel ended: <detail>`,
  F-2003).

The function it returns stops both: after it, neither reaches the listener (the tunnel's subscription is ended by
a flag, since `onClosed` has no unsubscribe). The connector already passes a `'lost'` on to the resolver host only
while it holds that connection, so a tunnel end of a connection it has released reaches nobody.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| contracts §W2 | the SOCKS path open, then the relay's listener fails | the `TunnelOpening`'s `onClosed` listener heard the detail once |
| contracts §W2 | the SOCKS path, then its `close()` | no `onClosed` |
| #299 | a connection whose tunnel ends without being asked (the fixture's `endTunnel('listener failed')`) | its `onTransport` listener heard `'lost'` once |
| F-2003 | the same | the log has `the window tunnel ended: listener failed` |
| #299, safety | the connection's `release()` (which closes the tunnel) | no `'lost'` |
| #299 | `onTransport`'s stop, then the tunnel ends | no `'lost'` |
| F-2505 BR-1 | through the connector: a held connection's tunnel ends | the connector's `onTransportLost` listeners heard it |
| contracts | through the connector: a tunnel end after `cancel()` released it | nobody heard it |
| contracts | the lease's `transportLost` notice | still `'lost'`, unchanged |
| contracts | the lease's `helperGone` notice | still `'closed'`, unchanged |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the window tunnel's own end is a lost transport (card connect-19)`.

## 6. Open rows

None. Ruled by athena (contracts §3.2, #299).
