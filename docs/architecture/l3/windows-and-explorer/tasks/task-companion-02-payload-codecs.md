# Task card companion-02: the payload codecs of the `remote-internal.*` calls (pure)

Why: both sides of the companion interface read and write the same plain-data payloads (F-5902 section 5, contracts.md
section 4.1). Reviewing coder: `remote-coding-worker-1`. Depends on card companion-01 (the package) being merged; if
`packages/lib-companion/package.json` is absent, stop (section 6, row 1). No `vscode` import.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-companion/src/payloads.ts` | new: the types, `INTERFACE_VERSION`, the `read*` and `write*` functions |
| `packages/lib-companion/test/unit/payloads.test.ts` | new |
| `packages/lib-companion/src/index.ts` | add one export line for `payloads.ts` (the only shared file) |
| `packages/lib-companion/test/unit/skeleton.test.ts` | remove the one `it` of card companion-01's last row, named `F-5902.5.table: the entry module resolves and exports nothing` on main; leave the other eight `it`s untouched |

That `it` asserts that `src/index.ts` exports nothing, which this card's export line ends; `payloads.test.ts` loads the
entry module from here on. If the `it` is absent on main, there is nothing to remove. (Amended 2026-10-12.)

Nothing else may change. No fixtures. The payload field names below are this card's decision; the companion
interface document is not on main, so any later difference is an open row of the card that lands the document.

## 2. Contract

```ts
export interface InterfaceVersion { major: number; minor: number }
export const INTERFACE_VERSION: InterfaceVersion;      // {major: 1, minor: 0}
export type Refusal = 'foreign' | 'unknownMajor';
export type ReadOutcome<Value> = {status: 'valid'; value: Value} | {status: 'refused'; reason: Refusal};
export interface Versioned { interfaceVersion: InterfaceVersion }
export interface ActiveRemote extends Versioned { connected: boolean; hostKey?: string }
export interface Hostnames extends Versioned { hostnames: string[] }
export type PathKind = 'folder' | 'workspace';
export interface HistoryEntry { path: string; kind: PathKind }
export interface HostHistory { hostKey: string; entries: HistoryEntry[] }
export interface FoldersHistory extends Versioned { hosts: HostHistory[] }
export interface DeleteRequest extends Versioned { hostKey: string; path: string }
export interface DeleteResult extends Versioned { changed: boolean }
export interface OpenRequest extends Versioned { hostKey: string; path?: string; kind?: PathKind; window: 'current' | 'new' }
export type PushOutcome = 'connected' | 'failed' | 'none';
export interface ActiveFoldersPush extends Versioned { outcome: PushOutcome; hostKey?: string; folders?: string[] }

export function readEnvelope(raw: unknown): ReadOutcome<Versioned>;     // also the whole argument of the host-list change signal
export function readActiveRemote(raw: unknown): ReadOutcome<ActiveRemote>;
export function readHostnames(raw: unknown): ReadOutcome<Hostnames>;
export function readFoldersHistory(raw: unknown): ReadOutcome<FoldersHistory>;
export function readDeleteRequest(raw: unknown): ReadOutcome<DeleteRequest>;
export function readDeleteResult(raw: unknown): ReadOutcome<DeleteResult>;
export function readOpenRequest(raw: unknown): ReadOutcome<OpenRequest>;
export function readActiveFoldersPush(raw: unknown): ReadOutcome<ActiveFoldersPush>;
// one writer per type: the same fields without interfaceVersion in, the same object with INTERFACE_VERSION first out
export function writeEnvelope(): Versioned;
export function writeActiveRemote(body: Omit<ActiveRemote, 'interfaceVersion'>): ActiveRemote;
// ... and writeHostnames, writeFoldersHistory, writeDeleteRequest, writeDeleteResult, writeOpenRequest, writeActiveFoldersPush
```

Rules. Every `read*` first checks the envelope: `raw` is a plain object (not null, not an array) whose
`interfaceVersion` is a plain object with `major` and `minor` that are non-negative integers; otherwise `foreign`.
A `major` other than 1 is `unknownMajor` (checked before any other field). Any `minor` is accepted. The value copies
only the known fields (unknown fields are dropped); an absent optional field stays absent (no `undefined`
property). A known field of the wrong type is `foreign` (provisional: the specification calls a result that does not
fit "a foreign payload"). Lists keep their order and their repeats. Strings are kept exactly (no trim, no case change).
A `write*` copies its fields and adds `interfaceVersion`; it validates nothing and omits absent optional fields.

## 3. Test table

`V1` = `{interfaceVersion:{major:1,minor:0}}`; a row "valid" compares the whole outcome with `deepStrictEqual`.

| Cite | Given | Expected |
|---|---|---|
| F-5902.5.rules | `readEnvelope(V1)`; `readEnvelope` of version `{major:1,minor:9}` plus an extra field `x` | valid with `V1`; valid, minor 9 kept, `x` dropped |
| F-5902.5.foreign | (each) `readEnvelope` of `undefined`, `null`, `'text'`, `[]`, `{}`, `{connected:false}`, version `{major:'1',minor:0}`, `{major:1}`, `{major:1.5,minor:0}`, `{major:-1,minor:0}`, version `null` | refused `foreign` |
| F-5902.5.foreign | (each) majors 0, 2, 99 with minor 0 on `readEnvelope`; major 2 on `readActiveRemote` with a malformed body | refused `unknownMajor` |
| F-5902.5.table | `readActiveRemote` of `connected:true, hostKey:'Build-Box'`; of `connected:true` with the hex key `7b22686f73744e616d65223a22616c706861222c2275736572223a226c6162227d` | valid, `Build-Box` (case kept); valid, key unchanged |
| F-5902.5.table | `readActiveRemote` of `connected:false`; of `connected:false, hostKey:'x'` | valid `{connected:false}` with no `hostKey` property in both (provisional for the second) |
| F-5902.5.table | (each) `readActiveRemote` of `connected:true` without `hostKey`; `connected:'yes'`; `hostKey:5` | refused `foreign` (provisional for the first) |
| F-5902.5.table | `readHostnames` of `['b','A','b']`; of `[]`; of `['a',5]`; with no `hostnames` | valid, order and repeats kept; valid, empty; refused `foreign`; refused `foreign` |
| F-5902.5.table | `readFoldersHistory` of `hosts:[{hostKey:'h1',entries:[{path:'/b',kind:'folder'},{path:'/w.code-workspace',kind:'workspace'},{path:'/b',kind:'folder'}]},{hostKey:'h2',entries:[]}]` | valid, identical to the input (order, repeats, both kinds) |
| F-5902.5.table | (each) `readFoldersHistory` with an entry of kind `'file'`; an entry that is the string `'/a'`; an entry without `path` | refused `foreign` |
| F-5104.BR-13 | `readDeleteRequest` of `hostKey:'h1', path:'/b'` and of a request without `path`; `readDeleteResult` of `changed:false` and of `changed:1` | valid; refused `foreign`; valid; refused `foreign` |
| F-5103.BR-1 | `readOpenRequest` of `hostKey:'Alias', window:'new'`; of `window:'current'`; of `window:'other'` | valid with no `path` and no `kind` property (twice); refused `foreign` |
| F-5104.BR-15 | `readOpenRequest` of `path:'/w/UP.CODE-WORKSPACE', kind:'folder', window:'new'`; of `path:'/w/a.code-workspace', kind:'workspace', window:'new'` | valid, both copied as given (the sender decides the kind) |
| F-5902.5.push | `readActiveFoldersPush` of `outcome:'failed', hostKey:'h'`; of `outcome:'none'` alone; of `outcome:'connected', hostKey:'h', folders:['/a','/b']`; of `outcome:'done'`; of `folders:[1]` | valid; valid (no `hostKey`, no `folders` property); valid; refused `foreign`; refused `foreign` |
| F-5902.5.rules | (each) every `write*` called with a full body, then its `read*` | valid and deep-equal to the written object; `interfaceVersion` is the first key |
| F-5902.5.rules | `writeEnvelope()`; `writeActiveRemote({connected:false})` | `V1`; `{interfaceVersion:{major:1,minor:0}, connected:false}` with no `hostKey` property |

15 rows (an (each) row counts once).

## 4. Rule for the worker

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included (`now` excepted); no `const` arrow helpers; comments only where the guide requires
them, none with a feature, rule or decision id (ids may appear in test names); table loops in tests, no duplicated
code (jscpd flags five-line clones). Coverage of `payloads.ts`: 100 % lines, branches and functions.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `lib-companion: payload codecs (task-companion-02)`. The description
answers R1 to R4 and R6, maps each cite to its test name (R5), and lists the section 6 rows hit.

## 6. Open rows (stop and report)

1. `packages/lib-companion` is not on main (card companion-01 unmerged). Stop before writing anything.
2. The value of `INTERFACE_VERSION` (the card says 1.0) and the field names above await the interface document.
3. A request with `path` but no `kind`, or `kind` but no `path`: valid or `foreign`? Not tested.
4. The same `hostKey` twice in one history: kept as two entries of `hosts` or merged? Not tested.
5. A `hostKey` or a path that is the empty string: valid or `foreign`? Not tested.
