# Task card containers-35: C8's dialog has no added Cancel, and a failed window is titled `[Dev Container]`

Issue: #972. Milestone 0.4. Size: S. Builder: `task:claude`.

**Design:** athena's rulings (2) and (3) on #881 (comment 6181477796).

Sources: F-0410 (remote-oss/remote-containers#28) 5.0 steps 2 and 4; F-0504 (window identity); containers-11 (C8,
`surfaces/recovery-presenter.ts`); containers-08 (`connect/register-connector.ts`).

## 1. No core "Cancel"; Escape is More Actions... (ruling 2)

**The defect:** C8 passes its three labels as strings, so core adds a "Cancel" of its own to the modal, and Escape is
that Cancel. F-0410 5.0 step 2 gives exactly "Edit devcontainer.json Locally" | "More Actions..." | "Retry", with
Retry primary. Step 4 says Escape *is* More Actions....

**The change:**
- The presenter's `showError` port takes `MessageItem`-shaped buttons: `{title: string; isCloseAffordance?: boolean}`.
  The dialog's "More Actions..." button is `isCloseAffordance: true`, and the other two aren't.
- Order the items so that core makes Retry primary, and check it in the run: core makes the first
  non-close-affordance item primary. Write the measured DOM order into the PR.
- The `extension.ts` adapter passes the items to `window.showErrorMessage(message, {modal: true, detail}, ...items)`
  and maps the chosen item back to its label.
- The comment "Escape is the last button" goes. With the close affordance, Escape returns "More Actions...".

## 2. The unnamed label when the first resolve doesn't connect (ruling 3)

**The defect:** `register-connector.ts` registers the authority's label only when the first resolve settles
`connected`. A failed window then has no formatter, and core falls back to the scheme: `[vscode-remote]` and
"Disconnected from vscode-remote". F-0410 5.0 step 4 gives `<folder> [Dev Container]` and "Disconnected from Dev
Container".

**The change:**
- **lib-authority (`resolver/host.ts`):** the resolver handle gains `onResolveSettled(listener)`, fired after every
  resolve settles, the first and every later one. `onFirstResolveSettled` stays as it is.
- **`register-connector.ts`:** on every settle:
  - `connected`: dispose any label and register the named one, `workspaceSuffixOf(connector.heldIdentity(),
    translate)`, as today;
  - any other state, with no label yet: register `workspaceSuffixOf(undefined, translate)`, S118 "Dev Container" with
    no name.
- Core's title and its "Disconnected from {0}" both read the formatter.

## 3. Rows

### 3.1 Unit

- `recovery-presenter.test.ts`:
  - the three items, with "More Actions..." alone `isCloseAffordance`;
  - choosing the close affordance (`undefined` from the port, as Escape gives) opens the quick pick;
  - Retry reloads.
- The adapter: `showErrorMessage` gets `{modal: true, detail}` and the three items, and the chosen item maps back.
- `resolver-host.test.ts`: `onResolveSettled` fires once per settle, for the first and a later resolve, connected or
  not.
- `register-connector.test.ts`:
  - a first resolve that fails registers `Dev Container`;
  - a later connect replaces it with the named suffix and disposes the unnamed one;
  - a connected first resolve registers the named one only.

### 3.2 Acceptance (the `containers` launch, with containers-11's failing configuration)

| # | Rows |
|---|---|
| Buttons | a configuration whose `up` fails (containers-11's row, or containers-34's missing image): the dialog's buttons are exactly `Edit devcontainer.json Locally`, `More Actions...`, `Retry` (the set), with no `Cancel`. Escape (a key event on the dialog) opens the More Actions... quick pick |
| Title | after More Actions... (dismiss the pick), `windowTitle(name)` holds `[Dev Container]`, and `statusItem(name, 'status.host').text` reads `Disconnected from Dev Container` (F-0410 5.0 step 4, F-0504) |

containers-26's W12 and W13 already expect three buttons. If they're on main, they pass with this card.

## 4. Gates and review

Run all gates and the containers launch. PR title: `remote-containers, lib-authority: C8's dialog has no added
Cancel, and a failed window is titled [Dev Container] (card containers-35, #972)`. Request athena only.

**Open row (stop and report on #881):** core still adds a Cancel with a close-affordance item, or Retry isn't primary
in any item order.
