# Task card forwarding-08: the tunnel's waiting signal, and a close that runs once

Why: themis's two notes on #302.
1. F-2104 shows "Waiting for port forwarding to be ready" (S158) "while the window waits for the first connection through
   the tunnel to reach the server and that wait takes visible time" (7.E3 b, 7.E4, 7.E5). The pipeline passes an
   `onWaiting` to the tunnel step, but `openRelayTunnel` has no hook to tell it the wait is taking time, so the stage
   never shows.
2. A tunnel's `close` isn't idempotent: the relay's `close` closes its listener on every call, and the tunnel step's
   `close` closes the factory and the relay each time. The pipeline closes a late tunnel, and the connector closes it on
   teardown, so it can be called twice.

Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-forwarding/src/window-tunnel/relay.ts` | `RelayTunnelRequest.onWaiting`, and a `close` that acts once |
| `packages/lib-forwarding/test/unit/window-tunnel.test.ts` | rows added |
| `packages/remote-ssh/src/pipeline/tunnel-step.ts` | passes the step's `onWaiting` into the request; its `close` acts once |
| `packages/remote-ssh/test/unit/tunnel-step.test.ts` | rows added |

Nothing else.

## 2. Contract

`relay.ts`:

```ts
export interface RelayTunnelRequest {
  // … as today, plus:
  /** Told once, when the first probe through the dialer did not work and the tunnel goes on waiting. */
  onWaiting?: () => void;
}
```

- The readiness attempt calls `onWaiting` at most once, after the **first** probe fails and before it tries again.
  A first probe that works never calls it. This is the reading of "the wait takes visible time": the tunnel is waiting
  as soon as it must try again. It is provisional on F-2104 7.E3 b's "visible", and athena checks it.
- `close()` acts once: the second and later calls do nothing.

`tunnel-step.ts`:

- The step's fourth argument (`onWaiting`, today ignored) is passed as the request's `onWaiting`.
- The returned `close` acts once: it closes the factory and the relay the first time, and does nothing after.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| F-2104 7.E3 b | `openRelayTunnel` whose first probe fails and second works, with an `onWaiting` that counts | `onWaiting` called once |
| F-2104 | a first probe that works | `onWaiting` not called |
| F-2104 7.E5 | every probe fails until the bound | `onWaiting` called once (not once per retry), and the outcome is `tunnelNotReady` |
| F-2104 | an `openRelayTunnel` request without `onWaiting` whose first probe fails | opens as today, no throw |
| F-2104 | the relay's `close()` twice | the listener is closed once (`FakeLocalPort.closedPorts` lists the port once) |
| F-2304 S158 | the tunnel step whose relay's first probe fails | the step's `onWaiting` was called once |
| F-2104 | the tunnel step's `close` twice | the window port closed once |

## 4. Rule for the worker

As card log-01; coverage at both packages' 100/100/100 ratchets.

## 5. Gates and review

PR title `lib-forwarding, remote-ssh: the tunnel's waiting signal and a close that runs once (card forwarding-08)`.

## 6. Open rows

None. The rule "waiting after the first failed probe" is stated in section 2 for the design check.
