# Task card explorer-03c: the Remote Explorer web entry point

Issue: #631. Release 0.3 (#43), the explorer's slice 1 (F-5001 is in slice 1). Why: the package has a `main` and a
`browser` entry (remote-oss/remote-explorer#7 F-5901 §5 "Package properties"; #17 F-5001 3.3, AC-15). In a web editor
the view shows no "SSH" group and nothing fails (#14 F-5902 §5 "When a companion is absent", web editor; AC-25).

Builder: selene if she's free, otherwise iris. Size: about 1 agent-day. Depends on explorer-03b (#630) merged.

## 1. Package and file boundary

| File | Change |
|---|---|
| `tools/build.ts` | a package with `src/web-extension.ts` also gets `dist/web/extension.js` (2.1) |
| `tools/build.test.ts` | the 2.1 rows |
| `packages/remote-explorer/src/window-activation.ts` | new: `activateInWindow` (2.2), moved out of `src/extension.ts` |
| `packages/remote-explorer/src/extension.ts` | keeps only `activate`, which calls `activateInWindow` with the desktop setup (2.3) |
| `packages/remote-explorer/src/web-extension.ts` | new: `activate`, which calls `activateInWindow` with no setup (2.3) |
| `packages/remote-explorer/test/unit/window-activation.test.ts` | new |
| `packages/remote-explorer/package.json` | `"browser": "./dist/web/extension.js"` right after `main` |
| `packages/remote-explorer/test/unit/manifest.test.ts` | the top-level row gains `browser` |
| `packages/remote-explorer/.vscodeignore` | adds the line `!dist/web/extension.js` |
| `packages/remote-explorer/coverage.json` | `exclude` gains `"src/web-extension.ts": "loads the editor"` |
| `packages/remote-explorer/README.md` | "For maintainers": Allowed imports adds `src/web-extension.ts` (`vscode` only, no `node:` module, no `lib-authority`, no `lib-product`); Coverage exclusions names both entries |

Nothing else may change.

## 2. Contract

### 2.1 Build tool

After the `main` bundle, when `<package>/src/web-extension.ts` exists, `buildPackages` runs esbuild once more with:
- `entryPoints: [that file]`;
- `outfile: <package>/dist/web/extension.js`;
- `bundle: true`, `platform: 'browser'`, `format: 'cjs'`, `target: 'es2022'`;
- `external: ['vscode']`, `sourcemap: true`, `logLevel: 'warning'`.

It then pushes the outcome line `<folder>: dist/web/extension.js`. A package without that file is unchanged. The file
overview's usage text gains one sentence: "A package's `src/web-extension.ts` is bundled for the web extension host
into `dist/web/extension.js`; nothing in it may import a `node:` module."

### 2.2 `src/window-activation.ts`

```ts
import type * as vscode from 'vscode';

/** The part of the editor API the window's activation uses; the entry passes the real `vscode` module. */
export type WindowEditor = Pick<typeof vscode, 'commands' | 'window' | 'workspace' | 'l10n' | 'extensions'>;

/**
 * Activates the explorer in this window: the stand-down guard, `setup`, then the commands. On `serving` the end of
 * the registration is added to `context.subscriptions`.
 */
export async function activateInWindow(
  editor: WindowEditor,
  context: Pick<vscode.ExtensionContext, 'subscriptions' | 'extension'>,
  setup: () => PromiseLike<unknown>,
): Promise<void>;
```

This is 03b's `extension.ts` body without the setup's construction. It keeps the stand-down strings (`STAND_DOWN_WARNING`,
`STAND_DOWN_BUTTON`), `identifierHost(editor, manifest)`, `standDownHost(editor)`, `silentHandlers(commands)`, and the
push to `context.subscriptions`. It imports only `lib-identifiers`, `lib-standdown`, `./activation.ts` and
`./identifiers.generated.ts`, plus the type of `vscode`.

### 2.3 The two entries

- **`extension.ts`:** `activate(context)` returns
  `activateInWindow(vscode, context, () => runSetup(familySetupPortsOf(vscode, context, {...}), true))`. The options
  are exactly 03b's. `SETUP_TEXT_TEMPLATES` and the node reads stay here.
- **`web-extension.ts`:** `activate(context)` returns `activateInWindow(vscode, context, () => Promise.resolve())`. A
  web editor has no runtime-arguments file to set up: its proposals come from the hosting product's configuration
  (F-5902 §5 "When a companion is absent", web editor). It imports `vscode` and `./window-activation.ts` only.

## 3. Test table

| Cite | Given | Expected |
|---|---|---|
| F-5001.AC-15 | a temporary workspace (as `build.test.ts`) whose `remote-a` has `src/extension.ts` and `src/web-extension.ts` | the outcomes are `remote-a: dist/extension.js` then `remote-a: dist/web/extension.js`; the web bundle exists and requires `vscode` |
| F-5001.AC-15 | `remote-a`'s `web-extension.ts` imports `node:fs` | `buildPackages` rejects (esbuild can't resolve a `node:` module for the browser) |
| F-5001.AC-15 | a package without `web-extension.ts` | the outcomes are unchanged from today's rows |
| F-5001.BR-10 | `activateInWindow` over a fake editor whose `extensions.getExtension('ms-vscode.remote-explorer')` is an extension object | the warning shows 03b's text and button; `setup` isn't called; nothing is registered; `context.subscriptions` is unchanged |
| F-5001.BR-11 | the fake without the reference | `setContext` sets `remote-explorer.standingDown` to false, then `setup` runs, then the three commands are registered; `context.subscriptions` gained one entry, and disposing it disposes the three registrations |
| F-5902.AC-25 | `setup` is `() => Promise.resolve()` (the web entry's) | as the previous row: the commands are registered and nothing is shown |
| F-5001.AC-15 | the manifest | `browser` is `./dist/web/extension.js` |

7 rows. Every `it` name starts with its cite. Also run `pnpm build` and `pnpm package remote-explorer`, and paste the
output. `vsce ls` lists `dist/web/extension.js`.

## 4. Rule for the builder

Tests first. Fix only what fails or is missing; no other signature or contract change. Names of four characters or
more, properties included. No `const` arrow helpers. Comments only where the guide requires them, none with a feature,
rule or decision id. No duplicated code: the two entries share everything through `activateInWindow`. Coverage of the
changed files is 100 % lines, branches and functions, and both entries are excluded.

Gates: `pnpm identifiers`, `pnpm check-string-tables`, `pnpm check-public-surface`, `pnpm check-layout`,
`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`,
`pnpm check-licences`, `pnpm build`.

## 5. Review

PR title `remote-explorer: the web entry point (card explorer-03c, #631)`. themis or triton reviews; athena gives the
design check.

## 6. Open rows (stop and report on #631)

1. **The fake editor.** If `identifierHost` or `standDownHost` needs editor members beyond `WindowEditor`'s five, widen
   the `Pick` to what they need, and say so in the PR. Don't change those libraries.
2. **No web acceptance run.** The harness has no web editor launch, so F-5902 AC-25 and AC-35 stay unit-level here.
   A web launch is a tooling question for proteus, not this card's.
