# Task card containers-28: F-0411's two settings, passed to the CLI

Issue: #967. Milestone 0.4. Size: M. Builder: `task:claude`.

**Scope question for athena (card PR):** brief-release-1's F-0411 row names "the git-root mount at
`/workspaces/<basename>`, `workspaceMount`/`workspaceFolder`", and leaves out Compose, the OS legs and remote
engines. These two settings aren't named either way, and their criteria (F-0411 AC-8, 9, 10, 14, 19, 28, 35–38) are
`todo` in the cut. This card builds them. If they're out, they're deferred instead and this card closes.

Sources: F-0411 (remote-oss/remote-containers#33) 3.2, 6.6, 6.7, 6.11, 7.E5, BR-7, BR-11, BR-12; F-0102 (#88) 3.2
(the legacy key's shape); ADR-0009 rule 2 (mechanism 1: the CLI's own flags). Pinned CLI 0.89.0: `up`,
`read-configuration` and `run-user-commands` accept `--mount-git-worktree-common-dir`, and `up` accepts
`--workspace-mount-consistency <consistent|cached|delegated>` (default `cached`).

## 1. The change

### 1.1 The settings (`package.json`, nls, `identifiers.json`)

- `dev.containers.workspaceMountConsistency`: `type: "string"`, `default: "cached"`, `scope: "application"`, `enum:
  ["consistent", "cached", "delegated"]`, `enumDescriptions` and `description` verbatim from F-0411 3.2.
- `dev.containers.experimentalMountGitWorktreeCommonDir`: `type: "boolean"`, `default: false`, `scope:
  "application"`, `description` verbatim from 3.2.
- `remote.containers.workspaceMountConsistency`: F-0102 3.2's legacy shape, exactly `scope: "application"`,
  `deprecationMessage` `Use 'dev.containers.workspaceMountConsistency' instead.` and `markdownDeprecationMessage`
  ``Use `#dev.containers.workspaceMountConsistency#` instead.``, and nothing else.
- `identifiers.json` `settingPairs` gains `{current: "dev.containers.workspaceMountConsistency", legacy:
  "remote.containers.workspaceMountConsistency", winner: "current"}`.

### 1.2 The values (`src/connect/mount-settings.ts`, new, pure)

```ts
/** BR-7: the user's dev.containers value if it's a string, else the legacy key's if that's a string, else 'cached'. A string outside the enum goes as written (7.E5). */
export function workspaceMountConsistencyOf(current: unknown, legacy: unknown): string;
/** 3.2: true for the boolean true and for the string "true" (AC-37); false for anything else. */
export function mountGitWorktreeCommonDirOf(value: unknown): boolean;
```

Both read the **user (global) values** (`inspect(...).globalValue`), since both keys are `application`-scoped, as
`defaultExtensions` is read. They're read at every connect and every rebuild, never cached (BR-7, BR-11).

### 1.3 The CLI (C3, `src/cli/cli-arguments.ts`)

- `CliTarget` gains `mountGitWorktreeCommonDir: boolean`. `commonArguments` adds `--mount-git-worktree-common-dir`
  right after the git-root flag's place when it's true, so `up`, `read-configuration` and `run-user-commands` all
  see the same layout.
- `UpOptions` gains `workspaceMountConsistency: string`. `upArguments` adds `--workspace-mount-consistency <value>`
  after `--skip-non-blocking-commands`.

### 1.4 The callers

Every `CliTarget` and `UpOptions` literal gets the settings' values. `tsc` lists them:
- C10 `connector.ts`: `settings()` gains `workspaceMountConsistency`, `legacyWorkspaceMountConsistency` and
  `mountGitWorktreeCommonDir`, read in `extension.ts`. `cliTargetOf` takes the worktree flag, which also covers the
  canonical read (containers-22) and the post-`prepare` read. The `ContainerRequest` C10 hands C7 gains both values;
- C7 `container-lifecycle.ts` `prepare`: its target and `UpOptions` take them from the request;
- C4 `choose-configuration.ts`: `ConfigurationRequest` gains `mountGitWorktreeCommonDir`, which `reopen.ts` passes
  from the settings port. The window then opens at the path the worktree setting gives (AC-35).

A value outside the enum reaches the CLI, which refuses it, and `up`'s failure goes through containers-11's F-0410
dialog as S034 (AC-38). No code of ours checks the enum.

## 2. Rows

### 2.1 Unit

- `mount-settings.test.ts`:
  - `workspaceMountConsistencyOf`: the current key wins; the legacy key when the current is unset; `cached` for
    neither; `fast` as written; a non-string current key falls back;
  - `mountGitWorktreeCommonDirOf`: `true`, `"true"`, `false`, `"false"`, `undefined`, `1`.
- `cli-arguments.test.ts`: the flag in all three subcommands when true and in none when false; the consistency in
  `up` only, with its value as written.
- `connector.test.ts`, `container-lifecycle.test.ts` and `choose-configuration.test.ts`: the values reach each
  target, and settings changed between two connects take the new values (BR-7).
- The manifest test: the three settings' shapes, exactly.

### 2.2 Acceptance (the `containers` launch, with the helpers of containers-26)

| # | Rows |
|---|---|
| M1, AC-14 | no setting set, a sibling worktree with a relative gitdir: one `/workspaces/` mount, no `.git` mount |
| M2, AC-9 | the setting `false`: only the worktree is mounted, at `/workspaces/<worktree-basename>` |
| M3, AC-10, AC-37 | the setting `true`, then `"true"` written in `settings.json`: a second bind of the main repository's `.git` at `/workspaces/<main-basename>/.git`. The Git item clause is checked only if the run's image has `git`; it doesn't, so say so in the PR and leave that clause to a later row |
| M4, AC-28 | the non-sibling layout `x1/deep/main` and `x1/wt-rel/wt`: the mounts at `/workspaces/wt-rel/wt` and `/workspaces/deep/main/.git`; the window opens at `/workspaces/wt-rel/wt` |
| M5, AC-35 | AC-28's container made with the setting off, then the setting on and Reopen without a rebuild: the same id, the same mounts, and core's "Workspace does not exist" dialog for `/workspaces/wt-rel/wt` |
| M6, AC-36 | a sibling worktree whose gitdir names an entry the main repository no longer has: both mounts, and the window connects |
| M7, AC-8 | each of `cached`, `consistent` and `delegated`, rebuilt after each change: the workspace mount in `docker inspect`'s `HostConfig.Mounts` has no `Consistency` |
| M8, AC-19 | a `workspaceMount` with `consistency=delegated` and the setting `consistent`: the mount says `delegated`, also after a rebuild with the setting changed |
| M9, AC-38 | the setting `fast`: no container, and S034's dialog with its three buttons |

**Worktrees with relative paths:** use `git worktree add --relative-paths` (git 2.48 or later). If the runner's `git`
is older, stop at open row 2. Don't write the gitdir files by hand.

## 3. Gates, review and open rows

Run all gates, the containers launch and the VSCodium run. PR title: `remote-containers: F-0411's two settings,
passed to the CLI (card containers-28, #967)`. Request athena only.

**Open rows (stop and report on #967):**
1. The CLI writes the consistency into `HostConfig.Mounts` on Linux (M7 fails).
2. The runner's `git` has no `--relative-paths`.
3. M5's window opens at the old path (the read didn't get the flag).
