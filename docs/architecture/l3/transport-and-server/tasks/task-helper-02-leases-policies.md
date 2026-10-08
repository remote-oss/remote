# Task card helper-02: lease state machine and end policies (pure, fake clock)

Brief: `../brief-lib-helper.md`. Contract: `../contracts.md` §9 (X1 lease order, X2 end policies). Depends on card
helper-01. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/runtime/leases.ts`, `src/runtime/end-policy.ts`, `src/testing/fake-clock.ts`, tests
`test/unit/leases.test.ts`, `test/unit/end-policy.test.ts`; `src/index.ts` gains the exports only. Nothing that
opens sockets or spawns; the runtime's endpoint and the client are a Claude task.

## 2. Contract

Names ruled 2026-10-08 (ADR-0003): `recordKey`, `startedByProcessId`, `leaseId`, `close(leaseId)`, `now()`; no eslint-disable for names anywhere.

```ts
export interface Lease { readonly leaseId: number; readonly openedAt: number }
export interface LeaseEvent { kind: 'leaseListChanged'; leases: readonly Lease[] }
export class LeaseTable {
  constructor(now: () => number);
  open(): Lease;                         // ids 1, 2, 3, … in arrival order, never reused
  close(leaseId: number): boolean;       // false when unknown or already closed
  live(): readonly Lease[];              // oldest first
  oldest(): Lease | undefined;
  onChange(listener: (event: LeaseEvent) => void): () => void;  // every open and close fires once
}
export interface Scheduler { setTimer(milliseconds: number, callback: () => void): () => void }  // returns cancel
export type PolicyOutcome = { kind: 'end' } | { kind: 'runActionThenEnd'; action: string };
export class EndPolicyRunner {
  constructor(policy: EndPolicy, table: LeaseTable, scheduler: Scheduler, onOutcome: (outcome: PolicyOutcome) => void);
  // armed at construction as if a lease had just closed (a helper that never receives a lease still ends; ruled 2026-10-08); re-arms whenever the live list becomes empty; disarms when a lease opens before the timer fires;
  // delayedCheck: when the timer fires, if the list is still empty → onOutcome({runActionThenEnd, action}); else nothing (disarmed by the open already)
  // grace and idle: when the timer fires and the list is still empty → onOutcome({end})
  dispose(): void;                       // cancels any armed timer
}
export class FakeClock { now(): number; advance(milliseconds: number): void; scheduler(): Scheduler }  // timers fire in order on advance, including those armed during a callback
```

Rules: an `EndPolicy` with `milliseconds <= 0` or a non-finite value throws `PolicyError` at construction; a policy
is required (the constructor takes no `undefined`); the runner never arms while a lease is live; it arms at most one
timer at a time.

## 3. Test table

| Given | Expected |
|---|---|
| `open()` three times | leaseIds 1, 2, 3; `live()` in that order; `oldest().leaseId === 1` |
| `close(1)` | `live()` is [2, 3]; `oldest().leaseId === 2`; returns `true` |
| `close(1)` again; `close(99)` | both `false`; no change event |
| after closing all, `open()` | leaseId 4 (never reused); `oldest().leaseId === 4` |
| `onChange` listener; open, close | two events, `leases` arrays equal `live()` at each moment; the unsubscribe stops further events |
| `openedAt` | equals the clock value at `open()` |
| grace 3000: open, close, advance 2999 | no outcome |
| grace 3000: open, close, advance 3000 | one outcome `{end}` |
| grace 3000: open, close, advance 1000, open, advance 5000 | no outcome (disarmed by the open) |
| grace 3000: open, close, advance 1000, open, close, advance 2999 | no outcome (re-armed from the second close) |
| grace 3000: … then advance 1 | one outcome `{end}` |
| idle 45000: open, close, advance 45000 | one outcome `{end}` |
| delayedCheck 10000 action `stopContainers`: open, close, advance 10000 | one outcome `{runActionThenEnd, action: 'stopContainers'}` |
| delayedCheck: open, close, advance 9999, open, advance 10 | no outcome |
| two leases, close one, advance past the grace | no outcome (a lease is live) |
| `dispose()` after close, then advance past the grace | no outcome |
| policy `{kind: 'graceAfterLastLease', milliseconds: 0}` | constructor throws `PolicyError`; same for `-1` and `NaN` |
| the runner with a table that is empty at construction | armed at once: advance past the policy's time with no lease ever opened → one outcome; a lease opened before the timer disarms it |
| `FakeClock`: two timers 100 and 50 | the 50 fires first on `advance(100)`; a timer armed inside a callback for 10 fires within the same `advance` when it falls inside the window |
| `FakeClock` cancel | a cancelled timer never fires |

## 4. Rule for the worker

As card helper-01.

## 5. Gates and review

PR title `lib-helper: leases and end policies (card helper-02)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

Whether `delayedCheck` should re-check once more after the action (contract says "check again, then run the action,
then end"; this card runs the action when the list is still empty at the timer and ends): report if a test in the
table seems to contradict that reading; do not change the table.
