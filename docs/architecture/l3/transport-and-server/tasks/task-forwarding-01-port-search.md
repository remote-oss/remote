# Task card forwarding-01: lib-forwarding package and W1 port search (pure decisions, fake prober)

Brief: slice 2 (build-order). Contract: `../contracts.md` §6 W1. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Create `packages/lib-forwarding` in the shape of `packages/lib-host` (allowed imports `lib-log`). Files:
`src/index.ts`, `src/port-search/range.ts`, `src/port-search/find.ts`, `src/testing/fake-prober.ts`, tests
`test/unit/range.test.ts`, `test/unit/find.test.ts`. No `node:net` in this card: probing goes through a port.

## 2. Contract

```ts
export type PortRange = { first: number; last: number };   // inclusive, 1 ≤ first ≤ last ≤ 65535
export function parseRange(settingValue: unknown): { range: PortRange } | { none: true; reason: string };
// accepted forms: a string "A-B" (digits, one hyphen, optional spaces around) with 1 ≤ A ≤ B ≤ 65535; anything else → none with reason 'notAString' | 'badFormat' | 'outOfBounds' | 'reversed'; an empty or whitespace string → none, reason 'empty'
export interface PortProber { probe(port: number): Promise<'refused' | 'open' | 'error'> }   // 'refused' = nobody listens (the port is free)
export interface FindOptions { timeBudgetMilliseconds: number; now: () => number; randomPort: () => number }  // defaults 3000, Date.now, a function returning a random port in 49152–65535
export function findFreePort(prober: PortProber, range: PortRange | undefined, options?: FindOptions): Promise<{ port: number } | { failure: 'noFreePort' }>;
// with a range: probe first..last in order; the first 'refused' wins; 'open' and 'error' continue; stop with noFreePort after the whole range or when the time budget is exhausted (checked before each probe)
// without a range: up to 10 random candidates from randomPort(); the first 'refused' wins; else noFreePort
```

## 3. Test table

| Given | Expected |
|---|---|
| `parseRange('40000-40010')` | `{first:40000, last:40010}` |
| `parseRange(' 1 - 65535 ')` | `{first:1, last:65535}` |
| `parseRange('40010-40000')` | none `reversed` |
| `parseRange('0-10')`, `parseRange('1-70000')` | none `outOfBounds` |
| `parseRange('abc')`, `parseRange('1-2-3')`, `parseRange('10')` | none `badFormat` |
| `parseRange('')`, `parseRange('   ')` | none `empty` |
| `parseRange(42)`, `parseRange(undefined)`, `parseRange(null)` | none `notAString` |
| range 40000–40002, prober: 40000 open, 40001 refused | `{port: 40001}`; 40002 never probed |
| range 40000–40002, all open | `noFreePort`; three probes |
| range 40000–40002, first `error` then refused | `{port: 40001}` |
| range 40000–40100, each probe advances the fake clock 500 ms, budget 3000 | stops after 6 probes → `noFreePort` |
| no range, random sequence [50000 open, 50001 refused] | `{port: 50001}` |
| no range, ten opens | `noFreePort`; exactly ten probes |
| no range, default randomPort | returns a port within 49152–65535 (call 100 times) |
| `FakeProber` | takes a map port → answer and records the probed ports in order |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-forwarding: package and port search (card forwarding-01)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected.
