# Task card server-04: V3 install planner (pure)

Brief: `../brief-lib-server.md`. Contract: `../contracts.md` §5 V3 and §5.0 (`downloadPlacement`). Depends on
server-01 (#84) merged. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

Files: `src/install/plan.ts`, `src/index.ts` (exports only), test `test/unit/plan.test.ts`. Nothing else.

## 2. Contract

```ts
export interface HostFacts { operatingSystem: 'linux' | 'darwin' | 'windows' | 'alpine'; architecture: string; homeFolder: string; existingLayouts: readonly ExistingLayout[] }
export type ExistingLayout = { kind: 'bin'; commit: string; path: string } | { kind: 'cliServers'; commit: string; path: string };
export interface PlanInput {
  facts: HostFacts; commit: string; serverDataFolderName: string; launcher: string;
  installPathSetting: string | undefined;     // remote.SSH.serverInstallPath for this host, already looked up
  placement: DownloadPlacement; useExecServerSetting: boolean;
  source: { kind: 'resolved'; address: string } | { kind: 'noSource' } | { kind: 'invalidOverride'; problem: string };
}
export type Plan =
  | { kind: 'reuse'; layout: ExistingLayout; dataFolder: string; launcher: string; lockPlace: string; notes: readonly PlanNote[] }
  | { kind: 'download'; where: 'host' | 'client'; clientFallback: boolean; address: string; installFolder: string; dataFolder: string; launcher: string; lockPlace: string; notes: readonly PlanNote[] };
export type PlanFailure = { kind: 'noSource' } | { kind: 'invalidOverride'; problem: string } | { kind: 'invalidInstallPath'; reason: 'relative' | 'empty' | 'containsNewline' };
export type PlanNote = 'useExecServerIgnored';
export function plan(input: PlanInput): { plan: Plan } | { failure: PlanFailure };
```

Rules (from V3): the install path is checked first: an empty-after-trim setting, a relative path (not starting with
`/`, `~`, or a Windows drive `X:`), or one containing `\n` is `invalidInstallPath`; `~` and `~/x` expand with
`facts.homeFolder`; the data folder is `<installPath or home>/<serverDataFolderName>`; `lockPlace` is
`<dataFolder>/install.lock`; reuse is decided before the source: a `bin` layout with the same commit, else a
`cliServers` layout with the same commit (F-3902 rule 10), gives `reuse`; only then the source is read: `noSource` →
failure, `invalidOverride` → failure; `where`: `hostFirst` → `host` with `clientFallback` = (mode === 'auto'),
`hostFirst` mode `always` → `client` with `clientFallback` false, mode `off` → `host` false; `clientFirstThenHost` →
`client` with `clientFallback` true; `clientOnly` → `client` false; `installFolder` = `<dataFolder>/bin/<commit>`;
`useExecServerSetting` true adds the note `useExecServerIgnored` (the caller logs it once per connect); the launcher is
passed through.

## 3. Test table

| Given | Expected |
|---|---|
| `installPathSetting: '   '` | failure `invalidInstallPath` reason `empty` |
| `installPathSetting: 'rel/path'` | `invalidInstallPath` `relative` |
| `installPathSetting: '/a\nb'` | `invalidInstallPath` `containsNewline` |
| `installPathSetting: 'C:\\srv'`, windows | valid; dataFolder `C:\srv/<name>` (join with `/` on every platform; note it) — if the reviewer prefers `\\` on Windows, stop and report |
| `installPathSetting: undefined`, home `/home/u`, name `.vscode-server` | dataFolder `/home/u/.vscode-server` |
| `installPathSetting: '~/srv'` | dataFolder `/home/u/srv/.vscode-server` |
| `installPathSetting: '~'` | `/home/u/.vscode-server` |
| existing `bin` layout with the plan's commit, source `noSource` | `reuse` of that layout (reuse before source) |
| existing `cliServers` layout with the commit, no `bin` | `reuse` of the cliServers layout |
| existing `bin` layout with another commit, source resolved | `download` |
| both layouts with the commit | `reuse` the `bin` one |
| no layout, `noSource` | failure `noSource` |
| no layout, `invalidOverride {problem:'notHttpUrl'}` | failure `invalidOverride` with the problem |
| `hostFirst auto`, resolved | `download`, `where 'host'`, `clientFallback true` |
| `hostFirst always` | `where 'client'`, `clientFallback false` |
| `hostFirst off` | `where 'host'`, `clientFallback false` |
| `clientFirstThenHost` | `where 'client'`, `clientFallback true` |
| `clientOnly` | `where 'client'`, `clientFallback false` |
| `installFolder` for commit `abc`, dataFolder `/home/u/.vscode-server` | `/home/u/.vscode-server/bin/abc` |
| `lockPlace` | `/home/u/.vscode-server/install.lock` |
| `useExecServerSetting: true` | `notes` contains `useExecServerIgnored` (download and reuse alike) |
| `useExecServerSetting: false` | `notes` empty |
| `address` | copied from the resolved source |
| the invalid path case with a reusable layout present | failure `invalidInstallPath` (path check first) |

## 4. Rule for the worker

As card log-01.

## 5. Gates and review

PR title `lib-server: install planner (card server-04)`. Reviewer: `remote-coding-worker-1`.

## 6. Open rows (stop and report)

The Windows path-join row above.
