# Task card authority-03: proposed-API gate decisions (pure)

Contract: `../contracts.md` §3.4 (the family-wide gate: probe results, one notification per window, the argv.json
entry, the dismissal flag of F-1403 §6, no success cache). Depends on authority-01 (the package). Reviewing coder:
`remote-coding-worker-1`.

## 1. Package and file boundary

Files: `packages/lib-authority/src/gate/decisions.ts`, `src/index.ts` (exports only), test
`test/unit/gate-decisions.test.ts`. No `vscode`: the probes and the notification are a Claude task; this card decides.

## 2. Contract

```ts
export type ProbeResult = 'granted' | 'missing' | 'unprobeable';
export interface ProbeReport { proposal: string; result: ProbeResult }
export interface GateInput {
  extensionId: string;
  probes: readonly ProbeReport[];
  installedFamilyIds: readonly string[];          // family extensions installed in this editor, including this one
  argvEnabled: readonly string[];                   // ids already in argv.json's enable-proposed-api, as read by the caller
  dismissed: boolean;                               // F-1403 §6 flag for this extension
  activationTime: boolean;                          // true at activation, false after a gated use failed
  windowClaimedBy: string | undefined;              // the context key's current holder, if any
}
export type GateDecision =
  | { kind: 'proceed'; granted: readonly string[]; missing: readonly string[] }                 // nothing missing, or missing but silenced
  | { kind: 'notify'; claimWindow: true; argvEntries: readonly string[]; missing: readonly string[] }  // this extension shows the one notification
  | { kind: 'silent'; missing: readonly string[] };                                             // another extension holds the window
export function decide(input: GateInput): GateDecision;
// missing = probes with result 'missing' (unprobeable counts as neither); if none missing → proceed
// if dismissed && activationTime → proceed (silenced); after a gated use failed, the dismissal does not silence
// if windowClaimedBy is set and not this extensionId → silent
// else → notify: argvEntries = installedFamilyIds not already in argvEnabled, own id first, then the others in the given order, no duplicates; never the bare switch
export function argvEntryList(ownId: string, installed: readonly string[], enabled: readonly string[]): string[];
```

## 3. Test table

| Given | Expected |
|---|---|
| all probes granted | `proceed`, granted = all, missing = [] |
| one missing, `dismissed: true`, `activationTime: true` | `proceed` with missing listed |
| one missing, `dismissed: true`, `activationTime: false` | `notify` (a failed gated use is not silenced) |
| one missing, window claimed by another id | `silent` with missing |
| one missing, window claimed by this id | `notify` (re-entry by the holder) |
| one missing, nothing claimed | `notify`, `claimWindow: true` |
| `unprobeable` only | `proceed`, missing = [] |
| `argvEntryList('remote-oss.remote-ssh', ['remote-oss.remote-explorer','remote-oss.remote-ssh','remote-oss.remote-containers'], [])` | `['remote-oss.remote-ssh','remote-oss.remote-explorer','remote-oss.remote-containers']` |
| same with `enabled: ['remote-oss.remote-ssh']` | `['remote-oss.remote-explorer','remote-oss.remote-containers']` |
| installed with a duplicate id | no duplicate in the result |
| `argvEntryList` never contains `'*'` or an empty string | assert on inputs including `'*'` in installed (filtered out) |
| `notify.argvEntries` equals `argvEntryList(extensionId, installedFamilyIds, argvEnabled)` | property check over three inputs |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-authority: gate decisions (card authority-03)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected.
