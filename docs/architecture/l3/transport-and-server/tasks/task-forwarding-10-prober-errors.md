# Task card forwarding-10: the port prober hears every error of its socket

Why: a defect in card forwarding-09's `proberOver` (#368), found while wiring E6c-3. It listens with
`socket.once('error', …)`, so after the first error the socket has no error listener left, and a **second** `error`
event throws out of the event loop: in the extension host, an uncaught exception. Checked on Node 24: a `Socket` with
one `once('error')` listener, sent two `error` events, throws on the second (`second error throws: b`). The existing
row "a refusal answers once, and a later error changes nothing" passes only because the test adds its own
`socket.on('error', () => undefined)` first, which hides the defect. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-forwarding/src/port-search/node-prober.ts` | `socket.on('error', …)` in place of `socket.once('error', …)` |
| `packages/lib-forwarding/test/unit/node-prober.test.ts` | the rows of section 3 |

Nothing else.

## 2. Contract

Unchanged from card forwarding-09, with one addition: the prober keeps its error listener on the socket for the
socket's whole life, so **no error event of the probe's socket is ever unheard**, before or after the answer. The
first event still decides (`finish` answers once); later ones change nothing. The `connect` listener stays `once`.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| §W1 | the existing row "a refusal answers once, and a later error changes nothing", **without** the test's own `socket.on('error', () => undefined)` line | `'refused'`, and no exception (the row fails on today's code with an uncaught `EACCES`) |
| §W1 | a socket that emits `EACCES` before the timer, then `ECONNRESET` after it, with no listener of the test's own | `'error'`, and no exception |
| §W1 | a probe that answered `'open'`, after which the socket emits an `error` | no exception |

All other rows of forwarding-09 pass unchanged. The three rows were checked on a prototype of the fix (2026-10-12): `refused`, `error`, `open`, and no uncaught exception.

## 4. Rule for the worker

As card log-01; coverage at lib-forwarding's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-forwarding: the port prober hears every error of its socket (card forwarding-10)`.

## 6. Open rows

None.
