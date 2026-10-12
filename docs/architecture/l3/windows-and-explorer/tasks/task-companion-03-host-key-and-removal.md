# Task card companion-03: the host-key rule and the history removal rule (pure)

Why: both companion and explorer need the one definition of the host key of an SSH window and of "Remove from Recent
List" (contracts.md section 4.3; F-3906 RR-2; F-5104 BR-3, BR-13). Reviewing coder: `remote-coding-worker-1`.
Depends on cards companion-01 and companion-02 (the type `HostHistory` in `src/payloads.ts`); if either is not
merged, stop (section 6, row 1). No `vscode` import.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-companion/src/host-key.ts` | new: `hostKeyOfAuthority`, `isConfiguredAlias` |
| `packages/lib-companion/src/history.ts` | new: `removeFolderCopies`, `RemovalOutcome` |
| `packages/lib-companion/test/unit/host-key.test.ts` | new |
| `packages/lib-companion/test/unit/history.test.ts` | new |
| `packages/lib-companion/src/index.ts` | add the export lines for the two modules (the only shared file) |

Nothing else may change. No fixtures.

## 2. Contract

```ts
import type {HostHistory} from './payloads.ts';

// host-key.ts
export function hostKeyOfAuthority(authority: string): string | undefined;
export function isConfiguredAlias(hostKey: string, aliases: readonly string[]): boolean;

// history.ts
export interface RemovalOutcome { hosts: HostHistory[]; changed: boolean }
export function removeFolderCopies(hosts: readonly HostHistory[], hostKey: string, path: string): RemovalOutcome;
```

`hostKeyOfAuthority`: when the authority starts with the exact text `ssh-remote+`, the host key is everything after
that first `+`, as written (case kept, nothing decoded or split, later `+` characters kept); for an alias the key is
the alias, and for a typed `user@host` it is the encoded form, which is the lower-case hex text. Any other text gives
`undefined` (a local, container, tunnel or virtual window has no host key).

`isConfiguredAlias`: true when some alias equals the key exactly, case included. The encoded form of a typed
`user@host` therefore matches no row.

`removeFolderCopies`: returns a new `hosts` list in which every entry whose `path` equals the given path exactly
(whatever its `kind`) is removed from the host whose `hostKey` equals the given key exactly, and from no other host.
Order of the hosts and of the remaining entries is kept; a host whose last entry is removed stays with `entries: []`.
`changed` is true exactly when at least one entry was removed. The input is never modified.

## 3. Test table

`ALIAS` = `{hostKey:'Alias', entries:[{path:'/b',kind:'folder'},{path:'/a',kind:'folder'},{path:'/b',kind:'folder'}]}`;
`OTHER` = `{hostKey:'other', entries:[{path:'/b',kind:'folder'}]}`.

| Cite | Given | Expected |
|---|---|---|
| F-3906.RR-2 | `hostKeyOfAuthority` of `ssh-remote+build-box`; of `ssh-remote+Build-Box` | `build-box`; `Build-Box` (case kept) |
| F-3906.RR-2 | `hostKeyOfAuthority` of `ssh-remote+7b22686f73744e616d65223a22616c706861222c2275736572223a226c6162227d` | that hex text, unchanged (not decoded) |
| F-3906.RR-2 | (each) `hostKeyOfAuthority` of `wsl+Ubuntu`, `dev-container+abc`, `tunnel+x`, `''`, `ssh-remote`, `SSH-REMOTE+x`, ` ssh-remote+x` | `undefined` |
| F-3906.RR-2 | `hostKeyOfAuthority('ssh-remote+a+b')` | `a+b` (provisional) |
| F-5103.BR-6 | `isConfiguredAlias('lab-box', ['lab-box','other'])`; `('Lab-Box', ['lab-box'])`; `('lab-box', [])` | true; false; false |
| F-3906.RR-2 | `isConfiguredAlias` of the hex key above with aliases `['alpha','lab']` | false |
| F-5104.BR-13 | `removeFolderCopies([ALIAS, OTHER], 'Alias', '/b')` | `hosts` `[{hostKey:'Alias', entries:[{path:'/a',kind:'folder'}]}, OTHER]`, `changed` true |
| F-5104.BR-3 | the same call | the other key's `/b` is still there; the order of `Alias`'s remaining entries is kept |
| F-5104.BR-13 | `removeFolderCopies` of a host holding `{path:'/x',kind:'folder'}` and `{path:'/x',kind:'workspace'}`, path `/x` | both removed (provisional) |
| F-5104.BR-13 | `removeFolderCopies([ALIAS], 'Alias', '/zzz')`; `([ALIAS, OTHER], 'missing', '/b')`; `([], 'Alias', '/b')` | `changed` false and `hosts` deep-equal to the input |
| F-5104.BR-13 | (each) `removeFolderCopies([ALIAS], 'alias', '/b')`; `([ALIAS], 'Alias', '/B')`; `([ALIAS], 'Alias', '/b/')` | `changed` false, nothing removed |
| F-5104.6.6 | `removeFolderCopies([{hostKey:'h',entries:[{path:'/only',kind:'folder'}]}], 'h', '/only')` | `[{hostKey:'h', entries:[]}]`, `changed` true |
| F-5104.BR-13 | `removeFolderCopies` called twice in a row on `[ALIAS, OTHER]` with `Alias`, `/b` (second call on the first result) | second `changed` false, same `hosts` as the first result |
| F-5104.BR-13 | input built with `Object.freeze` at every level, then any removal | no exception; the input deep-equals its snapshot afterwards |

14 rows (an (each) row counts once).

## 4. Rule for the worker

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included (`now` excepted); no `const` arrow helpers; comments only where the guide requires
them, none with a feature, rule or decision id (ids may appear in test names); no duplicated code. Coverage of the
two modules: 100 % lines, branches and functions.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `lib-companion: host key and history removal (task-companion-03)`. The
description answers R1 to R4 and R6, maps each cite to its test name (R5), and lists the section 6 rows hit.

## 6. Open rows (stop and report)

1. `src/payloads.ts` (card companion-02) is not on main. Stop before writing anything.
2. `ssh-remote+` with nothing after it: the key is `''` or `undefined`? Not tested.
3. The same `hostKey` twice in one `hosts` list: remove from both or the first only? Not tested.
4. A path that differs only in a trailing separator or in Windows spelling: the spec fixes exact equality only for the
   recorded string; whether a normalised match is wanted is open. Not tested beyond the exact rows above.

### Rulings on section 6 (architect, 2026-10-12, #290)

2. `ssh-remote+` with nothing after it gives `''`, as built: an empty key matches no configured alias (an alias is
   never empty) and no history host, so it is inert, and the codec already refuses such an authority before a window
   exists (F-2501).
3. The same `hostKey` twice in one `hosts` list: the path is removed from every host with that key, as built; history is
   keyed by host, so a duplicate is a malformed list, and removing from all of them never leaves a stale copy behind.
4. Exact equality only, as built: the spec fixes the recorded string, and a normalised match (`/a` against `/a/`, or a
   Windows spelling) could remove an entry the user did not pick on a remote whose path rules are not ours to assume.
