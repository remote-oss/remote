# Task card containers-14: the four rebuild commands, through the rebuild intent

Issue: #884. Milestone 0.4, increment 1b. Gate row 5 (brief-release-1 §5). Size: M. Builder: `task:claude`.

Sources (the two parallel cards are containers-12's PR #889 and containers-13's PR #890):
- F-0405 (remote-oss/remote-containers#24): 3.1, 5.0 to 5.3, 6.12, BR-1 to BR-3, BR-9, BR-17, BR-19 to BR-21, and
  AC-1, AC-4 to AC-6, AC-8, AC-13, AC-25, AC-26, AC-29 to AC-33;
- `contracts.md` §3, the rebuild intent;
- `components.md` §2 boundary 5: C6 removes nothing; it reloads with an intent, and C7 removes and recreates inside the
  resolve;
- containers-06 (C7, `prepare`), containers-07 (Reopen's flow and §6's key), containers-08 (C10), containers-12
  (`ensureTrusted`, #882) and containers-13 (C4, #883).

**Build after** containers-06, 07, 08, 12 and 13 are on main. This card changes their modules; it doesn't restate
them.

## 1. What release 1 builds

| Command | Window | What it does |
|---|---|---|
| `remote-containers.rebuildContainer` | a dev-container window | stores an intent `{removeExistingContainer: true, buildNoCache: false}` for the window's payload, and reloads the window |
| `remote-containers.rebuildContainerNoCache` | the same | the same, with `buildNoCache: true` |
| `remote-containers.rebuildAndReopenInContainer` | a local window with one `file` folder | Reopen in Container's flow, with the intent stored right before the reload |
| `remote-containers.rebuildNoCacheAndReopenInContainer` | the same | the same, with `buildNoCache: true` |

**Left out of release 1:**
- the remote-indicator entry's neighbours, and the Dev Containers view and details surfaces (6.2, 6.3): there are no
  views in release 1;
- the configuration-change notification's "Rebuild" (6.1, owned by F-0303);
- F-0410's "Rebuild Container" item (6.9; C8's More Actions... list in containers-11 doesn't carry it in release 1);
- Compose (AC-21), attach (AC-22), the WSL, SSH and tunnel windows (AC-14, AC-15, AC-18), multi-root (AC-20), and
  Windows (AC-27, AC-28);
- "Use Template" after S113 (AC-32's second half, authoring is increment 2; C4 shows S113 with Cancel only).

## 2. The measured CLI behaviour this card relies on

Measured on the pinned `@devcontainers/cli` 0.89.0 (`packages/remote-containers/node_modules`), Docker 29:
1. **Removal first (BR-17).** A Dockerfile folder was brought `up`; then its Dockerfile was changed to `RUN exit 3`,
   and `up --remove-existing-container` was run. The result was `{"outcome":"error","message":"Command failed: docker
   buildx build …"}`, and **no container with the folder's labels remained**. So the CLI removes the old container
   before it builds, as BR-17 and AC-25 observe. C7 needs no `docker rm` of its own.
2. **A rebuild is a new container, and `postCreateCommand` runs again.** An image folder was brought `up`, then
   `up --remove-existing-container`. The container id changed, and the `postCreateCommand` marker was written again.
3. **No container source: checked before anything is removed** (AC-31's preferred order, decision F-0405 E8). With
   `{"name":"rb"}` as the whole configuration, `up --remove-existing-container` answered `{"outcome":"error","message":
   "Dev container config (…) …"}`, and **the existing container was still there with its id**.

The builder re-measures 1 and 3 in the PR with the same steps (§6 row 2).

## 3. The design

### 3.1 The intent store (`src/open/rebuild-intent.ts`, pure over a port)

Contracts §3 and containers-07 §6 fix the key and the shape:

```ts
/** The extension's own key in `globalState` (R-27); never synced. */
export const REBUILD_INTENTS_KEY = 'remote-oss.remote-containers.rebuildIntents';
/** An intent older than this is cleared unused, so a rebuild never fires on a later, ordinary open (contracts §3). */
export const REBUILD_INTENT_MILLISECONDS = 5 * 60 * 1000;
export interface RebuildOptions { buildNoCache: boolean; }
export interface RebuildIntent { at: number; removeExistingContainer: true; buildNoCache: boolean; }
/** `ExtensionContext.globalState`, narrowed. */
export interface IntentMemento { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void>; }

export async function storeRebuildIntent(memento: IntentMemento, payload: string, options: RebuildOptions, now: number): Promise<void>;
export async function takeRebuildIntent(memento: IntentMemento, payload: string, now: number): Promise<RebuildIntent | undefined>;
```

- **Reading the map:** `memento.get(REBUILD_INTENTS_KEY)`. Anything that isn't a plain object counts as `{}`. Each
  entry is kept only when it's an object with a finite number `at`, `removeExistingContainer === true` and a boolean
  `buildNoCache`; other entries are dropped. Both functions also drop every entry whose `now - at` is greater than
  `REBUILD_INTENT_MILLISECONDS`, or is negative, which means a clock that went back.
- **`storeRebuildIntent`** sets `map[payload] = {at: now, removeExistingContainer: true, buildNoCache}` on the cleaned
  map, and awaits `update`.
- **`takeRebuildIntent`** reads the entry for `payload` from the cleaned map, deletes it, and awaits `update` with
  the rest. It then returns the entry, or `undefined` when there was none or it was stale. It calls `update` only
  when the map changed.
- A failed `update` rejects to the caller (§3.2 and §3.4 handle it).
- The key isn't registered with `setKeysForSync` (R-27: our key, not synced).

### 3.2 The in-container pair (`src/open/rebuild.ts`, C6)

```ts
export interface RebuildPorts {
  window: {
    remoteName(): string | undefined;          // vscode.env.remoteName
    remoteAuthority(): string | undefined;     // vscode.env.remoteAuthority
    reload(): PromiseLike<unknown>;            // executeCommand('workbench.action.reloadWindow')
  };
  intents: IntentMemento;                      // context.globalState
  now(): number;                               // Date.now
  logger: Logger;
}
export function rebuildContainer(ports: RebuildPorts, options: RebuildOptions): Promise<void>;
```

In order:
1. **Context (BR-20, AC-29):** act only when `remoteName()` is `'dev-container'` and `remoteAuthority()` starts with
   `dev-container+`. Otherwise log at info `Rebuild Container does nothing in this window` and return. Nothing is
   shown, built, removed or written.
2. **The payload** is `remoteAuthority()` without its `dev-container+` prefix. It's the key C10 reads (§3.4), whatever
   the payload's kind (`folder` or `legacy`). BR-19: the current window's container, always.
3. `await storeRebuildIntent(ports.intents, payload, options, ports.now())`. If it rejects, log at warn
   `the rebuild intent could not be stored: <message>` and return without a reload. The container is untouched.
4. Log at info `rebuilding the dev container (no cache: <true|false>)`, then `await ports.window.reload()`.

- **No confirmation, and no trust prompt** (BR-2: the trust gate is the and-reopen pair's).
- **No configuration check:** the CLI checks the container source before it removes anything (§2 item 3). So
  AC-31's preferred outcome holds with no window-side check: S034 from C8, and the old container kept.
- **The folder** is the one the window has open, since the reload keeps the window's URI. That's BR-21's reference
  behaviour, accepted by decision F-0405 Q-1. AC-33's preferred outcome (reopen the folder from the current
  configuration) is out of release 1 and is noted in the catalogue.
- **Re-entry:** a second call while one is in flight returns at once with an info log line, as Reopen does.

### 3.3 The and-reopen pair (`src/open/reopen.ts`, C6)

Reopen's handler, as containers-07, 12 and 13 leave it, takes one more argument:

```ts
export function reopenInContainer(ports: ReopenPorts, rebuild?: RebuildOptions): Promise<void>;
```

- **Every step is Reopen's**, in Reopen's order:
  - the re-entry flag, shared, so a Reopen and a rebuild-and-reopen never run at once in one window;
  - the context check;
  - `ensureTrusted(served.trust, {translate, logger, setupAgain, commandTitle})` (containers-12, #889; AC-23, with S265
    as the body). `commandTitle` is the running command's title, and the flow goes on only on `'trusted'`;
  - the first engine check (containers-03; AC-26's local half);
  - `chooseConfiguration({folder, dockerPath, cancellation}, ports)` (containers-13, #890). Only `{kind: 'chosen',
    configFile, workspaceFolder}` goes on. Every other kind returns, as Reopen does: AC-13's no-configuration half,
    AC-32's S113 and the CLI failures come from there. The chosen `workspaceFolder` is resolved from the current
    configuration, which is BR-21's rule for the and-reopen pair;
  - the context;
  - the payload.
- **One step is added, between the payload (containers-07 §4.2 step 9) and the reload (step 10):** when `rebuild` is
  given, `await storeRebuildIntent(ports.intents, payload, rebuild, ports.now())`. If that rejects, log at warn as in
  §3.2 and return with no reload.
- `ReopenPorts` gains `intents: IntentMemento` and `now(): number`.
- **The log names the command:** every log line Reopen writes that names "Reopen in Container" names "Rebuild and
  Reopen in Container" when `rebuild` is given. Make the command's name an argument of the internal flow, not a second
  copy of the strings.
- **A folder with a configuration and no container** (AC-13's second half) needs nothing more: C7's `up` with
  `--remove-existing-container` finds nothing to remove and creates the container.

### 3.4 The container side (C10 and C7)

1. **C10 (`connector.ts`, containers-08 §3.2):** at step 3, before it calls C7, and only on the resolve's first
   attempt (`input.attempt === 1` and not `isReconnection`):

   ```ts
   const rebuild = await takeRebuildIntent(dependencies.intents, input.rawHostString, dependencies.now());
   ```

   - `dependencies` gains `intents: IntentMemento` and `now(): number`, wired in `register-connector.ts` to
     `context.globalState` and `Date.now`.
   - A rejected `take` is logged at warn, `the rebuild intent could not be read: <message>`, and the connect goes on
     as an ordinary open.
   - A reconnection never takes it, so a reconnection never rebuilds (F-0502: it reuses the running container).
   - When `rebuild` is defined, log at info `the window asked for a rebuild (no cache: <true|false>)`.
   - **Contracts §3 wording:** §3 says "C7 reads it once at the start of the resolve and clears it". Here C10 reads it
     and hands it to C7 in the request, so C7 stays free of editor state. athena checks this in the card PR (§6 row 1).
2. **C7 (`container-lifecycle.ts`, containers-06 §3.3):**
   - `ContainerRequest` gains `rebuild?: {buildNoCache: boolean}`.
   - **Step 1, discovery:** it runs as now, for the log and for `created`. With `rebuild` set, `unusable` isn't
     returned: a paused, restarting or dead container is what a rebuild replaces, so the flow goes on to `up`.
     `discoveryFailed` still returns as it is.
   - **Step 2:** `cli.up(target, {removeExistingContainer: rebuild !== undefined, buildNoCache: rebuild?.buildNoCache
     ?? false}, …)`.
   - **The log:** with `rebuild` set, log at info before `up`: `rebuilding: the dev container CLI removes <the
     discovered ids, 12 characters each, comma-separated, or "no container"> first`.
   - **Step 4:** `created` is true, as the id is new. The "a different id was used" warn line isn't written when
     `rebuild` is set.
3. **Failures after the removal** (a failed build, no Docker CLI, a cancel) are C3's `CliFailure`s, presented by C8
   (containers-11) as for any open: AC-25's S034 with Edit, More Actions... and Retry, and AC-26's S339. Retry
   reloads, and with no intent stored any more, it's an ordinary open, which creates the container. That's F-0405
   7.E2's "the folder has no container until a later build succeeds".

### 3.5 The contribution (F-0405 3.1, D-14)

Four commands, category `Dev Containers`, with the titles of F-0405 3.1:
- `remote-containers.rebuildContainer`: `Rebuild Container`;
- `remote-containers.rebuildContainerNoCache`: `Rebuild Container Without Cache`;
- `remote-containers.rebuildAndReopenInContainer`: `Rebuild and Reopen in Container`;
- `remote-containers.rebuildNoCacheAndReopenInContainer`: `Rebuild Without Cache and Reopen in Container`.

They have no icon in release 1: the `tools.svg` icon only shows in the view menus, which release 1 doesn't contribute.

**`commandPalette` entries**, with the `when` clauses of F-0405 3.1 verbatim, local clauses only, plus the family's
guard:
- the in-container pair: `!hideRebuildCommands && remoteName =~ /^dev-container$/ && !remote-containers:standingDown`;
- the and-reopen pair: `!hideRebuildCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace &&
  !remote-containers:standingDown`.

**`statusBar/remoteIndicator`:** `remote-containers.rebuildContainer` only, group
`remote_30_dev-container_2_actions@5`, with the in-container `when`. The no-cache variant is absent there (AC-2).

**`hideRebuildCommands`:** as containers-07 did for `hideConnectCommands`.
- Add it to `identifiers.json`'s `contextKeys` with `"setter": "extension"`.
- Add a tooling-31 allowlist entry: kind `contextKeys`, key `hideRebuildCommands`, card `#884`, slice `containers
  release 1`, decision `F-0405 3.2 (2026-09-27): defined, never set`.

**`extension.ts`:** the `handlers` factory returns the four handlers:
- the in-container pair over `rebuildContainer(ports, {buildNoCache})`;
- the and-reopen pair over `reopenInContainer(ports, {buildNoCache})`.

## 4. Files

All under `packages/remote-containers/`:

| File | What |
|---|---|
| `src/open/rebuild-intent.ts` | new, pure over `IntentMemento` (§3.1) |
| `src/open/rebuild.ts` | new, the in-container pair (§3.2) |
| `src/open/reopen.ts`, `src/open/reopen-ports.ts` | the `rebuild` argument and the two ports (§3.3) |
| `src/connector/connector.ts`, `src/connector/register-connector.ts` | §3.4 item 1 (containers-08's paths, whatever they are on main) |
| `src/lifecycle/container-lifecycle.ts` | §3.4 item 2 |
| `identifiers.json`, `package.json`, `package.nls*.json`, `src/identifiers.generated.ts`, `src/extension.ts` | §3.5 |
| `tools/unconsumed-allowlist.json` (repository root) | the `hideRebuildCommands` entry |
| the tests of §5 | |

## 5. Rows

### 5.1 `rebuild-intent.test.ts` (pure, a memento fake that records `update`)

| Name | Given | Expected |
|---|---|---|
| `contracts §3: a stored intent is taken once` | store `p` at 1000 with no cache; take `p` at 2000; take again | `{at: 1000, removeExistingContainer: true, buildNoCache: true}`, then `undefined`; the map is `{}` after the first take |
| `contracts §3: an intent older than five minutes is cleared unused` | store at 0; take at 300001 | `undefined`; the map is `{}` |
| `contracts §3: an intent exactly five minutes old is still taken` | store at 0; take at 300000 | the entry |
| `contracts §3: a clock that went back drops the entry` | store at 5000; take at 4000 | `undefined` |
| `contracts §3: taking one payload keeps the others` | store `a` and `b`; take `a` | the map keeps `b` |
| `contracts §3: storing drops stale entries of other payloads` | an entry for `old` at 0, then store `new` at 400000 | the map has only `new` |
| `contracts §3: a malformed store counts as empty` | `get` gives `'x'`, then `[]`, then `{p: {at: 'n'}}` | take gives `undefined`, and `update` writes `{}` |
| `contracts §3: nothing to take writes nothing` | an empty map | no `update` |
| `contracts §3: a failed update rejects to the caller` | `update` rejects | `store` and `take` reject |

### 5.2 `rebuild.test.ts` (ports faked)

| Name | Given | Expected |
|---|---|---|
| `F-0405 AC-4, BR-2: Rebuild Container stores the intent and reloads, with no prompt` | `dev-container`, authority `dev-container+abc` | the intent for `abc` with `buildNoCache: false`; one `reload`; nothing shown |
| `F-0405 5.1: the no-cache variant stores buildNoCache` | the same, `{buildNoCache: true}` | `buildNoCache: true` |
| `F-0405 AC-29, BR-20: in a local window it does nothing` | `remoteName` `undefined` | no `update`, no `reload`; one info line |
| `F-0405 BR-20: in another remote window it does nothing` | `ssh-remote` | the same |
| `F-0405 BR-17: an intent that can't be stored means no reload` | `update` rejects | no `reload`; one warn line |
| `F-0405 BR-19: the window's own payload is the key` | authority `dev-container+7b7d` | the key `7b7d` |
| `contracts: a second call while one runs returns at once` | a pending `reload`, then a second call | one `update` |

### 5.3 `reopen.test.ts`, added rows

| Name | Expected |
|---|---|
| `F-0405 AC-8: Rebuild and Reopen stores the intent for the payload, then reloads` | the `update` comes before `openRemote`, and the key equals the payload `openRemote` uses |
| `F-0405 AC-23: an untrusted folder answered with Cancel stores nothing` | `ensureTrusted` gives `declined`: no `update`, no `openRemote` |
| `F-0405 AC-26: a failed first engine check stores nothing` | `firstCheck` gives `stopped`: no `update` |
| `F-0405 AC-32: a configuration C4 rejects stores nothing` | `chooseConfiguration` gives `rejected`, then `noConfiguration`, then `dismissed`: no `update` each time |
| `F-0405 AC-30, BR-20: in a dev-container window it does nothing` | `remoteName` `dev-container`: no `update`, no `openRemote` |
| `contracts: Reopen in Container stores no intent` | no `rebuild`: no `update` |
| `contracts: a Rebuild and Reopen while a Reopen runs returns at once` | one flow runs |
| `F-0405 BR-17: an intent that can't be stored means no reload` | `update` rejects: no `openRemote`; one warn line |

### 5.4 `connector.test.ts` and `container-lifecycle.test.ts`, added rows

| Name | Expected |
|---|---|
| `contracts §3: the first attempt takes the intent and hands it to C7` | C7's request has `rebuild: {buildNoCache: true}`; the store no longer has the payload |
| `F-0502: a reconnection never takes the intent` | `isReconnection` true: no `take`; no `rebuild` |
| `contracts §3: an unreadable store is an ordinary open` | `take` rejects: one warn line; no `rebuild`; connected |
| `F-0405 BR-3: a rebuild runs up with removeExistingContainer` | C3's `up` options `{removeExistingContainer: true, buildNoCache: false}` |
| `F-0405 5.1: a no-cache rebuild passes buildNoCache` | `{removeExistingContainer: true, buildNoCache: true}` |
| `F-0405 6.9: a rebuild replaces a paused container instead of failing` | discovery gives `paused`: `up` runs; no `unusable` |
| `F-0405 BR-3: a rebuild is always created, and logs what it removes` | `created: true`; the info line names the discovered ids |
| `F-0409: an ordinary open is unchanged` | no `rebuild`: `{removeExistingContainer: false, buildNoCache: false}`, and `paused` gives `unusable` |

### 5.5 The manifest test

The four commands with their titles and category. The two `commandPalette` clauses verbatim. One remote-indicator
entry, for `rebuildContainer` only. `hideRebuildCommands` among the context keys.

### 5.6 Gate row 5, in `tests/acceptance/containers/gate.test.ts` (containers-09's launch), after row 1

| # | Steps | Assertions |
|---|---|---|
| 5 | Write folder `gate-rebuild` like `gate-image` (containers-09 §4.1), with `"postCreateCommand": "date +%s%N > /tmp/created"`. Open its window and `reopenInContainer('gate-rebuild')` until connected, as row 1. Note `first = devContainersOf(<folder>)[0]` and `marker1 = docker exec <first> cat /tmp/created`. Send `remote-containers.rebuildContainer` to `gate-rebuild` (not awaited), then wait for the window to be connected again (as row 1's wait) | `devContainersOf(<folder>)` has exactly one id, and it isn't `first`. `docker ps -a` has no container `first` (removed, BR-3). `docker exec <new id> cat /tmp/created` gives a value different from `marker1` (BR-9, AC-6). The window is the same window (the agent's window id is unchanged; BR-1), and `windowState('gate-rebuild').remoteName` is `dev-container`. No notification is open 10 s after the reconnect (AC-4). Then close the window |
| 5b | After row 5's close, note `second = devContainersOf(<folder>)[0]`, open a new local window on folder `gate-rebuild` the way row 1 opens `gate-image`, and send `remote-containers.rebuildNoCacheAndReopenInContainer` to it (not awaited); wait for it to be connected | the window is connected, with `remoteName` `dev-container`; `devContainersOf(<folder>)` has exactly one id, and it isn't `second`; `/tmp/created` in it differs from row 5's value (AC-8). Then close the window |

## 6. Open rows (stop and report on #884)

1. **athena's design check:** C10 reads the intent and hands it to C7 (§3.4 item 1), where contracts §3 says "C7
   reads it". If athena wants C7 to read it, move the `take` into `prepare`. C7 then gets the payload in its request.
2. **A re-measurement differs from §2**, for example the CLI keeps the old container after a failed build: report it
   with the CLI's output. If the removal doesn't come first, C7 adds `docker rm --force` of the discovered ids before
   `up`, after athena's answer.
3. **`workbench.action.reloadWindow` drops the window's folder** in the acceptance launch: report it, since BR-21's
   accepted behaviour then doesn't hold.

## 7. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- **`unit`:** F-0405 AC-29 and AC-30.
- **`acceptance`, once §5.6 passes:** F-0405 AC-4 (its window half; the progress text is containers-08's), AC-5,
  AC-6 (the postCreate half) and AC-8.
- **`deferred`, `containers release 1: views, Compose, attach and other windows come with later increments`:**
  AC-2, AC-3, AC-14, AC-15, AC-18, AC-20, AC-21, AC-22, AC-24, AC-27 and AC-28.
- **`deferred`, `containers release 1: F-0303's notification is increment 2`:** AC-9.
- **`todo`, with the card that brings it:**
  - AC-7: the Dockerfile path, containers-15;
  - AC-13's first half and AC-32's Use Template: authoring, increment 2;
  - AC-16: Close Remote Connection during a build;
  - AC-25 and AC-26: containers-11's dialog, with an acceptance row in containers-19;
  - AC-33: the preferred outcome isn't built.

## 8. Gates and review

Run all gates and the VSCodium run. The PR title is `remote-containers: the four rebuild commands, through the rebuild
intent (card containers-14, #884)`. Request athena only; hermes assigns the peer.
