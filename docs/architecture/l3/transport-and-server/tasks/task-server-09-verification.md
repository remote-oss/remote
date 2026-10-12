> **Retired 2026-10-12 (daedalus): superseded, do not start.** V4's verification is on main as `verifyArchive` in
> `packages/lib-server/src/transfer/verify.ts` (24337b8, "V4 part 2"): the first rule whose facts are present, in the
> record's order. This card's "no rule applies → unverifiable, not ok" predates the ruling of #158 (contracts.md §5
> V4: "A response that gives the facts of no rule … counts as verified"), which `verifyArchive` follows. Its
> `export type Verification` would also collide with the one `src/index.ts` already exports from `policy/record.ts`.
> The one detail it adds, a `sha256-` prefix on the digest header, has no case yet: no product's policy table names a
> digest header, and nothing sets `announcedSha256`. It belongs to the card of the first product that names one.

# Task card server-09: V4's verification decision (pure)

Contract: `../contracts.md` §5 V4 ("Verification follows the record: the download port reports the redirect chain's
response facts, and V4 applies the first rule whose facts are present") and §5.0 (`verification` ordered list).
Depends on lib-server on main. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `packages/lib-server/src/transfer/verification.ts`, `src/index.ts` (exports only), test
`test/unit/verification.test.ts`. The hashing of a file is NOT in this card (it needs a file port); this card decides
which rule applies and checks given facts.

## 2. Contract

```ts
export type Verification = 'headerHash' | 'lengthOnly' | 'none';   // from the policy record
export interface ResponseFacts { finalUrl: string; status: number; sha256Header?: string; contentLength?: number }   // from the final response of the redirect chain (ruled 2026-10-08); the digest header is the one the policy table names, read by the port, value lower-case hex (with or without a `sha256-` prefix)
export interface DownloadedFacts { sha256?: string; byteLength: number }        // sha256 computed by the caller only when asked
export function selectRule(rules: readonly Verification[], facts: ResponseFacts): Verification | 'unverifiable';
// the first rule whose facts are present: headerHash needs sha256Header; lengthOnly needs contentLength; none needs nothing; if no rule applies → 'unverifiable'
export function requiresHash(rule: Verification | 'unverifiable'): boolean;     // true only for headerHash
export type VerifyOutcome = { ok: true; rule: Verification } | { ok: false; rule: Verification | 'unverifiable'; problem: 'hashMismatch' | 'lengthMismatch' | 'unverifiable' | 'missingDownloadHash' };
export function verify(rules: readonly Verification[], response: ResponseFacts, downloaded: DownloadedFacts): VerifyOutcome;
// selectRule, then: headerHash → compare lower-case hex (header may carry upper case or a `sha256-` prefix; normalise both) with downloaded.sha256 (missing → missingDownloadHash); lengthOnly → compare contentLength with byteLength; none → ok; unverifiable → not ok
```

## 3. Test table

| Given | Expected |
|---|---|
| `selectRule(['headerHash','lengthOnly'], {sha256Header:'ab', contentLength: 3})` | `headerHash` |
| `selectRule(['headerHash','lengthOnly'], {contentLength: 3})` | `lengthOnly` |
| `selectRule(['headerHash','lengthOnly'], {})` | `unverifiable` |
| `selectRule(['none'], {})` | `none` |
| `selectRule(['headerHash','none'], {})` | `none` |
| `selectRule([], {sha256Header:'ab'})` | `unverifiable` |
| `requiresHash('headerHash')` / `('lengthOnly')` / `('none')` / `('unverifiable')` | true / false / false / false |
| `verify(['headerHash'], {sha256Header:'ABCD'}, {sha256:'abcd', byteLength: 1})` | ok, rule headerHash (case-insensitive) |
| header `'sha256-abcd'` | ok (prefix stripped) |
| header `'abcd'`, downloaded sha256 `'abce'` | not ok, `hashMismatch` |
| header present, downloaded sha256 missing | not ok, `missingDownloadHash` |
| `verify(['lengthOnly'], {contentLength: 10}, {byteLength: 10})` | ok, rule lengthOnly |
| contentLength 10, byteLength 9 | not ok, `lengthMismatch` |
| `verify(['headerHash','lengthOnly'], {contentLength: 10}, {byteLength: 10})` | ok, rule lengthOnly (first applicable) |
| `verify(['none'], {}, {byteLength: 0})` | ok, rule none |
| `verify(['headerHash'], {}, {byteLength: 5})` | not ok, `unverifiable` |
| `verify(['headerHash','lengthOnly'], {sha256Header:'abcd', contentLength: 10}, {sha256:'abcd', byteLength: 999})` | ok (headerHash applied; length not checked once a stronger rule applied) |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: verification decision (card server-09)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected. Note (2026-10-08): `ResponseFacts` gained `finalUrl` and `status` (always present; this card's
functions ignore them, V4 uses them for the same-host check and diagnostics); add them to the fixtures as given.
