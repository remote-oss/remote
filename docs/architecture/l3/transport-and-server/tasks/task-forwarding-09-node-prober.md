# Task card forwarding-09: the port search's prober over `node:net`

Why: found while wiring E6c-3 (#140). The window tunnel picks its local port with lib-forwarding's `findFreePort`
(contracts §W1, F-2104 BR-6/BR-7), which asks a `PortProber` whether each candidate is free. Only a fake prober
exists (`testing/fake-prober.ts`); the extension needs the real one. §W1: "the first port whose connection attempt is
refused"; "Never: probe by binding". Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-forwarding/src/port-search/node-prober.ts` | new: `nodePortProber` (section 2) |
| `packages/lib-forwarding/src/index.ts` | export `nodePortProber` and `PROBE_TIMEOUT_MILLISECONDS` |
| `packages/lib-forwarding/test/unit/node-prober.test.ts` | new, over real loopback sockets (as `node-network.test.ts` does) |

Nothing else. `findFreePort` is unchanged.

## 2. Contract

```ts
/** How long one probe waits for an answer before it counts as an error. */
export const PROBE_TIMEOUT_MILLISECONDS = 500;

/** A prober over `connect`, which starts a connection to a loopback port; it never binds a port (§W1). */
export function proberOver(
  connect: (port: number) => Socket,
  timeoutMilliseconds: number,
): PortProber;

/** The prober over `node:net`: `127.0.0.1:<port>`, with the default timeout. */
export function nodePortProber(): PortProber;
```

`nodePortProber()` is `proberOver(port => createConnection({host: '127.0.0.1', port}), PROBE_TIMEOUT_MILLISECONDS)`.
Taking `connect` as a parameter follows `listenOn`'s pattern (`node-network.ts` takes its `Server`): the tests reach
every branch with real sockets, and no branch needs a real hang.

`probe(port)` opens a TCP connection to `127.0.0.1:<port>` (`node:net` `createConnection`) and answers:
- the connection is refused (`ECONNREFUSED`): `'refused'`, the port is free;
- it connects: `'open'`, someone listens; the socket is closed at once;
- any other error, or no answer within the timeout (default `PROBE_TIMEOUT_MILLISECONDS`): `'error'`, which the search
  treats as not free and moves on.

Every path destroys the socket and answers once. It never listens on, or binds, any port.

**The timeout is a plain timer** (`setTimeout` around the connect, cleared on the answer), **not**
`socket.setTimeout`. A socket's idle timeout only runs once the socket is connecting or connected, so it never fires
for a connect that hasn't started reporting (checked: a bare `new Socket()` given `setTimeout(20)` never answered,
while a 20 ms timer answered `'error'` after 21 ms).

**The timeout (ruled, athena, 2026-10-12): 500 ms, as proposed.** `findFreePort`'s 3 s budget (F-2104 BR-7) is checked *between* probes, so one probe
that never answers would stall the search past it. A per-probe bound keeps the search within budget plus one probe.
The loopback answers in well under a millisecond (refused or open). Proposal: **500 ms**, under the 3 s budget and far
above any loopback answer, so a real answer is never mislabelled. A probe that times out is `'error'`, so not free, which is the safe side: the search moves on and never picks a port
it couldn't confirm was free, and the stalled socket is destroyed with the rest. It's a named lib-forwarding constant,
with its basis (F-2104 BR-7's budget) in the test name.

## 3. Test table

One assertion per `it`; the cite starts the name. Ports come from real servers the test opens on `127.0.0.1`.

| Cite | Given | Expected |
|---|---|---|
| §W1 | a port a test server listens on | `'open'` |
| §W1 | a port a test server listened on and then closed | `'refused'` |
| §W1 | an `'open'` probe | the test server saw one connection, which was closed |
| §W1 | `proberOver(() => new Socket(), 20)` (a socket that never connects or errors) | `'error'`, after the 20 ms timer |
| §W1 | `proberOver` over a socket that emits an error with code `EACCES` | `'error'` |
| §W1 | `proberOver` over a socket that emits `ECONNREFUSED` and later another error | `'refused'`, answered once |
| §W1, F-2104 BR-7 | `findFreePort(nodePortProber(), {first: <taken>, last: <free>})` | `{port: <free>}` |
| §W1 | a free port, probed, then a test server listens on it | the listen succeeds (the probe held nothing on the port) |
| §W1 | the default | `PROBE_TIMEOUT_MILLISECONDS` is 500 |

Every row was checked on a prototype over real sockets (2026-10-12). On loopback no real setup leaves a connect
unanswered (a listening socket that never accepts still completes the handshake, so it answers `'open'`), which is why
the timeout row uses `proberOver` with a socket that never connects.

## 4. Rule for the worker

As card log-01; coverage at lib-forwarding's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-forwarding: the port search's prober over node:net (card forwarding-09)`.

## 6. Open rows

One: the per-probe timeout's value (section 2), for athena. Proposed: 500 ms.
