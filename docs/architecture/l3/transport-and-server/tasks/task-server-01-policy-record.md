# Task card server-01: lib-server package, the policy record type, its validator and the three shipped rows

Brief: `../brief-lib-server.md`. Contract: `../contracts.md` §5.0. Reviewing coder: `remote-coding-worker-1`.
Depends on `lib-host` and `lib-product` being on main (types only).

## 1. Package and file boundary

Create `packages/lib-server` in the shape of `packages/lib-host` (package.json `lib-server`, private, `exports` `.` and
`./testing/*`; tsconfig pair; `coverage.json`; README in the product's voice: installs and starts the editor's server
on a host through a host channel; allowed imports `lib-host`, `lib-product`, `lib-log`) with the root tsconfig
references. Files: `src/index.ts`, `src/policy/record.ts`, `src/policy/rows.ts`, `src/policy/validate.ts`, tests
`test/unit/policy-record.test.ts`, `test/unit/policy-rows.test.ts`. Nothing else.

## 2. Contract

```ts
export type DownloadPlacement =
  | { kind: 'hostFirst'; mode: 'auto' | 'always' | 'off' }
  | { kind: 'clientFirstThenHost' }
  | { kind: 'clientOnly' };
export type Verification = 'headerHash' | 'lengthOnly' | 'none';
export type RequirementsCheck = 'none' | 'serverBundled' | 'serverBundledPlusAlpineProbe';
export type ExtraStartOption = 'fileWatcherPolling';
export type Cleanup = { kind: 'keepNewest'; count: number } | { kind: 'onlyCurrentRemoveLeftovers' } | { kind: 'onlyCurrentKeepLeftovers' };
export type InstallMode = 'singleScript' | 'stepwise';
export type Prefetch = { kind: 'none' } | { kind: 'onProductUpdate'; settingKey: string; feedCheckIntervalMilliseconds: number; platformWindowDays: number; licence: 'skipUnaccepted' };
export interface ServerPolicyRecord {
  downloadPlacement: DownloadPlacement; cache: 'none' | 'kept'; verification: readonly Verification[];
  environmentSetup: string | undefined; requirementsCheck: RequirementsCheck;
  allowedExtraStartOptions: readonly ExtraStartOption[]; cleanup: Cleanup; installMode: InstallMode; prefetch: Prefetch;
}
export type PolicyProblem = { path: string; problem: string };
export function validatePolicyRecord(candidate: unknown): { record: ServerPolicyRecord } | { problems: PolicyProblem[] };
export const SSH_POLICY: ServerPolicyRecord;         // hostFirst(auto), none, ['none'], undefined, serverBundled, [], keepNewest(5), singleScript, none
export const CONTAINERS_POLICY: ServerPolicyRecord;  // clientOnly, kept, ['none'], undefined, serverBundled, [], keepNewest(5), singleScript, none   (verification and cleanup provisional: F-1402 Q4, area C)
export function wslPolicy(input: { scriptLessStartup: boolean; environmentSetupPath: string | undefined }): ServerPolicyRecord;
// clientFirstThenHost, kept, ['headerHash','lengthOnly'], input.environmentSetupPath, serverBundledPlusAlpineProbe, ['fileWatcherPolling'],
// stepwise→onlyCurrentRemoveLeftovers / singleScript→onlyCurrentKeepLeftovers, installMode from scriptLessStartup,
// prefetch onProductUpdate {settingKey 'remote.WSL.downloadInBackground', 3600000, 14, 'skipUnaccepted'}
```

Rules: `validatePolicyRecord` reports every problem (not only the first) with a JSON-path-like `path`
(`downloadPlacement.mode`, `verification[1]`); unknown top-level fields are problems; `verification` must be
non-empty and contain no duplicates; `keepNewest.count` must be an integer ≥ 1; `prefetch.feedCheckIntervalMilliseconds`
and `platformWindowDays` must be integers ≥ 1; `environmentSetup` is `undefined` or a non-empty string; the three
shipped rows are frozen objects and pass the validator.

## 3. Test table

| Given | Expected |
|---|---|
| `validatePolicyRecord(SSH_POLICY)` | `{record}` deep-equal to the input |
| same for `CONTAINERS_POLICY`, `wslPolicy({scriptLessStartup: false, environmentSetupPath: undefined})`, `wslPolicy({scriptLessStartup: true, environmentSetupPath: '/home/u/.vscode-server/server-env-setup'})` | `{record}` each |
| `wslPolicy({scriptLessStartup: true, …})` | `installMode 'stepwise'`, `cleanup {kind:'onlyCurrentRemoveLeftovers'}` |
| `wslPolicy({scriptLessStartup: false, …})` | `installMode 'singleScript'`, `cleanup {kind:'onlyCurrentKeepLeftovers'}` |
| `wslPolicy(...)` prefetch | `{kind:'onProductUpdate', settingKey:'remote.WSL.downloadInBackground', feedCheckIntervalMilliseconds: 3600000, platformWindowDays: 14, licence:'skipUnaccepted'}` |
| `SSH_POLICY.cleanup` | `{kind:'keepNewest', count: 5}` |
| `Object.isFrozen(SSH_POLICY)` and of its nested objects | `true` |
| `validatePolicyRecord(null)`, `(42)`, `('x')` | one problem at path `''`, problem `'not an object'` |
| record with `extra: 1` | problem path `extra`, `'unknown field'` |
| record missing `cache` | problem path `cache`, `'missing'` |
| `downloadPlacement: {kind:'hostFirst'}` (no mode) | problem path `downloadPlacement.mode` |
| `downloadPlacement: {kind:'elsewhere'}` | problem path `downloadPlacement.kind` |
| `verification: []` | problem path `verification`, `'empty'` |
| `verification: ['none','none']` | problem path `verification[1]`, `'duplicate'` |
| `verification: ['sha1']` | problem path `verification[0]` |
| `cleanup: {kind:'keepNewest', count: 0}` and `count: 1.5` | problem path `cleanup.count` |
| `environmentSetup: ''` | problem path `environmentSetup` |
| `allowedExtraStartOptions: ['other']` | problem path `allowedExtraStartOptions[0]` |
| `prefetch: {kind:'onProductUpdate', settingKey:'k', feedCheckIntervalMilliseconds: 0, platformWindowDays: 14, licence:'skipUnaccepted'}` | problem path `prefetch.feedCheckIntervalMilliseconds` |
| `prefetch: {..., licence: 'ask'}` | problem path `prefetch.licence` |
| a record with three problems at once (unknown field, empty verification, count 0) | exactly three problems, in field order |

## 4. Rule for the worker

As card log-01 (tests first; signatures exactly as above; no behaviour beyond the table; ADR-0003; full gate list;
100 % coverage for the card's files; `coverage:update`).

## 5. Gates and review

PR title `lib-server: package and policy record (card server-01)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

`CONTAINERS_POLICY`'s `verification` and `cleanup` are provisional values from the brief; use them as given and
mark the two constants with a one-word `provisional` note in the README's table, not in code comments.
