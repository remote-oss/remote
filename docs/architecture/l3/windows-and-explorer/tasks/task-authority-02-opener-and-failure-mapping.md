# Task card authority-02: window-opener arguments and the failure mapping (pure)

Contract: `../contracts.md` §3.2 (the failure mapping order) and §3.3 (opener semantics). Depends on authority-01.
Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/opener/arguments.ts`, `src/resolver/failure-mapping.ts`, `src/index.ts` (exports only), tests
`test/unit/opener-arguments.test.ts`, `test/unit/failure-mapping.test.ts`. No `vscode` import: these are pure
functions whose results the (later, Claude-built) host and opener hand to the editor.

## 2. Contract

```ts
export type PathKind = 'folder' | 'workspace';
export type OpenTarget = 'current' | 'new';
export type OpenCommand =
  | { command: 'vscode.openFolder'; uri: { scheme: 'vscode-remote'; authority: string; path: string }; options: { forceNewWindow: boolean; forceReuseWindow: boolean } }
  | { command: 'vscode.newWindow'; options: { remoteAuthority?: string; reuseWindow: boolean } }
  | { command: 'vscode.openFolder'; uri: { scheme: 'file'; path: string }; options: { forceNewWindow: boolean; forceReuseWindow: boolean } };
export function openRemoteCommand(authority: string, path: string | undefined, pathKind: PathKind, target: OpenTarget): OpenCommand;
// path given → vscode.openFolder with the vscode-remote uri (pathKind 'workspace' uses the same command; the uri path is the .code-workspace file); target 'current' → forceReuseWindow true, forceNewWindow false; 'new' → forceNewWindow true, forceReuseWindow false
// no path → vscode.newWindow with remoteAuthority; reuseWindow = (target === 'current')
export function openLocalCommand(path: string | undefined, pathKind: PathKind, target: OpenTarget): OpenCommand;   // file scheme; no path → { command: 'vscode.newWindow', options: { reuseWindow: target === 'current' } } with no remoteAuthority (a local empty window; ruled 2026-10-08)
export type FailedLike = { kind: string; retryable: boolean; isReconnection: boolean; silent: boolean; userAlreadyNotified: boolean };
export type ResolverOutcome = { kind: 'temporarilyNotAvailable' } | { kind: 'notAvailable'; handled: boolean } | { kind: 'presenter' };
export function mapFailure(failed: FailedLike): ResolverOutcome;
// order, first match wins: retryable → temporarilyNotAvailable; isReconnection → notAvailable(handled false); silent → notAvailable(handled false); userAlreadyNotified → notAvailable(handled true); otherwise → presenter (the host then awaits the presenter's outcome)
```

## 3. Test table

| Given | Expected |
|---|---|
| `openRemoteCommand('ssh-remote+h', '/home/u/p', 'folder', 'current')` | openFolder, uri `{vscode-remote, 'ssh-remote+h', '/home/u/p'}`, `{forceNewWindow:false, forceReuseWindow:true}` |
| same with target `new` | `{forceNewWindow:true, forceReuseWindow:false}` |
| `pathKind 'workspace'`, path `/p/a.code-workspace` | openFolder with that uri path (same command) |
| no path, `current` | `vscode.newWindow`, `{remoteAuthority:'ssh-remote+h', reuseWindow:true}` |
| no path, `new` | `{remoteAuthority, reuseWindow:false}` |
| `openLocalCommand('/p', 'folder', 'new')` | openFolder, uri `{file, '/p'}`, `{forceNewWindow:true, forceReuseWindow:false}` |
| `openLocalCommand(undefined, 'folder', 'new')` | `vscode.newWindow`, `{reuseWindow:false}`, no remoteAuthority |
| `openLocalCommand(undefined, 'folder', 'current')` | `vscode.newWindow`, `{reuseWindow:true}` |
| `mapFailure({retryable:true, isReconnection:true, silent:true, userAlreadyNotified:true})` | `temporarilyNotAvailable` (retryable first) |
| `{retryable:false, isReconnection:true, silent:true, userAlreadyNotified:true}` | `notAvailable handled false` |
| `{…, isReconnection:false, silent:true, userAlreadyNotified:true}` | `notAvailable handled false` |
| `{…, silent:false, userAlreadyNotified:true}` | `notAvailable handled true` |
| all false | `presenter` |
| `kind` is never read | a test passes an unknown kind string and gets the same results |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-authority: opener arguments and failure mapping (card authority-02)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected.
