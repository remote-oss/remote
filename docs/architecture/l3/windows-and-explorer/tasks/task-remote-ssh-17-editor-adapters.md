# Task card remote-ssh-17: the editor adapters of the connect's surfaces (#140 E6c-3b)

Why: #140 part E (E6c-3, split on #253 Q12's thread: 3a is daedalus's wiring, 3b these adapters). The connect's
surfaces are built as pure models over ports, and every port has its rules in its JSDoc, but four ports have no editor
adapter yet: the login questions' pick and masked input, the failure dialog, the licence modal, and the platform pick.
This card is those four, each a small function over a given editor (the pattern of `login-terminal.ts` and
`lib-authority`'s `vscode-resolver.ts`: `vscode` imported as a type only, the editor passed in as a value), so each is
unit-tested with a fake editor. Reviewing coder: `remote-coding-worker-1`.

Depends on connect-21 (#371: `PromptEditor.showWaiting` leaves the port). Start after it is merged, or build the three
others first and the prompt editor after it.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/editor-adapters.ts` | new: the four adapters (section 2) |
| `packages/remote-ssh/test/unit/editor-adapters.test.ts` | new, over a fake editor (section 3) |

Nothing else. Nothing calls them yet; E6c-3a's `extension.ts` passes them `vscode`.

## 2. Contract

```ts
import type * as vscode from 'vscode';

type Editor = Pick<typeof vscode, 'window'>;

export function promptEditorOf(editor: Editor, translate: Translate): PromptEditor;
export function failureDialogOf(editor: Editor): FailureDialogPort;
export function licenceDialogOf(editor: Editor): LicenceDialogPort;
export function platformPickPortOf(editor: Editor, translate: Translate): PlatformPickPort;
```

(Each takes only `window`. Every call below was typechecked against `@types/vscode` 1.138: `createQuickPick`,
`createInputBox` with `password` and `ignoreFocusOut`, and modal messages with `isCloseAffordance` items.)

### 2.1 `promptEditorOf` (F-2305, F-2306)

- **`pick(request, cancellation)`:** a quick pick via `editor.window.createQuickPick()`, `title` = `request.title` (none
  when absent), `placeholder`, items = `request.items` labels in order with the first focused (`activeItems`), single
  selection, **`ignoreFocusOut: false`** (F-2305 BR-5: the fingerprint and continuation picks close when they lose
  focus, counted as a cancel). It resolves the chosen item's `answer`, or `undefined` when it is hidden without a choice
  (Escape, focus loss) or `cancellation` aborts (which hides it). Disposed after.
- **`maskedInput(request, cancellation)`:** `editor.window.createInputBox()` with `password: true`, `placeholder`, no
  title, **`ignoreFocusOut: true`** (F-2305 5.0 step 3, F-2306 6.x: the box stays open when the focus moves). It resolves
  the typed value on accept, or `undefined` on hide without accept or on `cancellation`. Disposed after.
- `translate` is passed through as the port's `translate`.
- (No `showWaiting`: connect-21 removes it.)

### 2.2 `failureDialogOf` (F-2601)

`showError(text, buttons)` is `editor.window.showErrorMessage(text, {modal: true}, ...items)`, the items built from
`buttons` in order, and the **last** one marked `isCloseAffordance: true`: F-2601 makes "More Actions..." the cancel
item, and the presenter passes it last. It resolves the chosen item's title, or `undefined`. (VS Code adds its own
Cancel to a modal only when no item is the close affordance (`[oss]`
`src/vs/workbench/api/browser/mainThreadMessageService.ts`), so marking the last one avoids a second Cancel.)

### 2.3 `licenceDialogOf` (F-3902 rule 11)

`showModal(message, detail, buttons)` is `editor.window.showWarningMessage(message, {modal: true, detail},
...items)`, the items from `buttons` in order, the **last** marked `isCloseAffordance: true` (the modal's "Cancel":
without the mark VS Code would add a second Cancel, as in 2.2). It resolves the chosen title, or `undefined`.

### 2.4 `platformPickPortOf` (F-2206)

`pick(pick, cancellation)` shows `pick` (card remote-ssh-13's `PlatformPick`) as a quick pick: the placeholder is
`ownText(pick.placeholder, translate)` (card remote-ssh-15's `own-strings.ts`), items `pick.items` labels in order, the
first focused, single selection, no title, `ignoreFocusOut: false` (it closes when the user looks away, F-2206 5.2).
It resolves the chosen item's `platform`, or `undefined` on hide or `cancellation`.

## 3. Test table

One assertion per `it`; the cite starts the name. The fake editor records each created quick pick or input box (its
properties and `show`/`hide`/`dispose` calls) and lets a test fire `onDidAccept`, `onDidHide` and set
`selectedItems`/`value`; `showErrorMessage`/`showWarningMessage` record their arguments and resolve a scripted item.

| Cite | Given | Expected |
|---|---|---|
| F-2305 BR-5 | `pick` | the quick pick has `ignoreFocusOut` false |
| F-2305 | `pick` with title, placeholder and two items | those shown, items in order, the first active |
| F-2305 BR-4 | the user accepts the second item | resolves its `answer` |
| F-2305 BR-5 | hidden without a choice | resolves `undefined` |
| contracts | `cancellation` aborts | the pick is hidden and resolves `undefined` |
| contracts | after any answer | the pick was disposed |
| F-2306 | `maskedInput` | the input box has `password` true and `ignoreFocusOut` true |
| F-2306 | the user accepts `secret` | resolves `secret` |
| F-2306 | hidden without accept | resolves `undefined` |
| contracts | `cancellation` aborts | hidden, `undefined`, disposed |
| F-2601 | `showError('t', ['Close Remote', 'Retry', 'More Actions...'])` | `showErrorMessage('t', {modal: true}, …)`, the third item `isCloseAffordance` true, the others not |
| F-2601 | the editor resolves the Retry item | resolves `'Retry'` |
| F-2601 BR-1 | the editor resolves `undefined` (Escape) | resolves `undefined` |
| F-3902 rule 11 | `showModal('m', 'd', ['Accept and Continue', 'Cancel'])` | `showWarningMessage('m', {modal: true, detail: 'd'}, …)`, `Cancel` the close affordance |
| F-2206 5.2 | `platformPickPortOf(...).pick(platformPickOf('box'), signal)` | the placeholder is `Select the platform of the remote host "box"`; items `Linux`, `Windows`, `macOS` in order |
| F-2206 | the user accepts `Windows` | resolves `'windows'` |
| F-2206 AC-9 | hidden without a choice | resolves `undefined` |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: the editor adapters of the connect's surfaces (card remote-ssh-17, #140 E6c-3b)`.

## 6. Open rows

None.
