# Task card explorer-03b: Remote Explorer desktop activation (stand-down, proposed-API setup, command registration)

Issue: #630. Release 0.3 (#43), the explorer's slice 1 (brief `brief-remote-explorer.md`, "Slice 1", athena
2026-10-13). Why: the explorer has to activate the family's way before any view or row code can run:
- the stand-down guard first (remote-oss/remote-explorer#17 F-5001 §6.6, BR-10, BR-11; #7 F-5901 §5 "Coexistence"; R-54,
  R-77);
- then the proposed-API setup for `contribViewsRemote` (F-5101 §16, 7.E5; `contracts.md` §3.4);
- then the slice-1 commands, each safe out of context (#12 F-5002 §19).

This card also serves slice-1 gate rows 7 and 8 at unit level: a stand-in with the reference id stands the explorer
down; without the proposals nothing fails and the setup notice covers the explorer. The VSCodium rows come with the
explorer's coverage card.

Builder: iris or hestia: it touches remote-ssh and lib-authority. Size: about 2.5 agent-days. Depends on explorer-03a
(#629) merged. Design check: athena (section 2.1's lib-authority additions; section 2.4's warning text).

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-authority/src/gate/setup-ports.ts` | `GateIdentity` gains `viewIds: readonly string[]`; the probe passes `identity.viewIds` instead of `[]` |
| `packages/lib-authority/src/gate/family-setup.ts` | new: `familySetupPortsOf` (2.1) |
| `packages/lib-authority/src/index.ts` | exports `familySetupPortsOf` and `type FamilySetupOptions` |
| `packages/lib-authority/test/unit/gate-family-setup.test.ts` | new |
| `packages/lib-authority/test/unit/gate-setup-ports.test.ts` | its `GateIdentity` gets `viewIds: []`, plus the 2.1 row on `viewIds` |
| `packages/lib-product/src/profile.ts`, `src/index.ts` | `profileOf` (2.2) |
| `packages/lib-product/test/unit/profile.test.ts` | the 2.2 rows (the file exists; add to it) |
| `packages/remote-ssh/src/extension.ts` | uses `familySetupPortsOf` and `profileOf`, and drops its own `readArgvFile` and the `setupPortsOf(gateEditorOf(...))` block (2.3); `editorProfile` keeps its name and reads through `profileOf` |
| `packages/remote-explorer/src/activation.ts` | new (2.4) |
| `packages/remote-explorer/src/extension.ts` | new (2.5) |
| `packages/remote-explorer/test/unit/activation.test.ts` | new |
| `packages/remote-explorer/l10n/bundle.l10n.json` and the 14 `bundle.l10n.<locale>.json` | new (2.6) |
| `packages/remote-explorer/package.json` | adds `"main": "./dist/extension.js"` after `categories`, `"l10n": "./l10n"` after `enabledApiProposals`, and `dependencies` `lib-authority`, `lib-identifiers`, `lib-product`, `lib-standdown`, each `workspace:*` |
| `packages/remote-explorer/test/unit/manifest.test.ts` | 03a's top-level row gains `main` and `l10n` with these values |
| `packages/remote-explorer/tsconfig.json` | `references` to `../lib-authority`, `../lib-identifiers`, `../lib-product` and `../lib-standdown`, as remote-ssh's |
| `packages/remote-explorer/.vscodeignore` | new: `**`, `!package.json`, `!package.nls*.json`, `!l10n/**`, `!dist/extension.js` (one per line, as remote-ssh's) |
| `packages/remote-explorer/coverage.json` | `exclude` gains `"src/extension.ts": "loads the editor"` |
| `packages/remote-explorer/README.md` | "For maintainers": Components adds `explorer.package` activation (`src/activation.ts`, `src/extension.ts`); Allowed imports becomes `` `lib-authority`, `lib-identifiers`, `lib-product`, `lib-standdown`; `vscode` and `node:` modules in `src/extension.ts` only ``; Coverage exclusions becomes `` `src/extension.ts`: it loads the `vscode` module, which exists only in the extension host `` |
| `pnpm-lock.yaml` | as `pnpm install` writes it |

Nothing else may change. Remote - SSH's behaviour stays the same: its tests pass unchanged, except the one
`GateIdentity` literal of 2.1.

## 2. Contract

### 2.1 lib-authority: the family's setup over the editor

```ts
// setup-ports.ts: GateIdentity gains
  /** The ids of the remote views the extension contributes; their focus commands probe `contribViewsRemote`. */
  viewIds: readonly string[];
// and the probe call becomes probeProposals(editor.probeApi, {proposals: identity.proposals, viewIds: identity.viewIds}).

// family-setup.ts
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import type * as vscode from 'vscode';

/** What an extension of the family supplies to the shared setup. */
export interface FamilySetupOptions {
  displayName: string;
  proposals: readonly ProposalName[];
  viewIds: readonly string[];
  /** The extension's own English templates (`{0}` display name, `{1}` application name, `{2}` as SetupTexts says). */
  templates: SetupTexts;
  /** A template in the display language: the extension's `vscode.l10n.t`. */
  translate(template: string): string;
  /** The editor's data folder name, from its product.json; read only when the setup needs it. */
  dataFolderName(): PromiseLike<string>;
  logFailure(message: string): void;
}

export function familySetupPortsOf(
  editor: typeof vscode,
  context: Pick<vscode.ExtensionContext, 'globalState' | 'subscriptions' | 'extension'>,
  options: FamilySetupOptions,
): SetupPorts;
```

**Rules.** `familySetupPortsOf` returns `setupPortsOf(gateEditorOf(editor, context, readArgvFile), identity)`, where
`identity` is:

| Field | Value |
|---|---|
| `extensionId` | `context.extension.id` |
| `displayName`, `proposals`, `viewIds`, `logFailure` | from `options` |
| `applicationName` | `editor.env.appName` |
| `argv` | `{portableFolder: process.env.VSCODE_PORTABLE, homeFolder: homedir(), dataFolderName: options.dataFolderName}` |
| `platform` | `process.platform` |
| `texts` | each of the six `options.templates` passed through `options.translate` |

`readArgvFile` is the module's own unexported function, moved from remote-ssh's `extension.ts` unchanged: the file's
UTF-8 text, or `undefined` when reading throws.

### 2.2 lib-product: `profileOf`

```ts
/** The profile of a product.json text; throws when the text cannot be read as one. */
export function profileOf(productJsonText: string): ProductProfile;
```

It returns `readProfile(text).profile` for a readable text. For an unreadable one it throws
`new Error(`product.json cannot be read: ${reason}`)`, the message remote-ssh's `editorProfile` throws today.

### 2.3 remote-ssh: the same setup through the shared code

In `packages/remote-ssh/src/extension.ts`:
- **`gate`** becomes:

  ```ts
  logFailure => familySetupPortsOf(vscode, context, {
    displayName, proposals, viewIds: [], templates: SETUP_TEXT_TEMPLATES, translate, dataFolderName, logFailure,
  })
  ```

  with:
  - `displayName` and `proposals` as today;
  - `translate` the module's existing function;
  - `dataFolderName`: the existing `dataFolderNameOfEditor`, which stays.
- **`editorProfile`** becomes `profileOf(await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8'))`.
- **`readArgvFile`** goes.

`SETUP_TEXT_TEMPLATES` stays remote-ssh's own, with its published failed-attempt text (card remote-ssh-08).

### 2.4 remote-explorer: `src/activation.ts`

```ts
import {type CommandEntry, type CommandHandler, type CommandHost, registerCommands} from 'lib-identifiers';
import {standDownIfPresent, type StandDownHost} from 'lib-standdown';

/** The part of the identifier table activation uses. */
export interface ExplorerTable<Commands extends Readonly<Record<string, CommandEntry>>> {
  readonly commands: Commands;
  readonly standDown: {readonly standsDownFor: string; readonly contextKey: string};
}

export interface ExplorerActivationInputs<Commands extends Readonly<Record<string, CommandEntry>>> {
  table: ExplorerTable<Commands>;
  /** The coexistence warning and its button, in the user's language. */
  standDownTexts: {warning: string; button: string};
  standDown: StandDownHost;
  commands: CommandHost;
  handlers: {readonly [Name in keyof Commands]: CommandHandler};
  /** Runs the proposed-API setup; the activation waits for it before registering. */
  setup(): PromiseLike<unknown>;
}

export type ExplorerActivation = {kind: 'standing'} | {kind: 'serving'; dispose(): void};

export async function activateExplorer<Commands extends Readonly<Record<string, CommandEntry>>>(
  inputs: ExplorerActivationInputs<Commands>,
): Promise<ExplorerActivation>;

/** A handler per command that does nothing and returns undefined, whatever the argument. */
export function silentHandlers<Commands extends Readonly<Record<string, CommandEntry>>>(
  commands: Commands,
): {readonly [Name in keyof Commands]: CommandHandler};
```

**Rules:**
1. `standDownIfPresent(inputs.standDown, {standsDownFor, standingDownKey: contextKey, warning, button})` comes first.
   `standing` → resolve `{kind: 'standing'}`; `setup` isn't called and nothing is registered (F-5001 6.6 step 3,
   BR-10).
2. `serving` → `await inputs.setup()`. A rejection rejects the activation, and nothing is registered.
3. Then `registerCommands(inputs.commands, 'serving', table.commands, inputs.handlers)`. Resolve
   `{kind: 'serving', dispose}`, where `dispose` disposes that registration.
4. `silentHandlers` maps every name of `commands` to `{execute: () => undefined}`, one object per name, no
   `isAvailable`. That's F-5002 §19 items 1, 3 and 7: the command does nothing visible, and its promise resolves.

In slice 1 every handler is silent. explorer-04 (the targets view) replaces `refresh`. explorer-05 (connect actions and the marker)
replaces `connectToRemoteInCurrentWindow` and `connectToRemoteInNewWindow`, each with
`{...silentHandlers(commands), <name>: <handler>}` in `extension.ts`.

### 2.5 remote-explorer: `src/extension.ts` (the desktop entry, not unit-tested)

```ts
export async function activate(context: vscode.ExtensionContext): Promise<void>
```

1. It reads `manifest = context.extension.packageJSON` (`displayName`, `enabledApiProposals`, `contributes.commands`)
   and makes `host = identifierHost(vscode, manifest)`.
2. It runs `activateExplorer` with:

| Input | Value |
|---|---|
| `table` | `{commands, standDown}` from `./identifiers.generated.ts` |
| `standDownTexts` | `vscode.l10n.t` of the two strings of 2.6 |
| `standDown` | `standDownHost(vscode)` |
| `commands` | `host` |
| `handlers` | `silentHandlers(commands)` |
| `setup` | `() => runSetup(familySetupPortsOf(vscode, context, {...}), true)` |

   The `familySetupPortsOf` options are:
   - `displayName` from the manifest;
   - `proposals`: the manifest's `enabledApiProposals` (`[]` when absent);
   - `viewIds: [views.remoteTargets]`;
   - `templates`: the module's `SETUP_TEXT_TEMPLATES` (2.6);
   - `translate`: `template => vscode.l10n.t(template)`;
   - `dataFolderName`: `async () => profileOf(await readFile(path.join(vscode.env.appRoot, 'product.json'), 'utf8')).dataFolderName`;
   - `logFailure`: a function that does nothing. The explorer has no log (F-5901 §6, F-5001 BR-4).
3. On `serving`, it pushes `{dispose: () => { result.dispose(); }}` to `context.subscriptions`.

The setup's `interaction` isn't awaited (as in remote-ssh). The explorer holds no output channel, writes no state of
its own, and shows nothing at activation except the gate's own notices (F-5001 BR-4, POST-3). The gate's dismissal
flags appear only when a proposal is missing, and then the view doesn't exist (F-5101 7.E5).

### 2.6 Strings (`l10n/bundle.l10n.json`, keys equal to the English values; the 14 locale bundles the same, English)

| Constant in `extension.ts` | English text |
|---|---|
| `STAND_DOWN_WARNING` | Remote Explorer stays inactive in this window because another Remote Explorer extension is enabled. Both use the same commands, settings and views. Disable one of the two and reload the window. |
| `STAND_DOWN_BUTTON` | Show Remote Explorer Extension |
| `SETUP_TEXT_TEMPLATES.setup` | {0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}. |
| `SETUP_TEXT_TEMPLATES.failedAttempt` | The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists 'remote-oss.remote-explorer', then restart {1}. |
| `SETUP_TEXT_TEMPLATES.restart` | Quit and start {1} again to apply the changes to argv.json. |
| `SETUP_TEXT_TEMPLATES.configureButton` | Configure Runtime Arguments |
| `SETUP_TEXT_TEMPLATES.notNowButton` | Not Now |
| `SETUP_TEXT_TEMPLATES.quitButton` | Quit {1} |

**The coexistence warning** and its button are F-5001 3.4's text exactly, as republished on remote-oss/remote-explorer#17
(athena, 2026-10-13). The message names no extension id, so ADR-0008's public-surface rule holds without a deviation.
The button opens the Extensions view on `ms-vscode.remote-explorer` (lib-standdown's `revealExtension`, F-5001
AC-20).

**The setup templates** are remote-ssh's with the explorer's id in the failed-attempt text, as remote-ssh-08 publishes
its own.

## 3. Test table

The explorer's activation tests use fakes of `StandDownHost` and `CommandHost`, as remote-ssh's
`test/unit/activation.test.ts` does. They record events in order.

| Cite | Given | Expected |
|---|---|---|
| F-5001.BR-10 | the reference runs (`isRunning` true) | result `standing`; events exactly `context remote-explorer.standingDown=true`, `warning <STAND_DOWN_WARNING> <STAND_DOWN_BUTTON>`; `setup` never called; nothing registered |
| F-5001.6.6 | as above, and the fake warning answers the button | `revealExtension('ms-vscode.remote-explorer')` once |
| F-5001.BR-11 | the reference doesn't run | result `serving`; events in order: `context remote-explorer.standingDown=false`, `setup`, then one `register <id>` per command of the generated table, in table order |
| F-5001.BR-10 | `setup` rejects with `new Error('probe')` | the activation rejects with that error; nothing registered |
| F-5002.19.7 | (each) every registered callback, called with no argument, with `'bogus-f5002'` and with `{}` | returns `undefined`; nothing else recorded (no message shown) |
| F-5002.19.1 | `dispose` of the `serving` result | each registration disposed exactly once |
| F-5002.19.3 | `silentHandlers(commands)` | its keys equal the keys of `commands`; each `execute()` returns `undefined`; no `isAvailable` |
| contracts.3.4 | `familySetupPortsOf` over a fake editor (as `gate-vscode-setup.test.ts`), `getCommands` listing `remoteTargets.focus`, proposals `['contribViewsRemote']`, `viewIds: ['remoteTargets']` | `probe()` gives `[{proposal: 'contribViewsRemote', state: 'granted'}]`; without `remoteTargets.focus` in the list, `missing` |
| contracts.3.4 | the same with a `translate` that prefixes `T:` | a setup notice (missing proposal, no flags) shows `T:` followed by the filled setup template; the `extensionId` is the fake `context.extension.id`, and the application name is the fake `env.appName` |
| contracts.3.4 | `VSCODE_PORTABLE` set to a temporary folder holding `argv.json` with `"enable-proposed-api": ["remote-oss.remote-explorer"]`; then the folder without the file | `argvEnabled()` includes `remote-oss.remote-explorer`; then it is empty and `logFailure` was not called |
| contracts.3.4 | `setupPortsOf` with `viewIds: ['remoteTargets']` (in `gate-setup-ports.test.ts`) | the probe received those view ids |
| lib-product.profile | `profileOf` of a valid product.json text; of `'not json'` | the same profile as `readProfile`; throws an `Error` whose message starts `product.json cannot be read: ` |
| F-5001.AC-16 | `l10n/` | `bundle.l10n.json` and the 14 locale bundles exist with exactly the 8 keys of 2.6 (`pnpm check-string-tables` passes) |
| F-5001.AC-15 | the manifest (03a's row, extended) | `main` is `./dist/extension.js`, `l10n` is `./l10n` |

14 rows (an (each) row counts once). Every `it` name starts with its cite. remote-ssh's existing tests pass unchanged.
`process.env.VSCODE_PORTABLE` is restored after its row.

Also run, with output in the PR: `pnpm build`, then `pnpm package remote-explorer`. A VSIX is written, and
`vsce ls` lists only the files of the `.vscodeignore`.

## 4. Rule for the builder

Tests first. Fix only what fails or is missing; no other signature or contract change. Names of four characters or
more, properties included. No `const` arrow helpers. Comments only where the guide requires them, none with a feature,
rule or decision id (ids may appear in test names). No duplicated code: after the move, jscpd must find no clone
between the two `extension.ts` files. Coverage of the changed files is 100 % lines, branches and functions, and
`extension.ts` is excluded.

Gates: `pnpm install`, `pnpm identifiers`, `pnpm check-identifiers`, `pnpm check-string-tables`,
`pnpm check-public-surface`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`, `pnpm build`.

Then run remote-ssh's acceptance launch, `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium`, and paste its
summary. remote-ssh's gate now runs through the shared code, and nothing may change.

## 5. Review

PR title `remote-explorer: desktop activation with the stand-down guard and the proposed-API setup (card explorer-03b,
#630)`. themis or triton reviews; athena gives the design check. The description answers R1–R6 and maps each cite to
its test name.

## 6. Open rows (stop and report on #630)

1. **`extensionsAny`** is declared but has no probe (`probe.ts` gives `unprobeable`). Its silent same-host fallback is
   companion-05's detector, not the setup. No notice ever names it.
2. **`remote-internal.setActiveFolders`** is declared as the activation event but not registered until increment 2. A
   keybinding on it before then gets core's "not found" warning; F-5001 AC-11 is `deferred`
   (`explorer slice 1: increment 2`).
