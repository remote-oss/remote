# Task card containers-25: C10's root step creates the `vscode` volume's missing shared folders

Issue: #924. Milestone 0.4, gating containers release 1. Size: M. Builder: `task:claude` (daedalus).

Sources:
- F-0419 (remote-oss/remote-containers#92): 5.0 step 6, 7.E4, 7.E5;
- containers contracts §5.2, "The volume's shared folders" (amended at fdc6461 and corrected at 19e69f4), and
  components boundary 6;
- transport contracts, `cacheFolders` (the volume layout per product, ruled 2026-10-12, #279);
- containers-08 (C10, `packages/remote-containers/src/connect/server-steps.ts`, `connector.ts`) and C11
  (`packages/remote-containers/src/exec/exec-channel.ts`).

## 1. The defect

The user's trial on main, image `mcr.microsoft.com/devcontainers/javascript-node:22` (remote user `node`): Reopen in
Container ends in S034, and the log says only this:

```
[19:49:21.231] Downloading the server …
[19:49:21.798] the server was not installed: scriptFailed
```

- **The cause.** A fresh named volume is `root:root 0755` at `/vscode`, so uid 1000 can't create
  `/vscode/<serverFolder>`. lib-server's install script reports `CreateInstallDirFailed`. F-0419 5.0 step 6: the
  reference creates the shared folders as root, mode 0777, whoever the remote user is.
- **The empty log line.** server-steps.ts logs `transferred.failure.kind` only. The status and the write failure the
  script reported (`TransferFailure` `scriptFailed`: `status`, `writeFailure`) never reach the log.

## 2. The design

### 2.1 The folders (`server-steps.ts`)

```ts
/** The volume's shared folders for `platform`, parents first (contracts §5.2); nothing for a platform that isn't a folder name. */
export function sharedFoldersOf(profile: ProductProfile, platform: string): readonly string[] | undefined
```

- `platform` is `${operatingSystem}-${architecture}` of the first probe's `templatePlatformOf`. A platform that doesn't
  match `^[a-z0-9-]+$` gives `undefined`.
- Otherwise, in this order:
  1. `/vscode/${volumeServerFolder(profile.applicationName)}`;
  2. that `+ '/bin'`;
  3. that `+ '/' + platform`.
- The names come from lib-product, never literals here. For `codium`, they're `/vscode/codium-server`, `…/bin` and
  `…/bin/linux-x64`.
- Folder 3 is `cacheFolders(…).serverTree` without its last segment. A row checks that they agree.
- **The extensions cache folder isn't one of them** (athena, 19e69f4). `cacheFolders`' `extensionsCache` joins this step
  with the increment-2 card that uses it.

### 2.2 The root script (`packages/remote-containers/src/connect/volume-folders.ts`, new)

```ts
/** The fixed script that makes each missing shared folder 0777 as root; its folders come in SHARED_FOLDER_1 to 3. */
export const VOLUME_FOLDERS_SCRIPT: string;

/** Runs the script over `rootChannel`; it logs what happened and never fails the connect (contracts §5.2). */
export async function prepareVolumeFolders(
  rootChannel: HostChannel,
  folders: readonly string[],
  logger: Logger,
  cancellation: AbortSignal,
): Promise<void>;
```

**The script** (POSIX `sh`, `set -u`). The marker lines are lib-server's `RESULT_BEGIN` and `RESULT_END`, built into
the constant.

```sh
set -u
status=Ok
created=
failedPath=
failedError=
for folder in "$SHARED_FOLDER_1" "$SHARED_FOLDER_2" "$SHARED_FOLDER_3"; do
  [ -e "$folder" ] && continue
  if output=$(mkdir -- "$folder" 2>&1); then
    if output=$(chmod 0777 -- "$folder" 2>&1); then
      created="$created $folder"
      continue
    fi
  elif [ -e "$folder" ]; then
    continue
  fi
  if [ "$status" = Ok ]; then
    status=CreateInstallDirFailed
    failedPath=$folder
    failedError=$(printf '%s' "$output" | tr '\n' ' ')
  fi
done
printf '%s\n' '<RESULT_BEGIN>' "status=$status" "server.created=${created# }"
if [ -n "$failedPath" ]; then
  printf '%s\n' "server.writeFailedPath=$failedPath" "server.writeFailedError=$failedError"
fi
printf '%s\n' '<RESULT_END>'
```

- **Never touch an existing folder.** It doesn't change the owner or mode of anything that exists, folder or not
  (F-0419 7.E4, 7.E5).
- **A lost race.** A `mkdir` that fails because another container just made the folder leaves that folder as found.
- **The first failure is kept, and the rest still run.** They fail too, so the log names the first folder that
  couldn't be made.
- **The script's text is the same on every run.** The folders reach it only through the channel's `environment`
  (`SHARED_FOLDER_1` to `SHARED_FOLDER_3`). C11 passes environment values in the `docker` process's own environment,
  so `docker exec`'s argv holds the variable names and nothing else of the step.

**`prepareVolumeFolders`.** It runs the script with `interpreter: 'posixShell'`, `input: {kind: 'text', text: ''}`
and `environment` set from `folders`, then reads the lines with lib-server's `parseResult`. It logs exactly one
line, at `info`:

| Outcome | The line |
|---|---|
| block `Ok`, `server.created` not empty | `the volume's shared folders were created: <created, joined by ', '>` |
| block `Ok`, nothing created | `the volume's shared folders all exist` |
| block `CreateInstallDirFailed` | `the volume's shared folder <writeFailedPath> could not be made: <writeFailedError>` |
| the channel failed | `the volume's shared folders were not prepared: <failure.kind>: <failure.detail>` |
| no result block (for example, when `docker exec --user root` is refused) | `the volume's shared folders were not prepared: the root step gave no result (exit <status>)` |

In every case it returns. The connect goes on, and the remote user's install succeeds or fails on its own terms
(contracts §5.2). A cancellation leaves the second probe to end the connect as `cancelled`, as it does now.

### 2.3 Where it runs (`server-steps.ts`, `connector.ts`)

1. **`ServerRequest`** gains `rootChannel: HostChannel`, documented as "the container's channel as root, for the
   volume's shared folders (contracts §5.2)".
2. **`connector.ts`** builds it next to `channel`: `execChannelOf(engine, prepared.containerId, 'root')`.
3. **`runServerSteps`.** When `installTree !== ''` (the volume is mounted), between the first probe and the second:
   - `const folders = sharedFoldersOf(profile, platformName)`;
   - `undefined` logs `the volume's shared folders were not prepared: the platform "<platformName>" is not a folder
     name` and goes on;
   - otherwise, `await prepareVolumeFolders(request.rootChannel, folders, logger, cancellation)`.

   Without the volume, the root channel is never used.
4. **Nothing else changes.** The install, the start and the commit folder stay the remote user's. The install
   script's own `mkdir` makes the commit folder with the user's umask (0755).

### 2.4 The install failure's log line (`server-steps.ts`)

`the server was not installed: ${transferredDetail(failure)}`, where:

```ts
/** The log text of a transfer that failed: its kind, then what it carries. */
function transferredDetail(failure: TransferFailure): string
```

| `failure.kind` | Text |
|---|---|
| `scriptFailed` | `scriptFailed (<status>)`, plus `: cannot write <path>: <error>` when `writeFailure` is set |
| `serverDownload` | `serverDownload (<cause>)`, or `serverDownload (<cause>, HTTP <status>)` with a status |
| `localDownload` | `localDownload (<cause>): <detail>` |
| `downloadTimeout` | `downloadTimeout (<reason>)` |
| `verification` | `verification (<mismatch>)` |
| `copy`, `channelFailed` | `<kind> (<failure.kind>): <failure.detail>` |
| `retriesExhausted` | `retriesExhausted (<attempts> attempts)`, plus `: lock <lockPath>` when set |
| `unpack`, `noResultBlock`, `cancelled` | the kind alone |

The user's case would now log `the server was not installed: scriptFailed (CreateInstallDirFailed): cannot write
/vscode/codium-server: mkdir: can't create directory '/vscode/codium-server': Permission denied`.

## 3. Files

| File | What |
|---|---|
| `packages/remote-containers/src/connect/volume-folders.ts` | new: §2.2 |
| `packages/remote-containers/src/connect/server-steps.ts` | `sharedFoldersOf`, `ServerRequest.rootChannel`, the step, `transferredDetail` |
| `packages/remote-containers/src/connect/connector.ts` | the root channel |
| `packages/remote-containers/test/unit/volume-folders.test.ts` | new: §4.1 and §4.2 |
| `packages/remote-containers/test/unit/server-steps.test.ts`, `connector.test.ts` | §4.3, §4.4 |
| `tests/acceptance/devcontainer-image/Dockerfile` | `RUN adduser -D -u 1000 node`, a non-root user like the user's image's |
| `tests/acceptance/containers-volume/` | new launch: §4.5 |
| `tools/acceptance-launches.ts`, `tools/acceptance.test.ts`, `tsconfig.json`, `eslint.config.ts` | register the launch as `containers-standdown` is registered: `{...CONTAINERS_LAUNCH, label: 'containers-volume', suite: 'containers-volume'}`, after `containers-no-proposals` |

## 4. Rows

### 4.1 The script, run in a real shell (`volume-folders.test.ts`)

The rows run `VOLUME_FOLDERS_SCRIPT` with `/bin/sh` in a temporary folder `T`, with the three variables set to
`T/s`, `T/s/bin` and `T/s/bin/p`. They run as the test's own user, and 0777 is checked with `stat` after the
script has run, so the umask can't hide a missing `chmod`.

| Name | Given | Expected |
|---|---|---|
| `F-0419 5.0 step 6: a fresh volume gets the three folders, each 0777` | nothing exists | the three exist, each mode 0777; the block is `Ok` with `server.created` listing the three in order |
| `F-0419 7.E4: an existing folder keeps its mode` | `T/s` exists, mode 0700 | `T/s` is still 0700; `bin` and `bin/p` are made 0777 inside it |
| `F-0419 7.E5: an existing tree is left as found` | all three exist, 0755, with a stray file in `T/s/bin/p` | the modes and the listing don't change; the block is `Ok` with `server.created` empty |
| `contracts §5.2: an existing file in a folder's place is left alone` | `T/s/bin/p` is a file | it's still that file, unchanged; the block is `Ok` and lists the other two |
| `contracts §5.2: a folder that can't be made is reported, and the first failure is the one kept` | `T/s` is a folder the script can't write into (mode 0500) | `CreateInstallDirFailed` with `writeFailedPath` `T/s/bin` and the `mkdir` error on one line; `T/s/bin/p` isn't made |

### 4.2 `prepareVolumeFolders` over a recording channel (`volume-folders.test.ts`)

| Name | Expected |
|---|---|
| `contracts §5.2: the script is the fixed text and the folders come in the environment` | one `runScript`: `script === VOLUME_FOLDERS_SCRIPT`, `environment` `SHARED_FOLDER_1`..`3` = the folders, `posixShell`, empty text input |
| one row per line of §2.2's table, named `contracts §5.2: <outcome> logs <the line's start>` | the exact log line, and the call returns |

### 4.3 C11's argv (`exec-channel.test.ts`)

| Name | Expected |
|---|---|
| `contracts §5.2: the root step's argv is the channel prelude only` | `execChannelOf(engine, 'cid', 'root').runScript` with the root step's request spawns argv that has `--user root` and `-e SHARED_FOLDER_1` … `-e SHARED_FOLDER_3` (names only), and no argument contains `/vscode` |

### 4.4 `server-steps.test.ts` and `connector.test.ts`

| Name | Expected |
|---|---|
| `contracts §5.2: with the volume, the root step runs after the first probe and before the second` | the root channel's one script is `VOLUME_FOLDERS_SCRIPT`, with the fixture's folders (`/vscode/fixture-server`, `…/bin`, `…/bin/linux-x64`); the user channel's scripts are probe, probe, …, as now; the call order across both channels is probe, root step, probe |
| `contracts §5.2: without the volume, the root channel is never used` | no script on the root channel |
| `contracts §5.2: a root step that fails doesn't fail the connect` | the root channel answers with a failure, and the connect still starts the server |
| `contracts §5.2: a platform that isn't a folder name skips the root step` | `sharedFoldersOf(profile, 'linux-x64;rm')`, `'Linux-x64'` and `''` are `undefined`; with a probe that reports such a platform, the root channel isn't used and the log has the "not a folder name" line |
| `contracts §5.2: the platform folder is the server tree's parent` | for `linux-x64` and `alpine-arm64`: `sharedFoldersOf(…)[2]` is `cacheFolders(…).serverTree` without its last segment |
| `F-0419 5.0 step 6: the install's failure logs its status and what it couldn't write` | an install that ends `CreateInstallDirFailed` with `server.writeFailedPath=/vscode/fixture-server` and an error logs `the server was not installed: scriptFailed (CreateInstallDirFailed): cannot write /vscode/fixture-server: <error>` |
| `contracts §5.2: each other transfer failure logs what it carries` | one table-driven row over §2.4's other kinds, each with its exact text |
| `contracts §5.2: the connector passes a root channel of the same container` (connector.test.ts) | the `runServer` request's `rootChannel` runs as `root` in `prepared.containerId` (through the fake engine's recorded argv) |

### 4.5 Acceptance (`tests/acceptance/containers-volume/volume.test.ts`, new launch)

**A precondition before the rows.** No running container of another run (`remote-oss.acceptance.run` label ≠
`HARNESS_RUN_ID`) mounts the `vscode` volume. If one does, the launch fails, naming those containers, and doesn't skip.
Then a helper container (`docker run --rm -v vscode:/vscode <the run's image> rm -rf /vscode/<serverFolder>`) clears the
product's server folder. The folder names come from the same lib-product and lib-server functions.

| # | Steps | Assertions |
|---|---|---|
| V1 | `devContainerFolder('volume-user', {name: 'Volume User', remoteUser: 'node'})`, then Reopen and wait until connected | connected, with `remoteName` `dev-container`; a root listing (`docker exec --user root <id> stat -c '%U %a' <folder>`) shows the three folders `root 777`, and the commit folder `node 755`; the log has `the volume's shared folders were created: <the three>` (F-0419 5.0 step 6, the user's trial) |
| V2 | Close V1's window. Clear the server folder again, then make `/vscode/<serverFolder>` `root 0700` with the helper container. Reopen `devContainerFolder('volume-closed', {name: 'Volume Closed', remoteUser: 'node'})` | the S034 dialog (F-0419 7.E4); afterwards `/vscode/<serverFolder>` is still `root 700`, `bin` and `bin/<platform>` are `root 777`, and there's no commit folder; the log has `scriptFailed (CreateInstallDirFailed): cannot write` and the path under `/vscode/<serverFolder>`. Then close the dialog and clear the server folder, so later launches install afresh |

**On main without this card,** V1 fails with the user's S034. That's how the defect is reproduced.

## 5. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- `acceptance`: F-0419 7.E4 (V2), and 5.0 step 6 for the row that cites it (V1).
- No new `unit` rows of their own: §4.1 to §4.4 cite the contract.

## 6. Gates and review

Run all gates, both new launch rows locally (`docker ps` first), and the VSCodium run. The PR title is
`remote-containers: C10's root step makes the vscode volume's missing shared folders 0777, and a failed install logs
why (card containers-25, #924)`. Request athena only; hermes assigns the peer.

## 7. Open rows (stop and report on #924)

1. **`docker exec --user root` is refused** in the harness (for example, a userns-remapped daemon). V1 then fails.
   Report the engine's error, and don't fall back to installing as root.
2. **The helper container can't clear the folders** because another of this run's containers holds a server open in
   them. Report which launch left it running.
