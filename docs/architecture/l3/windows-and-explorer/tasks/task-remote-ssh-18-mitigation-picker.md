# Task card remote-ssh-18: the "More Actions..." picker (F-2602)

Why: the failure dialog (card remote-ssh-07) calls `FailureActions.moreActions(failed)` on "More Actions..." and on
Escape, and nothing implements it. F-2602 makes it a static quick pick of five items (BR-1, BR-2: the content never
depends on the failure, the hints or any setting). Owner: B's `ssh.failure-ui` (windows-and-explorer components.md:
"the 'More Actions...' picker with F-2602 BR-2's fixed items (static …)"). This card is the pure part: the pick, its
strings, and the dispatch of the chosen item to an actions port. The editor adapters and the real actions are wired in
#140 E6c-3a (daedalus). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/mitigation-picker.ts` | new: the pick and `moreActionsOf` (section 2) |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | five ids in `FailureStringId` and `FAILURE_TEMPLATES` (section 2.1) |
| `packages/remote-ssh/src/surfaces/own-strings.ts` | one own id in `OWN_TEMPLATES` (section 2.1) |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | the six texts as keys, English as the value |
| `packages/remote-ssh/test/unit/mitigation-picker.test.ts` | new (section 3) |
| `packages/remote-ssh/test/unit/failure-strings.test.ts` | the id list row gains the five ids, in order |
| `packages/remote-ssh/test/unit/strings.test.ts` | the default-bundle row gains the six texts (a new `MITIGATION_TEXTS` list) |

Nothing else. No `vscode` import. `failure-presenter.ts` is unchanged: `moreActionsOf`'s result is assignable to
`FailureActions['moreActions']`.

## 2. Contract

```ts
import type {Translate} from './strings.ts';

/** What an item of the picker does. */
export type MitigationAction =
  | 'reloadWindow'
  | 'openRecent'
  | 'openDocumentation'
  | 'openConfigFile'
  | 'openSettings';

/** The picker as the editor shows it: a placeholder, and the items' labels in order, the first focused. */
export interface MitigationPick {
  placeholder: string;
  items: ReadonlyArray<{label: string; action: MitigationAction}>;
}

/** The picker in the display language: always the same five items (F-2602 BR-1, BR-2). */
export function mitigationPickOf(translate: Translate): MitigationPick;

/** What the picker needs of the editor. */
export interface MitigationPickPort {
  /**
   * Shows the pick: single selection, no title, no Back button, an empty value, the first item focused. Gives the
   * chosen item's action, or nothing when it closed without a choice.
   */
  pick(pick: MitigationPick): PromiseLike<MitigationAction | undefined>;
}

/** What each item does; each is the editor's or another feature's operation. */
export type MitigationActions = Readonly<
  Record<MitigationAction, () => PromiseLike<unknown>>
>;

/** "More Actions...": shows the pick and runs the chosen item's action; nothing when the pick closed without one. */
export function moreActionsOf(
  port: MitigationPickPort,
  actions: MitigationActions,
  translate: Translate,
): () => Promise<void>;
```

- `mitigationPickOf(translate)`: `placeholder` is S105 translated; `items`, in this order (F-2602 5.0 step 2, AC-2):

  | Label | `action` |
  |---|---|
  | own id `mitigationReloadWindow` | `reloadWindow` |
  | S102 | `openRecent` |
  | S100 | `openDocumentation` |
  | S103 | `openConfigFile` |
  | S104 | `openSettings` |

  Each label is its template translated (`textOfId(id, translate)` for an S id, `ownText({id, values: []},
  translate)` for the own one).
- `moreActionsOf(port, actions, translate)` returns a function that, on each call, builds a fresh
  `mitigationPickOf(translate)` (BR-4: it remembers nothing), awaits `port.pick(...)`, and with an action awaits
  `actions[action]()` once. With nothing chosen it calls no action (6.2: the dialog does not return). It takes no
  failure: the content is the same for every failure (BR-2). A rejection of the port or of an action propagates to the
  caller (the presenter already swallows what its buttons do).
- It writes nothing (BR-3).

### 2.1 Strings

| Id | Table | Text |
|---|---|---|
| S100 | `FAILURE_TEMPLATES` | `Open Documentation` |
| S102 | `FAILURE_TEMPLATES` | `Open Recent...` |
| S103 | `FAILURE_TEMPLATES` | `Open SSH Configuration File` |
| S104 | `FAILURE_TEMPLATES` | `Open Settings` |
| S105 | `FAILURE_TEMPLATES` | `Pick an action to help resolve the problem.` |
| `mitigationReloadWindow` | `OWN_TEMPLATES` | `Reload Window` |

The texts are F-2602 §3.3 and §3.4 as written (the three dots of S102 are three full stops). "Reload Window" has no STR
id in the spec (§3.3: "the label matches VS Code core's command title; the item is the extension's"), so it is our own
string-table entry, as the platform picker's placeholder is (the #141 brief's ruling 2). Insert the five ids into
`FailureStringId` and `FAILURE_TEMPLATES` in id order (S100–S105 between S097 and S107).

## 3. Test table

One assertion per `it`; the cite starts the name. The port is a fake that records each pick it was given and answers a
scripted action (or `undefined`); the actions are fakes that record their calls. `same` is the identity translator,
`marked` wraps a template in `<…>`.

| Cite | Given | Expected |
|---|---|---|
| F-2602 AC-1 | `mitigationPickOf(same).placeholder` | `Pick an action to help resolve the problem.` |
| F-2602 AC-2 | `mitigationPickOf(same).items` labels | `['Reload Window', 'Open Recent...', 'Open Documentation', 'Open SSH Configuration File', 'Open Settings']` |
| F-2602 AC-2 | `mitigationPickOf(same).items` actions | `['reloadWindow', 'openRecent', 'openDocumentation', 'openConfigFile', 'openSettings']` |
| R-29 | `mitigationPickOf(marked)` | the placeholder and every label are the marked templates (all six go through `translate`) |
| F-2602 5.0 step 4 | the port answers each action in turn (one `it` per action) | that action was called once, and no other |
| F-2602 AC-11 | the port answers `undefined` | no action was called |
| F-2602 BR-4 | two calls of the returned function | the port was given two picks, deep-equal, and not the same object |
| F-2602 BR-2 | the returned function, given to `failurePresenterOf` as `moreActions`, after two failures of different kinds (`unknown`, `timeout`) with "More Actions..." chosen | the port was given the same pick both times |
| contracts | the port rejects | the returned promise rejects with the same error |
| string tables | `FAILURE_TEMPLATES` keys | the existing row's list with S100, S102, S103, S104, S105 in id order |
| string tables | the default bundle | the existing row with the six texts added |
| string tables | the 14 locale bundles | the existing row (same keys, English values) passes |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the "More Actions..." picker (card remote-ssh-18, F-2602)`.

## 6. Open rows

None for this card. F-2602 Q2 (does the picker close on focus loss) is the editor adapter's, not the port's; it is asked
on the spec issue and the adapter is wired in E6c-3a.
