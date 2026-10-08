# Task card server-05: V5 lock decisions (pure, fake clock, fake file port)

Brief: `../brief-lib-server.md`. Contract: `../contracts.md` §5 V5. Depends on server-01 merged. Reviewing coder:
`remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/locks/client-lock.ts`, `src/locks/host-lock-loop.ts`, `src/testing/fake-clock.ts` (copy the shape of
lib-helper's `FakeClock` if it is on main; otherwise the same API), `src/testing/memory-lock-port.ts`, `src/index.ts`
(exports only), tests `test/unit/client-lock.test.ts`, `test/unit/host-lock-loop.test.ts`.

## 2. Contract

```ts
export interface LockFilePort {
  createExclusive(path: string, text: string): Promise<'created' | 'exists'>;
  ageMilliseconds(path: string): Promise<number | undefined>;   // undefined when absent
  remove(path: string): Promise<void>;
}
export interface ClientLockOptions { pollMilliseconds: number; giveUpMilliseconds: number; takeoverAgeMilliseconds: number }  // defaults 500, 120000, 240000
export function lockIdFor(hostIdentity: string): string;   // 8 lower-case hex characters, stable for the same identity (sha256 prefix)
export function withClientLock<T>(port: LockFilePort, folder: string, hostIdentity: string, clock: Clock, work: () => Promise<T>, onWaiting: () => void, options?: ClientLockOptions):
  Promise<{ kind: 'done'; value: T } | { kind: 'lockTimeout' }>;
// path `${folder}/${lockIdFor(identity)}.lock`; try createExclusive; if 'exists': if age >= takeoverAge → remove then createExclusive once more (a loser of that race keeps polling); else call onWaiting once (first wait only) and poll every pollMilliseconds until created or giveUp elapsed → lockTimeout; on success run work, then remove the file (also when work throws; the error propagates); the holder never refreshes the file.
export function hostLockLoop<T>(step: () => Promise<{ kind: 'result'; value: T } | { kind: 'lockBusy' }>, clock: Clock, onRetry: (attempt: number) => void, attempts = 30, intervalMilliseconds = 1000):
  Promise<{ kind: 'done'; value: T } | { kind: 'retriesExhausted' }>;
// attempt 1 immediately; after each lockBusy call onRetry(n) with n = 1.. and wait interval; after `attempts` busy results → retriesExhausted
```

## 3. Test table

| Given | Expected |
|---|---|
| `lockIdFor('u@h:22')` | 8 lower-case hex chars; same twice; differs for `'u@h:23'` |
| no file: `withClientLock` | `done` with work's value; the file created before work runs and removed after |
| work throws | the error propagates; the file is removed |
| file exists, age 1000; the holder removes it after 3 polls (test removes it on the 3rd `ageMilliseconds` call) | `onWaiting` called once; `done`; the clock advanced 1500 ms in 500 steps |
| file exists forever, age 1000 | after 120000 ms of polling → `lockTimeout`; `onWaiting` once; no remove call |
| file exists, age 240000 | removed, created, `done` (takeover), `onWaiting` not called |
| file exists, age 239999 | polls (no takeover); then with time, age reported growing per poll by the fake → takeover when age reaches 240000 → `done` |
| takeover race: after the remove, `createExclusive` returns `exists` (another waiter won) | keep polling; when the file is later removed → `done`; exactly one `remove` call |
| custom options `{poll 100, giveUp 300, takeover 1000}` with a file aged 10 | three polls then `lockTimeout` at 300 ms |
| `hostLockLoop`: step returns result at once | `done`, `onRetry` never called, clock unchanged |
| busy twice then result | `done`; `onRetry(1)`, `onRetry(2)`; the clock advanced 2000 ms |
| busy 30 times | `retriesExhausted`; `onRetry` called 1..29 (no wait after the last attempt) |
| busy 29 times then result | `done` on attempt 30 |
| `attempts = 1`, busy once | `retriesExhausted`, `onRetry` not called |
| `MemoryLockPort`: `ageMilliseconds` of an absent path | `undefined` |

The fake port reports `ageMilliseconds` from a value the test sets, plus the fake clock's advance since the set.

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: lock decisions (card server-05)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected.
