# Task card containers-06: C7, the container lifecycle (slice 1: find, then create)

Issue: #769. Remote - Containers release 1, slice 1 (milestone 0.4). Builder: hestia, after containers-01 (#759) and
containers-03 (#758). Size: M (about 2 agent-days).

**Binding documents:**
- `components.md`: C7, and boundaries 4, 5 and 6;
- `contracts.md`: §2 step 3 and §6 (§3's rebuild intent is the next card's);
- `brief-release-1.md`: rulings 1 and 4, and the F-0419 paragraph of §2 (the server-cache half of the `vscode` volume).

**Specs** (`remote-oss/remote-containers`):
- F-0409 (#23): 5.0 steps 2 to 5, BR-1 to BR-3, §16;
- F-0408 (#27): 5.0 step 7;
- F-0412 (#29): the `image` path only;
- F-0415 (#32): `waitFor`, 5.0 steps 6 to 9;
- F-0419 (#92): 5.0 steps 4 to 6, 7.E2.

**Depends on:**
- **containers-04 (#763, C3), the CLI bridge:**
  - `CliBridge.up(target, {removeExistingContainer, buildNoCache}, onEvent, cancellation)` → `UpResult`, which is
    `{kind: 'up', containerId, remoteUser, remoteWorkspaceFolder}` or a `CliFailure`;
  - `CliBridge.runUserCommands(target, containerId, onEvent, cancellation)` → `{kind: 'done'}` or a `CliFailure`;
  - `CliTarget` and `CliEvent`;
  - the measured fact that `up` runs with `--skip-non-blocking-commands`, so it returns at the `waitFor` target.
- **containers-03 (#758, C2):** the `EngineHost` port, `engine/engine-host.ts`, and `nodeEngineHost(dockerPath)`.
- **containers-01 (#759, C1):** the package, and the `Logger` (`ServedWindow.logger`). C7 contributes no command and no
  setting (§6, item 3).
- **One addition to C3 (§3.4):** `CliTarget` gains `mounts`. If containers-04 is built first without it, this card adds
  it with its rows.

Everything below was measured on this lab machine on 2026-10-14 with Docker 29.9.0 and `@devcontainers/cli` 0.89.0
(samples in the appendix).

## 1. What C7 is in slice 1

C7 runs inside the resolve (contracts §2 step 3). It is UI-free and decides, from labels alone (F-0409 BR-1, BR-2),
what happens to the folder's container. In slice 1 it carries out the outcomes below.

| C7's decision (F-0409 BR-3) | Slice 1 does |
|---|---|
| no candidate | `up`: the CLI creates the container, with the `vscode` volume |
| the chosen candidate is `running` | `up`: the CLI finds the same container by the same labels and uses it as is |
| the chosen candidate is `exited` or `created` | `up`: the CLI starts the same container id (measured, appendix) |
| the chosen candidate is `paused`, `restarting` or `dead` | no CLI call; the outcome `unusable` goes to C10, then to C8 (boundary 4) |

Then C7 starts the non-blocking lifecycle commands in the background (§3.3) and returns what C10 needs (§3.5).

**Increment 1b (the next C7 card, not this one):**
- the explicit start of an exited or created candidate by C7 itself, if athena asks for it (§6, item 1);
- the legacy tier, `vsch.local.folder` + `vsch.quality` = `stable` (F-0409 AC-1's last clause and AC-37);
- the Dockerfile path (F-0412 `build`, the `vsc-<name>-<hash>` tag);
- rebuild, which reads the intent of contracts §3 and passes `removeExistingContainer` / `buildNoCache`
  (F-0405 BR-17);
- the lifecycle markers and the lifecycle-failure surfaces of F-0415;
- `dev.containers.cacheVolume` and its deprecated alias (F-0419 §3.2, AC-3, AC-9, AC-10, AC-12).

The module's shape (§3) takes them without change to its API: they add decisions and options, not new calls for C10.

## 2. Files

All in `packages/remote-containers/src/lifecycle/`.

| File | Contents |
|---|---|
| `labels.ts` | pure: the id labels, the discovery argv, and the candidate classifier (§3.1, §3.2) |
| `inspect-lines.ts` | pure: the parser of `docker inspect`'s JSON array (§3.1) |
| `container-lifecycle.ts` | `containerLifecycleOf(...)` and its `prepare` (§3.3 to §3.5) |

## 3. The design

### 3.1 Discovery: the argv and the parsing

**Step 1, the ids.** Run `engine.run(argv, {kind: 'none'}, {cancellation})` with argv:

```
['ps', '-a', '-q', '--no-trunc', '--filter', 'label=devcontainer.local_folder=<folder>']
```

Its stdout is one full container id per line; an empty stdout means no candidate.
- **Why not `--format '{{json .}}'`:** `ps` joins the labels into one string with `,` as the separator, and a folder
  path may hold a comma. Measured: a folder named `ws,a b` gives `Labels: "devcontainer.config_file=…/ws,a
  b/.devcontainer/devcontainer.json,devcontainer.local_folder=…/ws,a b,…"`, which can't be split back.
- **Why `ps` at all:** Docker's label filter matches the whole value exactly, including commas and spaces (measured).
  So step 2 reads only the folder's containers.

**Step 2, their facts.** When step 1 found any id, run `engine.run(['inspect', '--type', 'container', ...ids], …)`.
Its stdout is a JSON array. `inspect-lines.ts` reads from each element:
- `Id`;
- `Created`, an RFC 3339 time with up to nine fraction digits;
- `State.Status`;
- `Config.Labels`;
- `Mounts`, used after `up` (§3.4).

A missing or wrong-typed field is `{kind: 'discoveryFailed', detail: 'inspect: <field>'}`.

**Engine failures.** Either run answering `failed`, or exiting non-zero, gives `{kind: 'discoveryFailed', detail}`.
- `detail` is the spawn message, or the first stderr line.
- A container removed between step 1 and step 2 makes `inspect` exit 1 with `Error: No such container: <id>`. C7 then
  runs discovery once more, from step 1. A second miss is `discoveryFailed`.

**What C7 never does:** pass a value through a shell. Each value is its own argv element, with `shell: false` (C2's
adapter).

### 3.2 The classifier (`labels.ts`, pure; F-0409 5.0 steps 2 to 4, BR-2, BR-3)

```ts
export interface ContainerFacts {
  id: string;
  created: string;
  status: string;
  labels: Readonly<Record<string, string>>;
}
export type Decision =
  | {kind: 'create'}
  | {kind: 'use'; containerId: string; status: 'running' | 'exited' | 'created'}
  | {kind: 'unusable'; containerId: string; status: 'paused' | 'restarting' | 'dead'};
export function idLabels(folder: string, configFile: string): string[];
export function decide(folder: string, configFile: string, containers: readonly ContainerFacts[]): Decision;
```

**`idLabels`:** exactly `[`devcontainer.local_folder=${folder}`, `devcontainer.config_file=${configFile}`]`, in that
order (C3 §4.1).

**`decide`:**
1. **Candidates.** A container is a candidate when:
   - `labels['devcontainer.local_folder'] === folder`, compared as strings exactly, with no path normalisation and no
     symlink resolution (F-0409 BR-2);
   - and `labels['devcontainer.config_file']` is either `configFile` exactly or absent. A container labelled with
     another config file is never a candidate (7.E2);
   - and `status !== 'removing'`.
2. **Tiers.** Tier 2 holds candidates with both labels; tier 3 holds those with only the folder label. Tier 1, the
   legacy pair, is increment 1b. The first non-empty tier decides.
3. **Within the tier,** the most recently created candidate is chosen, whatever its status (BR-3).
   - Compare `Created` by `createdKey(created)`: the date and time up to the seconds, then the fraction right-padded
     with `0` to nine digits.
   - **Why:** Docker trims trailing zeros of the fraction, so plain string order is wrong between `…28.1Z` and
     `…28.09Z`.
   - Two equal keys: the greater `Id` string wins, so the result never depends on the input order.
4. **The chosen candidate's status:**
   - `running`, `exited` or `created` → `use`;
   - `paused`, `restarting` or `dead` → `unusable`;
   - any other status (Docker's list is closed, but a future engine may add one) → `unusable`, with the status as
     given.
5. **No candidate** → `create`.

### 3.3 `prepare`: what C7 does, in order

```ts
export type ContainerStep = 'findingContainer' | 'startingContainer' | 'containerReady';
export interface ContainerRequest {
  folder: string;        // the payload's hostPath (contracts §3)
  configFile: string;    // the payload's configFile.fsPath
  dockerPath: string;    // dev.containers.dockerPath, as C2 read it
  logLevel: 'info' | 'debug' | 'trace';
}
export type ContainerOutcome =
  | {kind: 'ready'; containerId: string; remoteUser: string; remoteWorkspaceFolder: string; volumeMounted: boolean; created: boolean}
  | {kind: 'unusable'; containerId: string; status: string}
  | {kind: 'discoveryFailed'; detail: string}
  | CliFailure;
export interface ContainerLifecycle {
  prepare(request: ContainerRequest, onStep: (step: ContainerStep) => void, onCliEvent: (event: CliEvent) => void, cancellation: AbortSignal): Promise<ContainerOutcome>;
  /** Ends the background lifecycle commands this lifecycle started (§3.6). */
  stopBackground(): void;
}
export function containerLifecycleOf(dependencies: {engine: EngineHost; cli: CliBridge; logger: Logger}): ContainerLifecycle;
```

**The steps of `prepare`:**
1. `onStep('findingContainer')`, then discovery (§3.1) and `decide` (§3.2).
   - `discoveryFailed` and `unusable` are returned as they are, and nothing else runs. That covers
     F-0409 AC-7, AC-46 and the dead state, without a CLI call (boundary 4).
2. `onStep('startingContainer')` (F-0408 5.0 step 7: the log step "Starting container"). Then `cli.up(target,
   {removeExistingContainer: false, buildNoCache: false}, onCliEvent, cancellation)`, where `target` is:
   - `workspaceFolder: folder`, `configFile`, `dockerPath`, `logLevel`;
   - `idLabels: idLabels(folder, configFile)`;
   - `mountWorkspaceGitRoot: true` (F-0411 BR-1, C3 §3.1 rule 5);
   - `mounts: ['type=volume,source=vscode,target=/vscode']` (§3.4).
3. A `CliFailure` is returned as it is. C10 and C8 present it.
4. On `up`:
   - `created` is true when the result's `containerId` isn't among the ids discovery found.
   - When `decide` gave `use` and the CLI's id differs from the chosen one, log one warn line,
     `the dev container CLI used <cli id 12> where <chosen id 12> was chosen`, and go on with the CLI's container. It's
     the one that runs.
5. Read the volume (§3.4) and set `volumeMounted`.
6. Start the background lifecycle commands (§3.6). Don't await them.
7. `onStep('containerReady')`, then return `ready`.

**Cancellation:** an abort during discovery or `up` returns `{kind: 'cancelled'}`. C3 ends its process; the engine
port ends `docker`. Nothing is removed: a container that `up` was creating stays as Docker left it, which is F-0409's
own outcome for a later open.

### 3.4 The `vscode` volume (F-0419 5.0 steps 4 to 6; brief ruling 4)

**Mounting it.** Slice 1 always mounts the volume: `dev.containers.cacheVolume` comes in increment 1b, and its default
is `true`. The mount is passed to the CLI as one `--mount type=volume,source=vscode,target=/vscode`.
- The CLI accepts the form `type=<bind|volume>,source=<source>,target=<target>[,external=<true|false>]` (`up --help`,
  measured).
- Docker creates the volume when it's missing, empty and with the `local` driver, and reuses it when it exists
  (F-0419 5.0 step 5).
- Measured: the created container lists the volume at `/vscode` with `RW: true` and `Mode: "z"`, beside the workspace
  bind mount (appendix).
- The CLI applies the mount only when it creates a container. An existing container keeps its mounts, which is F-0419
  6.5's behaviour.

**The amendment to C3** (containers-04, §3.1): `CliTarget` gains `mounts: readonly string[]`. `upArguments` emits one
`--mount <value>` per entry right after `--docker-path`, and `runUserCommandsArguments` and
`readConfigurationArguments` emit none. Add three rows to `cli-arguments.test.ts`:
- two mounts give two `--mount` pairs, in order;
- an empty list gives none;
- `run-user-commands` has none.

If containers-04 merged with it, skip this.

**Reading it back.** After `up`, run `engine.run(['inspect', '--type', 'container', containerId], …)`. Then
`volumeMounted` is true only when `Mounts` holds an entry with `Type: 'volume'`, `Name: 'vscode'` and
`Destination: '/vscode'`.
- That's how a reused container created without the volume (by an earlier `cacheVolume: false`, or by another tool)
  gets `false`. C10 then installs without `installTree`, as F-0503 does without the volume.
- A failure of this read is logged at warn, and gives `volumeMounted: false`.

**A collision** (F-0419 7.E2: a configuration `mounts`, `runArgs` or `workspaceMount` also at `/vscode`) makes the
CLI's create fail, and the CLI reports it as `setupFailed`. C7 passes it on; C8 shows S034.

### 3.5 What C10 gets

`ready` carries:
- `containerId`, the full 64-hex id, for C11's channel and dialer;
- `remoteUser`, for C11's `--user`;
- `remoteWorkspaceFolder`, the folder the window opens;
- `volumeMounted`, for `installTree` (containers-05);
- `created`, for the log.

C7 never writes a log line naming a secret: it logs container ids, statuses and the CLI's own lines, which C3 passes
through `onCliEvent` and C10 logs.

### 3.6 The background stage (F-0415 5.0 steps 6 to 9; C3 §4.2)

**Starting it.** After `ready`, C7 calls `cli.runUserCommands(target, containerId, onCliEvent, background.signal)`
with its own `AbortController` (`background`), one per lifecycle, and doesn't await it.

**How it ends:**
- `done` → one info line, `the lifecycle commands finished`;
- a `CliFailure` → one warn line, `the lifecycle commands failed: <kind>`, with `(<hook>)` added for
  `lifecycleFailed`. The CLI's `message` isn't logged here: it can quote a user's command, and the CLI's own lines
  already reach the log through `onCliEvent` (C3 §3.3). The F-0415 failure surfaces are increment 1b.
- `stopBackground()` aborts `background`. C10's `cancel()` calls it.

**Only one run at a time:** a second `prepare` on the same lifecycle (a reconnection's resolve) first aborts a run
that is still going.

## 4. Rows

All under `packages/remote-containers/test/unit/` unless named otherwise. Each row's name starts with the AC it proves,
or with `C7:`.

### 4.1 Pure rows

**`labels.test.ts`:**
- `idLabels('/w/a b', '/w/a b/.devcontainer/devcontainer.json')` → the two strings, in order.
- The discovery argv for a folder with spaces, quotes and a comma (`/w/x,"y" z`) → one `label=…` element holding the
  value unchanged (contracts §6, no shell).
- **`decide`:**
  - `F-0409 AC-3 (C7's half)`: no container → `create`.
  - The exact pair, `running` → `use`; `exited` → `use`; `created` → `use`.
  - `paused`, `restarting`, `dead` → `unusable` with that status. An unknown status `frozen` → `unusable`.
  - `F-0409 AC-15`:
    - a container labelled for config A, opened with config B → `create`;
    - the same set opened with A → `use` of A's container.
  - Folder-only (no `config_file` label), `exited` → `use`, with that container chosen.
  - An exact-pair container OLDER than a folder-only one → the exact pair wins, because tiers come before age.
  - Two exact-pair containers, the older `running` and the newer `exited` → the newer one, `use` with status
    `exited`.
  - `F-0409 AC-25`: one exact-pair container `removing` → `create`; with a second, older `exited` one → that one.
  - `F-0409 AC-28`: a container labelled `/real/w`, opened as `/link/w` → `create`. Strings only: the row passes no
    file system.
  - `createdKey`: `…28.1Z` sorts after `…28.09Z`; `…28Z`, with no fraction, sorts before `…28.000000001Z`. Two equal
    keys → the greater `Id` wins, in both input orders.

**`inspect-lines.test.ts`:**
- The appendix's `inspect` sample → one `ContainerFacts`, with a label value holding `,` and a space kept whole.
- `[]` → no facts.
- A missing `State.Status` → `discoveryFailed` naming the field; text that isn't JSON → `discoveryFailed`.
- The `Mounts` reader: the sample → `volumeMounted` true; the same with `Name: 'vscode2'`, with `Destination: '/vsc'`,
  or with `Type: 'bind'` → false.

### 4.2 `container-lifecycle.test.ts` (over a scripted `EngineHost` and a fake `CliBridge`)

The fake engine answers per argv; the fake bridge records its calls and answers scripted results. Fake timers are used
where a row needs them.

**Steps and calls:**
- No container:
  - the steps are `findingContainer`, `startingContainer`, `containerReady`;
  - `up` got the target of §3.3 step 2, compared whole, including `mounts` and `mountWorkspaceGitRoot: true`;
  - `ready` has `created: true` and `volumeMounted: true`;
  - `runUserCommands` was called once, after `ready`, with the result's id.
- A running exact-pair container: `up` called; `ready` with `created: false`, with the same id.
- `F-0409 AC-7 (C7's half)` and `AC-46 (C7's half)`: `paused`, and `restarting`, → `unusable`. The fake bridge got no
  call (boundary 4).
- `ps` answering `failed` (`spawn dk ENOENT`) → `discoveryFailed` with that detail; no bridge call.
- **`inspect` answering `No such container`:**
  - once → discovery runs again, and the second answer decides;
  - twice → `discoveryFailed`.
- **`up` failures:**
  - `up` answering each `CliFailure` kind → returned unchanged, and no `runUserCommands`;
  - `setupFailed` for a `/vscode` collision (§3.4) → returned unchanged. Name it `F-0419 AC-14 (C7's half)`.
- The CLI's id differing from the chosen one → one warn line naming both 12-character ids, and `ready` with the CLI's
  id.
- The volume read answering `failed` → one warn line, and `volumeMounted: false`.
- An abort during `ps` → `cancelled`; during `up` → the bridge's `cancelled`, returned as it is.

**The background stage:**
- `runUserCommands` resolving `done` → one info line.
- A `lifecycleFailed` → one warn line naming the kind.
- `stopBackground()` aborts the signal the bridge got.
- A second `prepare` aborts the first background run before starting.

**R-26:**
- No `engine.run` call passes `environment`. C7 holds no secret of its own.
- A background `CliFailure` whose `message` is `Command failed: echo s3cr3t-token` → the logger saw no line
  containing `s3cr3t-token`. Nor did it see one in any other row's output, which the row checks by scanning every
  logged line.

### 4.3 The real-Docker row (`tests/acceptance/containers-cli/lifecycle.test.ts`)

**Where it runs:** in containers-04's suite and script, `pnpm test:acceptance:containers-cli`, with its `before` hook
that skips without Docker. If containers-04 named the folder or script differently, use its names.

**The fixture:** a temporary folder named `c7 row,1` (a space and a comma), with
`.devcontainer/devcontainer.json` holding:

```json
{"name": "c7-row", "image": "alpine:3.22", "postCreateCommand": "echo created > /tmp/c7-created"}
```

It uses the real `containerLifecycleOf` over `nodeEngineHost('docker')` and the real bridge.

**The steps:**
1. `prepare` →
   - `ready` with `created: true`, `remoteUser` `root` and `remoteWorkspaceFolder` `/workspaces/c7 row,1`.
   - `docker inspect` of the id shows the labels `devcontainer.local_folder`, `devcontainer.config_file` and
     `devcontainer.metadata`, and no `vsch.*` label. Name the row `F-0409 AC-4`.
   - The `vscode` volume is mounted read-write at `/vscode`. Name the row `F-0419 AC-1`.
2. Wait for the background stage, at most 30 s → `docker exec <id> cat /tmp/c7-created` prints `created`.
3. `prepare` again → `ready` with the same id and `created: false`.
4. `docker stop -t 1 <id>`, then `prepare` → the same id, now `running`, and `created: false`. Name this row
   `C7: an exited container is started by up` (F-0409 AC-2 waits for the gate rows, which see the window).
5. `docker pause <id>`, then `prepare` → `unusable` with `paused`. `docker ps` shows no new container for the folder.

**Cleanup:**
- In `after`: `docker unpause`, if needed, then `docker rm -f` every container whose `devcontainer.local_folder` is the
  fixture folder.
- **The `vscode` volume is left:** it's the shared volume every dev container on the engine uses (F-0419 BR-6), and
  the product never removes it.

## 5. Catalogue

In `docs/architecture/catalogue/coverage-containers-r1.tsv`, being seeded in parallel. If it isn't on main when this
lands, tag nothing and list the IDs in the PR.
- **`unit`:** F-0409 AC-15, AC-25 and AC-28.
- **`acceptance`:** F-0409 AC-4, and F-0419 AC-1.

The rows named "(C7's half)" cite their AC without changing its tag. Those ACs stay `todo` for the gate rows card,
which sees the window: F-0409 AC-2, AC-3, AC-7 and AC-46, and F-0419 AC-14.

## 6. For athena, and the choices this card made

1. **The start of an exited or created container goes through the CLI's `up` in slice 1.**
   - **What was measured:** `up` with the same id labels starts the same id (appendix), and the CLI's own choice rules
     match tiers 2 and 3. That's F-0409 §16, and the classifier's rows.
   - **What still holds:** C7 decides first, as boundary 4 says, and an `unusable` status never reaches the CLI.
   - **The question:** is that enough, or should C7 run `docker start <id>` itself before `up`? If it should, that's
     one more argv in increment 1b, with no change to C10.
2. **C3's `CliTarget` gains `mounts`** (§3.4), an amendment to containers-04 (#764). That's the CLI's first ADR-0009
   mechanism, a flag.
3. **No setting in slice 1.** `dev.containers.cacheVolume` and its deprecated alias come with increment 1b, so tooling-31
   sees no unconsumed setting now. Until then, every container C7 creates has the volume, which is F-0419's default.
4. **The legacy tier is increment 1b.** In slice 1, a folder whose only container carries the legacy pair gets a new
   container. F-0409 AC-1 and AC-37 stay `todo` until then.

## 7. Gates and review

**Gates:** typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage,
with every file of `src/lifecycle/` at 100 % and the remote-containers ratchet at 100/100/100. Run
`pnpm test:acceptance:containers-cli` on this lab machine and paste its output.

**The PR:** title `remote-containers: C7, find the container, then create it (card containers-06, #769)`. themis or
triton reviews; athena gives the design check, on §6.

## 8. Open rows (stop and report on #769)

1. In your run, `up` on an exited candidate creates a new container instead of starting it. Report the CLI's log
   lines, and don't add `docker start` by guess: it's §6 item 1's question.
2. Docker's `inspect` of a container answers with a field of §3.1 in another form. Report the sample.
3. The CLI rejects `--mount type=volume,source=vscode,target=/vscode` for a configuration that also has `mounts`
   entries. Report the configuration and the result line.

## Appendix: samples (lab machine, 2026-10-14, Docker 29.9.0, CLI 0.89.0)

The paths are shortened to `/w/…`.

**`ps -a --filter label=… --format '{{json .}}'`** (not used; it shows why §3.1 doesn't use it):
```
{"Command":"\"/bin/sh -c 'echo Co…\"","CreatedAt":"2026-10-14 03:00:28 +0000 UTC","ID":"93e50db9eb55","Image":"alpine:3.22","Labels":"devcontainer.config_file=/w/ws,a b/.devcontainer/devcontainer.json,devcontainer.local_folder=/w/ws,a b,devcontainer.metadata=[],remote-oss.c7probe=1","LocalVolumes":"1","Mounts":"remote-oss-c7p…,/tmp/claude-10…","Names":"lucid_meninsky","State":"running","Status":"Up Less than a second",…}
```

**`ps -a -q --no-trunc --filter label=devcontainer.local_folder=/w/ws,a b`:**
```
93e50db9eb557e3e41b368f995b518456d3e85800a6e16a8414db40c41c11b90
```
The same filter with `/w/ws,a b/x` printed nothing.

**`inspect`** (fields read):
```
"Id": "93e50db9eb557e3e41b368f995b518456d3e85800a6e16a8414db40c41c11b90"
"Created": "2026-10-14T03:00:28.107239685Z"
"State": {"Status": "running", …}
"Config": {"Labels": {"devcontainer.config_file": "/w/ws,a b/.devcontainer/devcontainer.json", "devcontainer.local_folder": "/w/ws,a b", "devcontainer.metadata": "[]", …}}
"Mounts": [{"Type":"volume","Name":"<volume>","Source":"/var/lib/docker/volumes/<volume>/_data","Destination":"/vscode","Driver":"local","Mode":"z","RW":true,"Propagation":""},{"Type":"bind","Source":"/w/ws,a b","Destination":"/workspaces/ws,a b","Mode":"","RW":true,"Propagation":"rprivate"}]
```
The probe used a volume of its own name, so as not to touch this machine's `vscode` volume.

**`up`, create, with `--mount type=volume,source=<volume>,target=/vscode`:**
```
{"outcome":"success","containerId":"93e50db9…1b90","remoteUser":"root","remoteWorkspaceFolder":"/workspaces/ws,a b",…}
```

**`docker stop`, then `up` with the same labels:** the same `containerId`, and `State.Status` `running` afterwards.

**`docker pause`:** `State.Status` `paused`, and `ps` `State` `paused`.
