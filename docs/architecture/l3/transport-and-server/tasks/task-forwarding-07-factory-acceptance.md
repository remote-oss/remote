# Task card forwarding-07: the tunnel factory against the harness host (#163)

Why: #163's last note ("Remaining: the socket adapters and the port-forwarding acceptance tests against the harness
host"). The socket adapters are on main (`nodeLocalPort`, `socksDialer`, forwarding-05), and
`tests/acceptance/server/port-forwarding.test.ts` covers the **relay window tunnel** through them. What no acceptance
test covers yet is the **tunnel factory** (`factoryFor`: a forward, the list, a forward after a reconnection, and the
listener failure of #253 Q1). This card adds the first three against the real harness host. The listener failure is not
reachable from outside a real listener and stays with forwarding-05's unit rows. Implementer: a coder with judgement
(iris or hestia). Reviewers: `themis`; runtime review `daedalus`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `tests/acceptance/server/tunnel-factory.test.ts` | new |

Nothing else. The harness (`startHost`, `openSharedSession`, `freePort`, the echo service started with `nc -ll -p … -e
/bin/cat` as in `port-forwarding.test.ts`) is reused as it is. If a helper of `port-forwarding.test.ts` is needed
twice, move it into `tests/acceptance/server/support.ts` (that file is then in the boundary too), and do not copy it:
jscpd counts test files.

## 2. Contract

The factory is built as the extension will build it: `factoryFor({dialer: socksDialer({local: nodeLocalPort(),
socksPort: session.socksPort, scheduler, handshakeMilliseconds: 10000}), local: nodeLocalPort(), scheduler, limits})`,
with the `scheduler` and `LIMITS` of `port-forwarding.test.ts`. A "client" is a `nodeLocalPort().connect(localPort)`.
Every test closes what it opened (`factory.closeAll()`, the client), also after a failure.

## 3. Test table

Each row is an `it` named by its cite, one assertion each, against the harness host.

| Cite | Given | Expected |
|---|---|---|
| F-2104 BR-1 | `forward({remotePort: ECHO_PORT, localPort: <free>})` | `{kind: 'forwarded', port: {remotePort: ECHO_PORT, localPort}}` |
| F-2105 | a client of that local port sends `ping` | it receives `ping` back from the host's echo service |
| F-2104 | two forwards to the echo port on two local ports | `forwarded()` lists both, in that order |
| F-2104 BR-10 | a forward to a host port where nothing listens | `{kind: 'failed', reason: 'tunnelNotReady'}`, and the local port is free again (a `connect` to it is refused) |
| F-2104 | a forward to a local port another process already listens on | `{kind: 'failed', reason: 'listenFailed'}` |
| F-2104 Q4, F-2507 Q1 | a forward, then `session.stop()` and `openSharedSession(host)` again, then `reconnect(socksDialer over the new session's socksPort)` | the report revives the forward, and a client of the same local port gets its echo through the new session |
| F-2104 Q4 | `reconnect` with a dialer whose relay port does not answer (a free port) | the report lists the forward under `failed`, within one wait bound |
| F-2104 | `closeAll()` after two forwards | `forwarded()` is empty, and both local ports refuse a `connect` |

## 4. Rule for the worker

As card log-01. Acceptance tests have no coverage gate, but each must fail when its feature is broken: for the
reconnect row, show in the PR that it fails when `reconnect` is changed to keep the old dialer.

## 5. Gates and review

PR title `acceptance: the tunnel factory against the harness host (card forwarding-07, #163)`. Run
`pnpm test:acceptance:server` locally and put its result in the PR; CI's acceptance job runs it too.

## 6. Open rows

- The second forwarding session (`openForwardedTunnel` over `ssh -N -L`, card forwarding-04's path) is not in this
  card: it needs lib-ssh's second-session adapter, which is not on main yet. Report if you find it is.
