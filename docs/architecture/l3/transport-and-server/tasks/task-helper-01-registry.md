# Task card helper-01: lib-helper package, record and lease types, registry decisions

Brief: `../brief-lib-helper.md`. Contract: `../contracts.md` §9 (X3 registry; the record and lease types used by X1
and X2). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Create `packages/lib-helper` in the shape of `packages/lib-host` (package.json `lib-helper`, private, `exports` `.` →
`src/index.ts` and `./testing/*`; the tsconfig pair; `coverage.json`; README in the product's voice: a shared pattern
for helper processes that outlive one window; allowed import `lib-log`), with the root tsconfig references. Files:
`src/index.ts`, `src/types.ts`, `src/registry/claim.ts`, `src/registry/stale.ts`, `src/registry/file-port.ts`,
`src/testing/memory-file-port.ts`, tests `test/unit/claim.test.ts`, `test/unit/stale.test.ts`,
`test/unit/record.test.ts`. No `vscode`, no `node:fs`, no `node:net` in this card: file access goes through the port.

## 2. Contract

```ts
export interface HelperRecord {
  version: 1; namespace: string; key: string; endpoint: string; nonce: string; pid: number;
  startedAt: number; payload: Record<string, string | number | boolean>;
}
export type EndPolicy =
  | { kind: 'graceAfterLastLease'; milliseconds: number }
  | { kind: 'delayedCheckAfterLastLease'; milliseconds: number; action: string }
  | { kind: 'idleAfterLastLease'; milliseconds: number };
export interface RegistryFilePort {
  createExclusive(path: string, text: string): Promise<'created' | 'exists'>;
  read(path: string): Promise<string | undefined>;
  remove(path: string): Promise<void>;
}
export function recordPath(folder: string, namespace: string, key: string): string;  // `${folder}/${namespace}/${sha256hex(key).slice(0, 32)}.json`, '/' joined, no other characters of key used
export function serializeRecord(record: HelperRecord): string;      // JSON, keys in the order above; throws RecordShapeError on an unknown or missing field or a non-primitive payload value
export function parseRecord(text: string): HelperRecord | undefined; // undefined on any shape error or version !== 1
export function claim(port: RegistryFilePort, folder: string, namespace: string, key: string, record: HelperRecord):
  Promise<{ outcome: 'claimed' } | { outcome: 'existing'; record: HelperRecord } | { outcome: 'corrupt' }>;
export function isStale(record: HelperRecord, hello: { answered: boolean; nonceMatched: boolean; elapsedMilliseconds: number }, limitMilliseconds: number): boolean;
export function replaceStale(port: RegistryFilePort, folder: string, namespace: string, key: string, record: HelperRecord):
  Promise<{ outcome: 'claimed' } | { outcome: 'existing'; record: HelperRecord }>;  // remove then claim, exactly once; never loops
export class MemoryFilePort implements RegistryFilePort { readonly files: Map<string, string>; /* createExclusive is atomic per call */ }
```

## 3. Test table

| Given | Expected |
|---|---|
| `recordPath('/r', 'ssh.connection', 'user@host:22')` | `/r/ssh.connection/<32 hex>.json`; same input twice gives the same path; a different key gives a different path; the key text does not appear in the path |
| `serializeRecord(valid)` then `parseRecord` | round-trips to a deep-equal record |
| `serializeRecord` with an extra field | throws `RecordShapeError` |
| `serializeRecord` with `payload: {answer: {nested: 1}}` | throws `RecordShapeError` |
| `serializeRecord` with `payload: {password: 'x'}` | throws `RecordShapeError` (keys `password`, `passphrase`, `token`, `secret`, `answer` are refused, case-insensitive) |
| `parseRecord('not json')` | `undefined` |
| `parseRecord` of a record with `version: 2` | `undefined` |
| `parseRecord` of a record missing `nonce` | `undefined` |
| `claim` on an empty port | `claimed`; the file exists with `serializeRecord(record)` |
| `claim` when the file exists with a valid record | `existing` with that record (parsed), the file unchanged |
| `claim` when the file exists with corrupt text | `corrupt`; the file unchanged |
| two concurrent `claim` calls on the same key (Promise.all) | exactly one `claimed`, the other `existing` with the winner's record |
| `isStale(r, {answered: true, nonceMatched: true, elapsed: 10}, 500)` | `false` |
| `isStale(r, {answered: false, nonceMatched: false, elapsed: 500}, 500)` | `true` |
| `isStale(r, {answered: true, nonceMatched: false, elapsed: 10}, 500)` | `true` |
| `isStale(r, {answered: true, nonceMatched: true, elapsed: 500}, 500)` | `true` (limit reached counts as late) |
| `replaceStale` when the file exists | the port saw `remove` then `createExclusive`; outcome `claimed` |
| `replaceStale` when another claimer wins between remove and create | `existing` with the other record; no second remove (the port's call log has exactly one `remove`) |
| `replaceStale` when the file is absent | `claimed`; `remove` still called once (idempotent) |
| `MemoryFilePort.createExclusive` twice on one path | `created` then `exists` |

## 4. Rule for the worker

As card log-01 (tests first; signatures exactly as above; no extra behaviour; ADR-0003; the full gate list;
100 % coverage for the card's files; `coverage:update`). `sha256hex` comes from `node:crypto` (allowed; it is not file
or network access).

## 5. Gates and review

PR title `lib-helper: package and registry (card helper-01)`; body: the table as the test list, R1–R6. Reviewer:
`remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected.
