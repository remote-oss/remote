# Task card explorer-02: the "connected" marker and its precedence (pure)

Why: the host row of the window's own SSH host reads "connected" with an icon, decided by the pull alone; the push
never marks (remote-oss/remote-explorer#14 F-5902 section 5 "Precedence"; #10 F-5103 BR-6). Reviewing coder:
`remote-coding-worker-1`. Depends on card explorer-01 (`HostRow`, `hostRowId` in `src/model/ssh-group.ts`) being
merged; if that file is absent, stop (section 6, row 1). No `vscode` import, no `lib-companion` import.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-explorer/src/model/connected-marker.ts` | new |
| `packages/remote-explorer/test/unit/connected-marker.test.ts` | new |

Nothing else may change (no `package.json`, no `coverage.json`, no `src/index.ts`).

## 2. Contract

```ts
import type {HostRow} from './ssh-group.ts';

export interface ActivePull { connected: boolean; hostKey?: string }     // the answer of the build's first call
export const CONNECTED_MARKER: {descriptionId: 'S003'; icon: 'vm-active'};
export function markedRowIds(rows: readonly HostRow[], pull: ActivePull | undefined): string[];
```

`pull` is `undefined` when the call failed, timed out or answered a foreign payload. `markedRowIds` returns the
`rowId` of the first row whose `alias` equals `pull.hostKey` exactly (case included) when `pull.connected` is true and
`hostKey` is present, and `[]` in every other case: at most one id. The function has two parameters: the push of
the companion is not an input, so it cannot mark. `CONNECTED_MARKER` is the description string id and the codicon
name (without the `codicon-` prefix) the view applies to a marked row.

## 3. Test table

`ROWS` = host rows built by hand for the aliases `build-box`, `F5103-Upper`, `plain`.

| Cite | Given | Expected |
|---|---|---|
| F-5103.BR-6 | `markedRowIds(ROWS, {connected:true, hostKey:'build-box'})` | `['ssh-host:build-box']` |
| F-5103.BR-6 | `markedRowIds(ROWS, {connected:true, hostKey:'F5103-Upper'})`; with `hostKey:'plain'` | `['ssh-host:F5103-Upper']`; `['ssh-host:plain']` (only that row) |
| F-5103.BR-6 | `markedRowIds(ROWS, {connected:true, hostKey:'f5103-upper'})` | `[]` (case is compared exactly) |
| F-5103.BR-6 | `markedRowIds(ROWS, {connected:true, hostKey:'127.0.0.1'})` | `[]` (a connected window whose alias names no row) |
| F-3906.RR-2 | `markedRowIds(ROWS, {connected:true, hostKey:'7b22686f73744e616d65223a22616c706861227d'})` | `[]` (the encoded form of a typed `user@host` matches no row) |
| F-5103.BR-6 | (each) `{connected:false}`; `{connected:false, hostKey:'build-box'}` | `[]` (a local window, or a window whose connection has not succeeded) |
| F-5902.5.precedence | `markedRowIds(ROWS, undefined)` | `[]` (a failed or foreign pull marks nothing, whatever a push said) |
| F-5902.5.precedence | `markedRowIds.length` | `2` (no parameter carries the push) |
| F-5103.BR-6 | `markedRowIds(ROWS, {connected:true})` | `[]` (provisional) |
| F-5103.BR-6 | `markedRowIds([], {connected:true, hostKey:'build-box'})` | `[]` |
| F-5103.BR-6 | rows `[build-box, build-box]` (same alias twice), pull connected on `build-box` | one id (provisional) |
| F-5103.BR-6 | the same call twice with the same arguments | equal results (no memory between builds) |
| F-5103.BR-6 | `CONNECTED_MARKER` | deep-equal `{descriptionId:'S003', icon:'vm-active'}` |

13 rows (an (each) row counts once).

## 4. Rule for the worker

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included (`now` excepted); no `const` arrow helpers; comments only where the guide requires
them, none with a feature, rule or decision id (ids may appear in test names); no duplicated code. Coverage of the
module: 100 % lines, branches and functions.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm check-licences`; `pnpm coverage` as card explorer-01 row 1 says.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `remote-explorer: connected marker (task-explorer-02)`. The description
answers R1 to R4 and R6, maps each cite to its test name (R5), and lists the section 6 rows hit.

## 6. Open rows (stop and report)

1. `src/model/ssh-group.ts` (card explorer-01) is not on main. Stop before writing anything.
2. A pull with `connected` true and an empty `hostKey` against a row with an empty alias: marked or not? Not tested.
3. The marker of the Tunnels group (the folder row under the active tunnel) is another card's.
