# Task card server-11: the licence gate takes a cancellation signal

Why: `ensureAccepted` (V6, `licence-gate.ts`) shows the modal through its UI port and cannot be dismissed when the
window tears down; the connect pipeline passes its signal to the gate step, which has nowhere to hand it (#186 second
round, 2026-10-09). Reviewing coder: `remote-coding-worker-2`.

## 1. File boundary

`packages/lib-server/src/gate/licence-gate.ts`, its tests; `packages/remote-ssh/src/pipeline/server-steps.ts`
(the `gate` step passes its cancellation, one line) and `src/pipeline/connect.ts` (the `cancelled` gate outcome mapped
to `Failed {kind: 'cancelled'}`, three lines; added 2026-10-09 on #236 — §2 required it and §1 had left it out)
with one test each. Nothing else. (Amended 2026-10-09 to main's names;
the first wording used invented ones.)

## 2. Contract

```ts
// licence-gate.ts, main's signature plus one trailing parameter
export async function ensureAccepted(
  classification: LicenceClassification,
  store: AcceptanceStore,
  modal: LicenceModal,
  logger: Logger,
  cancellation: AbortSignal,
): Promise<GateOutcome>;
export interface LicenceModal { askUser(termsUrl: string, cancellation: AbortSignal): Promise<ModalAnswer>; }
export type GateOutcome =
  | {kind: 'cleared'; acceptanceFlag: boolean; remembered: boolean}
  | {kind: 'licenceDeclined'}
  | {kind: 'cancelled'};   // new: the signal aborted while the question was open, or was aborted before it
// Rules: `free` and a stored acceptance never read the signal; an already-aborted signal returns `cancelled` without
// calling `askUser`; while `askUser` is pending and the signal aborts, the outcome is `cancelled` whatever the modal
// answers afterwards (the adapter closes the modal on the signal); `accept` and `cancel` answers before any abort
// keep today's outcomes. server-steps.ts: `gate: (cancellation) => ensureAccepted(..., cancellation)`; the pipeline
// maps `cancelled` to its `Failed {kind: 'cancelled'}` as it does for every cancelled step.
```

## 3. Test table

| Given | Expected |
|---|---|
| classification `free`, any signal | `cleared` without `askUser`; the signal unread |
| acceptance stored | `cleared`, `remembered: true`, `askUser` not called |
| signal already aborted, nothing stored | `cancelled`; `askUser` not called |
| `askUser` pending, signal aborts, then the modal answers `accept` | `cancelled`; nothing stored |
| `askUser` answers `accept` before any abort | `cleared`, stored (as today) |
| `askUser` answers `cancel` | `licenceDeclined` (as today) |
| the pipeline's `gate` step with an aborted signal | the connect ends `Failed {kind: 'cancelled'}`; the lease released |
| the existing gate rows | unchanged outcomes |

## 4. Rule for the worker

As card log-01; the existing gate rows unchanged.

## 5. Gates and review

PR title `lib-server: the licence gate takes a cancellation (card server-11)`.

## 6. Open rows

None.
