# Task card containers-18: C7's legacy label tier and `dev.containers.cacheVolume`

Issue: #906. Milestone 0.4, increment 1b. Size: S. Builder: `task:local`. Every change and every row is spelled out
below; if something on main doesn't match what this card says, stop and report on #906 (§7).

**Build after** containers-08 (#776, C10) and containers-14 (#884, rebuild) are on main.

Sources:
- F-0409 (remote-oss/remote-containers#23): 5.0 steps 2 and 3, BR-2, BR-3, AC-1, AC-37;
- F-0419 (#92): 3.2, 6.1, 6.6, 6.8, BR-7, BR-8, AC-3, AC-9, AC-10, AC-12;
- containers-06 §3.1–§3.4, which is the code on main in `packages/remote-containers/src/lifecycle/`.

## 1. What this card builds

1. **The legacy tier (F-0409 BR-3).** A container labelled `vsch.local.folder` = the folder and `vsch.quality` =
   `stable` is a candidate. It's tier 1, before the exact-pair tier and the folder-only tier.
2. **`dev.containers.cacheVolume`.** When it's `false`, a new container gets no `vscode` volume.
   - It's read from the user's settings only (`application` scope; a folder's value is ignored, BR-7).
   - It falls back to the deprecated `remote.containers.cacheVolume` (BR-8), and defaults to `true`.
3. **The two settings' contribution.**

## 2. What was measured (the pinned CLI 0.89.0, Docker 29, on this card's draft)

- **The legacy container is reused:**
  1. A container was made with `docker run -d --label vsch.local.folder=<folder> --label vsch.quality=stable
     alpine:3.22 sleep 600`, then stopped.
  2. `up --workspace-folder <folder> --id-label vsch.local.folder=<folder> --id-label vsch.quality=stable` answered
     `success` with **that container's id**. The container was running again, and no container with a
     `devcontainer.local_folder` label was created.
  3. So passing the legacy pair as the id labels is how C7 reuses it.
- **A mount only applies when a container is created:** containers-06 §3.4, measured there. So
  `cacheVolume: false` changes nothing for an existing container (AC-9's first half).

## 3. The changes

### 3.1 `src/lifecycle/labels.ts`

Add, beside `FOLDER_LABEL` and `CONFIG_LABEL`:

```ts
const LEGACY_FOLDER_LABEL = 'vsch.local.folder';
const LEGACY_QUALITY_LABEL = 'vsch.quality';

/** The labels of a container made before the `devcontainer.*` labels, in the order the CLI is given them. */
export function legacyIdLabels(folder: string): string[] {
  return [`${LEGACY_FOLDER_LABEL}=${folder}`, `${LEGACY_QUALITY_LABEL}=stable`];
}

/** The arguments of the engine query that lists the ids of the legacy containers of a folder. */
export function legacyDiscoveryArguments(folder: string): string[] {
  return ['ps', '-a', '-q', '--no-trunc', '--filter', `label=${LEGACY_FOLDER_LABEL}=${folder}`, '--filter', `label=${LEGACY_QUALITY_LABEL}=stable`];
}

/** Whether a container carries the legacy pair for this folder. */
export function isLegacy(folder: string, container: ContainerFacts): boolean {
  return container.labels[LEGACY_FOLDER_LABEL] === folder && container.labels[LEGACY_QUALITY_LABEL] === 'stable';
}
```

`Decision`'s `use` member gains `idLabels: string[]`:

```ts
| {kind: 'use'; containerId: string; status: 'running' | 'exited' | 'created'; idLabels: string[]}
```

**`decide`:**
1. **The legacy candidates:** every container where `isLegacy(folder, container)` holds and `status !== 'removing'`.
2. **The other candidates:** as now. `devcontainer.local_folder` = `folder`, `devcontainer.config_file` = `configFile`
   or absent, and not `removing`. `exact` is as now.
3. **The tier:** the first non-empty of `legacy`, `exact` and `candidates`. Its newest container is the chosen one,
   by `newestOf`, unchanged.
4. For a `use`, `idLabels` is `legacyIdLabels(folder)` when the chosen container came from the legacy tier, and
   `idLabels(folder, configFile)` otherwise.
5. `unusable` and `create` are unchanged.
6. Update the JSDoc of `decide`: "Legacy-labelled containers come first, then those labelled with both, then those
   labelled with the folder only; within a tier the newest wins, whatever its status."

### 3.2 `src/lifecycle/container-lifecycle.ts`

1. **`ContainerRequest` gains `cacheVolume: boolean`.** JSDoc: "Whether a container this run creates mounts the
   `vscode` volume (`dev.containers.cacheVolume`, F-0419)."
2. **`discover`** runs two list queries: `discoveryArguments(folder)`, then `legacyDiscoveryArguments(folder)`.
   - Each goes through `askEngine` and returns as now on a cancel or a failure. The second query's failure gives
     `{kind: 'discoveryFailed', detail}` too.
   - The ids are the first query's, followed by the second query's ids that aren't already in the list.
   - Then one `inspect` of all of them, exactly as now.
3. **`prepare`, the target:**
   - `idLabels` is `decision.kind === 'use' ? decision.idLabels : idLabels(folder, configFile)`;
   - `mounts` is `request.cacheVolume ? [VOLUME_MOUNT] : []`.
4. **`prepare`, with containers-14's `request.rebuild` set:**
   - `idLabels` is always `idLabels(folder, configFile)`, so the new container gets the current labels.
   - **Before `up`,** each discovered container where `isLegacy(folder, container)` holds is removed with
     `askEngine(engine, ['rm', '--force', container.id], cancellation)`. The CLI's `--remove-existing-container` only
     finds containers by the id labels it's given, so it would never remove a legacy one, and the next open would pick
     the legacy container again (tier 1).
   - A failed removal returns `{kind: 'discoveryFailed', detail: \`the legacy container ${container.id.slice(0, 12)}
     couldn't be removed: ${detail}\`}`, and `up` isn't called.
   - Log one info line per removal: `rebuilding: removed the legacy container <id 12>`.
5. **Step 5, the volume read-back,** is unchanged. With `cacheVolume: false`, a new container has no `vscode` mount,
   so `volumeMounted` is `false`, and C10 installs without `installTree`. That's F-0419 AC-3's
   "`~/.vscode-server/bin/<commit>` is a real folder".

### 3.3 `src/lifecycle/cache-volume.ts` (new, pure)

```ts
/**
 * F-0419: the user's `dev.containers.cacheVolume`, else the deprecated `remote.containers.cacheVolume`, else true.
 * Only the user (global) values count: a folder's value is ignored (BR-7).
 */
export function cacheVolumeOf(primaryGlobal: unknown, deprecatedGlobal: unknown): boolean {
  if (typeof primaryGlobal === 'boolean') {
    return primaryGlobal;
  }
  return typeof deprecatedGlobal === 'boolean' ? deprecatedGlobal : true;
}
```

### 3.4 C10 passes it (containers-08's `connector.ts` and `register-connector.ts`)

- C10's `settings` dependency gains `cacheVolume(): boolean`. In `register-connector.ts` it's wired to:

  ```ts
  cacheVolumeOf(
    workspace.getConfiguration().inspect('dev.containers.cacheVolume')?.globalValue,
    workspace.getConfiguration().inspect('remote.containers.cacheVolume')?.globalValue,
  )
  ```

- It's read at each connect, and step 5's `prepare` request gets `cacheVolume: settings.cacheVolume()`.

### 3.5 The contribution (`package.json` `contributes.configuration`, texts in `package.nls*.json`)

- **`dev.containers.cacheVolume`:** `type: "boolean"`, `default: true`, `scope: "application"`, description
  `Controls whether a Docker volume should be used to cache the VS Code server and extensions.` (F-0419 3.2,
  verbatim).
- **`remote.containers.cacheVolume`:** the same `type`, `default` and `scope`, with `markdownDeprecationMessage`
  `` Use `#dev.containers.cacheVolume#` instead. `` (F-0102's alias).
- Add the two English texts to `package.nls.json`, and the same keys to every `package.nls.<locale>.json`, as the
  package's other settings do.

## 4. Rows

### 4.1 `labels.test.ts`

| Name | Given | Expected |
|---|---|---|
| `F-0409 AC-1: a legacy container is used` | one exited container with `vsch.local.folder` = `/w/p`, `vsch.quality` = `stable` | `{kind: 'use', containerId, status: 'exited', idLabels: ['vsch.local.folder=/w/p', 'vsch.quality=stable']}` |
| `F-0409 AC-37: a legacy container beats an older and a newer exact pair` | legacy created `2026-01-02T00:00:00Z`, exact pairs at `…01…` and `…03…` | the legacy one, with the legacy id labels |
| `F-0409 AC-37: a legacy container beats a newer folder-only one` | legacy `…01…`, folder-only `…02…` | the legacy one |
| `F-0409 BR-3: the newest of two legacy containers` | legacy at `…01…` and `…02…` | the `…02…` one |
| `F-0409: a legacy container with another quality isn't a candidate` | `vsch.quality` = `insider`, nothing else | `{kind: 'create'}` |
| `F-0409: a legacy container of another folder isn't a candidate` | `vsch.local.folder` = `/w/q` | `create` |
| `F-0409 BR-3: a removing legacy container is skipped` | legacy `removing`, exact `exited` | the exact one, with the standard id labels |
| `F-0409 BR-3: a paused legacy container is unusable` | legacy `paused` | `{kind: 'unusable', …}` |
| `F-0409: the exact pair keeps the standard id labels` | the existing exact-pair rows | their `use` now also has `idLabels: idLabels(folder, configFile)`; update each expected value |
| `F-0409: the legacy query's arguments` | `legacyDiscoveryArguments('/w/a b')` | `['ps','-a','-q','--no-trunc','--filter','label=vsch.local.folder=/w/a b','--filter','label=vsch.quality=stable']` |

### 4.2 `container-lifecycle.test.ts` (over the existing fake engine and fake bridge)

| Name | Expected |
|---|---|
| `F-0409 AC-1: discovery lists both label sets and inspects them once` | the engine got the standard query, then the legacy query, then one `inspect` with ids `[a, b, c]` when the queries answer `[a, b]` and `[b, c]` |
| `F-0409: a failed legacy query is a discovery failure` | the second query fails: `discoveryFailed`, no `inspect`, no `up` |
| `F-0409 AC-1: a legacy container is brought up with the legacy id labels` | the `up` target's `idLabels` is `['vsch.local.folder=<folder>', 'vsch.quality=stable']` |
| `F-0419 AC-3: cacheVolume false mounts nothing` | `cacheVolume: false`: the `up` target's `mounts` is `[]` |
| `F-0419: cacheVolume true mounts the volume` | `cacheVolume: true`: `mounts` is `['type=volume,source=vscode,target=/vscode']` |
| `F-0405 with F-0409: a rebuild removes the legacy container first, and uses the standard labels` | `rebuild` set, discovery finds one legacy container: `rm --force <id>` before `up`; `up`'s `idLabels` are the standard pair; the info line |
| `F-0405 with F-0409: a failed legacy removal stops the rebuild` | `rm` fails: `discoveryFailed` naming the 12-character id; no `up` |
| `F-0405: a rebuild with no legacy container removes nothing itself` | no `rm` call |

The existing rows pass `cacheVolume: true` in their requests, so their expected values don't change.

### 4.3 `cache-volume.test.ts`

| Name | Given | Expected |
|---|---|---|
| `F-0419 3.2: unset is true` | `(undefined, undefined)` | `true` |
| `F-0419 AC-3: false is false` | `(false, undefined)` | `false` |
| `F-0419 AC-10, BR-8: the deprecated key when the current one is unset` | `(undefined, false)` | `false` |
| `F-0419 BR-8: the current key wins over the deprecated one` | `(true, false)` | `true` |
| `contracts: a non-boolean counts as unset` | `('false', undefined)` | `true` |

`F-0419 AC-12, BR-7: a folder's value is ignored` is a row on the C10 wiring (§3.4). Its fake `inspect` gives
`{globalValue: undefined, workspaceValue: false}`, and the connect's request has `cacheVolume: true`.

### 4.4 The manifest test

Both settings, with their `type`, `default`, `scope`, the description and the deprecation text, read from
`package.json` and the English nls file.

### 4.5 Acceptance (`tests/acceptance/containers/gate.test.ts`, containers-09's launch)

| # | Steps | Assertions |
|---|---|---|
| L1 | Write folder `gate-legacy` (containers-09 §4.1's shape, an image configuration). Run `docker run -d --label vsch.local.folder=<the folder> --label vsch.quality=stable <the run's pinned alpine reference> sleep infinity`, then `docker stop` it, and note its id. Open the folder's window and `reopenInContainer('gate-legacy')` until connected | `docker ps -q --filter label=vsch.local.folder=<the folder>` gives the noted id (12 characters), running; `devContainersOf(<the folder>)` is `[]` (no new container); the window is connected (F-0409 AC-1, AC-37's legacy half) |
| L2 | `inWindow('local', 'acceptance.agent.updateSetting', 'dev.containers.cacheVolume', false)`. Write folder `gate-novolume` (an image configuration). Reopen until connected. Afterwards set the setting back with `undefined` | `docker inspect -f '{{json .Mounts}}' <its container>` has no mount with `Destination` `/vscode`; `docker exec <id> test -L <the remote user's home>/<the server's data folder>/bin/<commit>` fails, while `test -d` on the same path succeeds (F-0419 AC-3) |

The `afterEach` removes the containers of these folders with `docker rm --force`.

## 5. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- **`acceptance`:** F-0409 AC-1 (the legacy clause, with L1) and F-0419 AC-3 (L2).
- **`unit`:** F-0409 AC-37; F-0419 AC-10 and AC-12.
- **`todo`:** F-0419 AC-9. Its rebuild half needs containers-14's acceptance rows with the setting changed; it goes in
  containers-19.

## 6. Gates and review

- **Gates:** all of them: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers,
  check-string-tables, check-consumed and check-coverage.
- **Runs:** the VSCodium run.
- **PR title:** `remote-containers: C7's legacy label tier and dev.containers.cacheVolume (card containers-18,
  #906)`.
- **Review:** request athena only; hermes assigns the peer.

## 7. Open rows (stop and report on #906)

1. `decide`, `discover` or `ContainerRequest` on main look different from §3. For example, containers-14 named the
   rebuild field something other than `rebuild`: report the difference, and don't adapt the design on your own.
2. Row L1's `up` creates a new container instead of starting the noted one: report the CLI's output.
3. `check-identifiers` or `check-consumed` rejects one of the two settings: report the message.
