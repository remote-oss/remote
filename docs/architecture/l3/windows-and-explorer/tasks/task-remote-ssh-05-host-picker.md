# Task card remote-ssh-05: the host pick of "Kill VS Code Server on Host..." and "Uninstall VS Code Server from Host..."

Why: both maintenance commands open the host picker of the connect flows, then act on the picked host
(remote-oss/remote-ssh#56 F-2411, #57 F-2412). This card holds the pure decisions of the pick: the picker's fixed
options, and what a pick leads to. The text helpers (`hostPartOf`, `isOwnHost`, the two notices) belong to card
connect-10 and the own-host plans to card connect-11; this card repeats none of them. Neither command asks for a
confirmation (F-2411 BR-1, F-2412 BR-1), so there is no confirmation string. Reviewing coder:
`remote-coding-worker-1`. Depends on card remote-ssh-02 (`PickerItem`, `outcomeOfPick` in
`src/connect/picker-model.ts`) being merged; if that file is absent, stop (section 6, row 1). No `vscode` import.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/maintenance/host-picker.ts` | new (`src/maintenance/` holds no file of this card's on main) |
| `packages/remote-ssh/test/unit/maintenance-host-picker.test.ts` | new |

Nothing else may change (no `package.json`, no `coverage.json` except by `pnpm coverage:update`, no `src/index.ts`).
The picker's items are not rebuilt here: both commands use `pickerModel` of card remote-ssh-02 (the same list, typed
row and two fixed rows, F-2411 5.0 step 2, F-2412 5.0 step 2).

## 2. Contract

```ts
import type {SshTarget} from 'lib-ssh';
import type {PickerItem} from '../connect/picker-model.ts';

export const MAINTENANCE_PICKER_OPTIONS: {hasTitle: false; canSelectMany: false; hasBackButton: false; focusFirst: true};
export type MaintenanceStep = {proceed: {text: string; target: SshTarget}} | {stop: 'addHost' | 'configure'};
// Amended 2026-10-12 (#255): `proceed`, not `run`; a three-letter property fails the name rule, and D-74 allows no disable.
export function maintenanceStep(item: PickerItem): MaintenanceStep;
```

Rules. `maintenanceStep`: a `host` item gives `proceed` with `text` the item's `label` and `target` the target of
`outcomeOfPick`; a `typed` item gives `proceed` with `text` the item's `text` (never its label, which has the arrow
prefix) and the same `target`; `addHost` and `configure` give `{stop}` with the same word, because the command does
not continue after them. The text is not trimmed or changed, and nothing is validated here.

## 3. Test table

`ALPHA` = `{kind:'host', label:'alpha', keepVisible:false}`.

| Cite | Given | Expected |
|---|---|---|
| F-2411.5.0 | `MAINTENANCE_PICKER_OPTIONS` | deep-equal `{hasTitle:false, canSelectMany:false, hasBackButton:false, focusFirst:true}` |
| F-2412.5.0 | `maintenanceStep(ALPHA)` | `{proceed:{text:'alpha', target:{host:'alpha'}}}` |
| F-2412.5.0 | `maintenanceStep` of a `host` item labelled `Beta-Upper` | `{proceed:{text:'Beta-Upper', target:{host:'Beta-Upper'}}}` (case kept) |
| F-2411.6.3 | `maintenanceStep` of a `typed` item with label `➤ lab@203.0.113.6:2222` and text `lab@203.0.113.6:2222` | `{proceed:{text:'lab@203.0.113.6:2222', target:{host:'203.0.113.6', user:'lab', port:2222}}}` |
| F-2412.6.4 | `maintenanceStep` of a `typed` item with text `lab@alias.invalid` | `text` `lab@alias.invalid`, target `{host:'alias.invalid', user:'lab'}` |
| F-2411.6.3 | `maintenanceStep` of a `typed` item with text ` lab@x.invalid ` (spaces kept) | `text` ` lab@x.invalid ` unchanged; target from the same text |
| F-2411.6.3 | (each) `maintenanceStep` of typed items with text `-oProxyCommand=x`; `a b.invalid`; three spaces | `proceed` with the text as given, nothing refused |
| F-2411.6.4 | `maintenanceStep` of the `addHost` item (label `{id:'S167', values:['$(plus)']}`) | `{stop:'addHost'}` |
| F-2411.6.4 | `maintenanceStep` of the `configure` item (label `{id:'S024', values:[]}`) | `{stop:'configure'}` |
| F-2412.6.5 | the same two calls | `{stop:'addHost'}` and `{stop:'configure'}` |

10 rows (an (each) row counts once).

## 4. Rule for the worker

As card log-01; tests first, one `it` per row (per input for an (each) row), the name starting with the cite. Fix
only what fails or is missing; no signature or contract change; no behaviour for section 6. Names of four characters
or more, properties included (`now` excepted); no `const` arrow helpers; comments only where the guide requires
them, none with a feature, rule or decision id (ids may appear in test names); no duplicated code. Coverage of the
module: 100 % lines, branches and functions.
Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `remote-ssh: maintenance host pick (task-remote-ssh-05)`. The description
answers R1 to R4 and R6, maps each cite to its test name (R5), and lists the section 6 rows hit.

## 6. Open rows (stop and report)

1. Card remote-ssh-02's file `src/connect/picker-model.ts` is not on main. Stop before writing anything.
2. Whether the typed row appears when the typed text equals a configured alias (the spec says "text that matches no
   alias"): decided by `pickerModel` (card remote-ssh-02), not here. Not tested.
3. The own-host test, the host part of a typed target and the two notices are cards connect-10 and connect-11's. If a
   test here seems to need one, stop.
