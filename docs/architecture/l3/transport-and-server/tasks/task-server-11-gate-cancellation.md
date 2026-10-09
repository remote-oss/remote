# Task card server-11: the licence gate takes a cancellation signal

Why: `ensureAccepted` (V6, `licence-gate.ts`) shows the modal through its UI port and cannot be dismissed when the
window tears down; the connect pipeline passes its signal to the gate step, which has nowhere to hand it (#186 second
round, 2026-10-09). Reviewing coder: `remote-coding-worker-2`.

## 1. File boundary

`packages/lib-server/src/licence/licence-gate.ts` (or the gate module as named on main), the UI port's type, its
tests; `packages/remote-ssh/src/pipeline/server-steps.ts` passes the signal through (one line) with one test.

## 2. Contract

```ts
export function ensureAccepted(input: GateInput, cancellation: AbortSignal): Promise<GateOutcome>;
// the UI port's `confirm` receives the signal; an abort while the modal is open resolves the gate as
// {kind: 'declined', reason: 'cancelled'} and the modal is closed by the adapter; an already-aborted signal returns
// that outcome without showing anything; an accepted or stored acceptance is unaffected.
```

## 3. Test table

| Given | Expected |
|---|---|
| acceptance stored | `accepted` without calling the port; the signal unused |
| modal open, signal aborts | `declined` with reason `cancelled`; the port saw the signal |
| signal already aborted | `declined` `cancelled`; the port not called |
| modal answered Accept before any abort | `accepted`, stored |
| modal answered Cancel | `declined` with its existing reason |
| the pipeline's gate step | passes its cancellation to `ensureAccepted` |

## 4. Rule for the worker

As card log-01; the existing gate rows unchanged.

## 5. Gates and review

PR title `lib-server: the licence gate takes a cancellation (card server-11)`.

## 6. Open rows

None.
