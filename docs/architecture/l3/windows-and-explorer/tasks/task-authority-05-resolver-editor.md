# Task card authority-05: the resolver host's editor adapter (#140 part A)

Why: `registerResolver` (lib-authority, `src/resolver/host.ts`, on main) runs over the `ResolverEditor` port; nothing
implements it over the editor yet (`../contracts.md` §3.2; `../brief-lib-authority.md` "Adapters": one adapter module
over `vscode` per piece, a recording adapter under `src/testing/`). Part A of the #140 plan. Implementer: `daedalus`.
Reviewers: `themis`; design check `athena`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-authority/src/resolver/vscode-resolver.ts` | new: `resolverEditorOf`, the only file of the resolver host that touches `vscode` |
| `packages/lib-authority/src/resolver/progress-message.ts` | new, pure: the phase message with the details link |
| `packages/lib-authority/src/testing/recording-resolver-editor.ts` | new: a recording `ResolverEditor` for the extensions' tests |
| `packages/lib-authority/src/index.ts` | export lines |
| `packages/lib-authority/test/unit/resolver-vscode.test.ts`, `resolver-progress-message.test.ts`, `recording-resolver-editor.test.ts` | new |

`package.json` is unchanged (the `./testing/*` entry covers the new file). Nothing outside lib-authority.

## 2. Contract

```ts
export interface ResolverEditorOptions {
  /** The command the progress's "(details)" link runs; registered by the extension, never contributed. */
  detailsCommand: string;
}
export function resolverEditorOf(editor: typeof vscode, options: ResolverEditorOptions): ResolverEditor;
```

- `registerRemoteAuthorityResolver(prefix, resolver)` registers with `editor.workspace.registerRemoteAuthorityResolver`
  an object whose `resolve` maps the host's `ResolvedConnection` to core's result:
  `new editor.ResolvedAuthority(host, port, connectionToken)` with `extensionHostEnv`, `environmentTunnels`,
  `tunnelFeatures` and, only when present, `isTrusted` assigned onto it. Its `tunnelFactory` is a **getter** that
  reads `resolver.tunnelFactory` on every access (the host replaces the factory at every connect; a copy taken at
  registration would stay `undefined`). The getter sits on the **resolver object** passed to
  `registerRemoteAuthorityResolver`, not on the `ResolvedAuthority`: core reads `resolver.tunnelFactory` after each
  `resolve()` returns ([oss] `extHostExtensionService.ts`, `setTunnelFactory(resolver, …)`), while `tunnelFeatures` is
  read from the result (clarified by athena 2026-10-12). Translating lib-forwarding's factory into core's shape is part D's.
- `notAvailable(message, handled)` is `editor.RemoteAuthorityResolverError.NotAvailable(message, handled)`;
  `temporarilyNotAvailable(message)` is `…TemporarilyNotAvailable(message)`.
- `progress.withProgress(request, task)` runs `editor.window.withProgress` at `ProgressLocation.Notification` with
  the request's `title` and `cancellable`; a cancellation of core's token calls `request.onCancel` once. The task's
  `update(text)` reports `{message: phaseMessage(text, first, options.detailsCommand)}` (below), where `first` is true
  for the first update of the run only.
- `windowId()` is `editor.env.sessionId`; `windowWorkspace()` is the first workspace folder's URI as a string, or
  `editor.workspace.workspaceFile`'s when it is set, or `undefined`.
- `reloadWindow()` runs `workbench.action.reloadWindow`; `closeRemote()` runs `workbench.action.remote.close`.

`phaseMessage(text: string, withLink: boolean, command: string): string`:
`([details](command:${command})) ${text}` when `withLink`, else `text` (F-2304 §3.3: the literal, unlocalised word
"details" in parentheses before the first phase's message; no link on later phases).

The recording `ResolverEditor` keeps every call in order and lets a test settle a resolve and fire a cancel.

## 3. Test table

| Cite | Given | Expected |
|---|---|---|
| F-2304 §3.3 | `phaseMessage('Initializing VS Code Server', true, 'opensshremotes.showDetails')` | `([details](command:opensshremotes.showDetails)) Initializing VS Code Server` |
| F-2304 §3.3 | the same with `withLink` false | `Initializing VS Code Server` |
| contracts §3.2 | a resolve with `isTrusted` absent | core's result has no `isTrusted` key |
| contracts §3.2 | a resolve with `isTrusted: true` | `isTrusted` true on the result |
| contracts §3.2 | the factory set after registration, read through core's resolver | the new factory (getter, not a copy) |
| contracts §3.2 | two updates in one run | the first message has the link, the second has none |
| contracts §3.2 | core's token cancelled | `onCancel` called once |
| contracts §3.2 | `notAvailable('x', true)` | `NotAvailable('x', true)` of the fake editor |
| contracts §3.2 | `windowWorkspace()` with a workspace file / one folder / none | the file's URI / the folder's URI / `undefined` |

The `vscode` parts are tested against a fake `typeof vscode` built in the test (only the members used); the module
imports `vscode` for types only, as `vscode-setup.ts` does.

## 4. Rule for the worker

As card log-01; coverage at lib-authority's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-authority: the resolver host's editor adapter (card authority-05, #140 part A)`; Part of #140.

## 6. Open rows

- The command id passed as `detailsCommand` and its declaration in `identifiers.json` are part E's (athena, #253 Q4).
