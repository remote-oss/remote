# Task card server-12: the gate's abort listener is removed when the modal answers first (#237)

Why: `askUserOrCancelled` in `packages/lib-server/src/gate/licence-gate.ts` (from card server-11, #236) adds an
`abort` listener to the caller's signal and never removes it when the modal answers first; a long-lived signal
(the connect's) keeps a resolved promise's closure per gate call (#236 review, 2026-10-09). Reviewing coder:
`remote-coding-worker-2`.

## 1. File boundary

`packages/lib-server/src/gate/licence-gate.ts`, `test/unit/licence-gate.test.ts`. Nothing else.

## 2. Contract

```ts
// askUserOrCancelled: the listener is added with {once: true} as today, and removed in a `finally` once the race
// settles by the modal's answer (removeEventListener with the same function). Behaviour is otherwise unchanged:
// an abort before or during the question still wins the race as 'cancelled'.
```

## 3. Test table

| Given | Expected |
|---|---|
| the modal answers `accept`; then the signal aborts | the gate's outcome was `cleared`; the signal has no listener left (a fake `AbortSignal` with `addEventListener`/`removeEventListener` counting shows add 1, remove 1) |
| the modal answers `cancel`; then the signal aborts | `licenceDeclined`; add 1, remove 1 |
| the signal aborts while the question is open | `cancelled`; add 1, remove 0 or 1 (the `once` listener fired) |
| the signal is already aborted | `cancelled`; add 0 |
| the existing server-11 rows | unchanged |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: the gate removes its abort listener (card server-12)`. Depends on #236 merged.

## 6. Open rows

None.
