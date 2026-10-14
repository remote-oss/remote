# Task card containers-04: C3, the dev container CLI bridge

Issue: #763. Remote - Containers release 1, slice 1 (milestone 0.4). Builder: iris, after containers-02 (#757).
Size: L (about 3 agent-days).

**Binding documents:**
- ADR-0009, which this card follows to the letter, and ADR-0005;
- `brief-release-1.md` ruling 6;
- `components.md` C3 and boundaries 3 and 4;
- `contracts.md` §4 (`CliHost`) and §6;
- the dossier's §3 and §4 (the six deviations);
- D-88 (athena, register 2026-10-14: the CLI's licences and how its files ship).

**Specs** (`remote-oss/remote-containers`):
- F-0408 (#27);
- F-0409 (#23), BR-2's labels;
- F-0411 (#33), BR-1;
- F-0412 (#29), BR-3;
- F-0415 (#32), 5.0 steps 6 to 10;
- F-0416 (#63);
- F-0304 (#48), BR-1, BR-5a, AC-27 and AC-66.

**Depends on:**
- containers-01 (#759): the package's build and its `dist/`. Only §2's packaging and §6.4's VSIX row need it. If #759 hasn't merged when the rest passes, open the PR without those two, and add them in a second PR.
- C3 takes `dockerPath` as a string for `--docker-path`. It doesn't use `EngineHost` (containers-02, `src/engine/engine-host.ts`). C3's own spawn goes through `CliHost`.

**What containers-01 (#759, card PR #762) fixes for this card:**
- **Entry:** `src/extension.ts` with `activate(context)`. C3 adds nothing there: it registers no command, and its `handlers` factory isn't touched. C7 and C10 build the bridge with `cliBridgeOf(...)`, from `context.globalStorageUri` (§3.5) and `context.extensionPath` (§3.4).
- **Settings:** C3 reads **no setting** and contributes none. `dockerPath` and `logLevel` arrive as values in `CliTarget`. The card whose code reads `dev.containers.dockerPath` (C2) or `dev.containers.logLevel` adds that setting with its reader (tooling-31: no placeholder contributions).
- **Logging:** C3 writes its own lines (the §4.3 guard, §3.5 failures to remove a file) to the `Logger` it's given, the "Dev Containers" channel's, carried as `ServedWindow.logger`. CLI events go to the caller through `onEvent`.

Everything below was measured on this lab machine on 2026-10-14 with `@devcontainers/cli` 0.89.0, Node 24 and Docker 29.9.0 (records in the appendix). Source cited `[devcontainers-cli]` (v0.89.0).

## 1. What C3 is

C3 drives the pinned dev container CLI as a spawned program and gives C7 and C10 typed results.
- **What it never does:** show UI, decide reuse, start or create (that's C7's, boundary 4), or re-implement anything the CLI does (boundary 3).
- **What it is made of:** three pure modules (the argument builder, the override pre-pass and the line parser) and two adapters (`CliHost` and the override file store).

## 2. The CLI, pinned and shipped unchanged (ADR-0009 decisions 1 and 4; D-88)

**The pin.** `packages/remote-containers/package.json` gains `"@devcontainers/cli": "0.89.0"` under `dependencies`, an exact version. Update `pnpm-lock.yaml` with `pnpm install`.

**What the package is.** `[devcontainers-cli] package.json`:
- `license` MIT;
- no `main`, no `exports`;
- `bin` `devcontainer.js`;
- `engines.node` `>=20.0.0`;
- **zero `dependencies`**, because the program is pre-bundled into `dist/spec-node/devContainersSpecCLI.js` (1.7 MB).

**Shipping it (D-88).** These five files are copied **byte for byte** into `packages/remote-containers/dist/devcontainers-cli/`, keeping their relative paths:
- `devcontainer.js`;
- `dist/spec-node/devContainersSpecCLI.js`;
- `scripts/updateUID.Dockerfile`, which the CLI reads for F-0416's `-uid` image;
- `LICENSE.txt`;
- `ThirdPartyNotices.txt`.

Our esbuild never bundles or touches them.
- **`tools/build.ts`:** a package can declare `copiedFiles` in a small map in the tool, keyed by package folder. remote-containers' entry is `{from: '@devcontainers/cli', files: [the five], to: 'dist/devcontainers-cli'}`. The build resolves the package folder with `createRequire(...).resolve('@devcontainers/cli/package.json')` and uses `copyFileSync` for each file. A missing source file fails the build, naming it.
- **`packages/remote-containers/.vscodeignore`:** add `!dist/devcontainers-cli/**` and `!dist/cli-preload.js` beside containers-01's entries. If containers-01 made no `.vscodeignore`, create it like remote-ssh's.
- **The VSIX:** `tools/package-extensions.ts` already rejects `node_modules` paths. The copied folder isn't one.
- **The surface lint** already exempts `LICENSE.txt` and `ThirdPartyNotices.txt` (D-88).

**The licence check, done for this card** (verify it again in the PR):
- the package is MIT, with no runtime dependency, so `pnpm check-licences` sees one MIT package;
- its `ThirdPartyNotices.txt` lists 85 bundled components: 62 MIT, 15 ISC, 4 BSD-2-Clause, 2 BSD-3-Clause, 1 0BSD and 1 Python-2.0 (argparse).
- Every one is in `tools/licences.ts`'s `ALLOWED_LICENCES`. Nothing is blocked (D-88).
- In the PR, list the count per licence from `grep -E '^[@a-zA-Z0-9._/-]+ [0-9][^ ]* - ' ThirdPartyNotices.txt`.

**The entry to spawn:** `dist/devcontainers-cli/devcontainer.js`, which only does `require('./dist/spec-node/devContainersSpecCLI')`.

## 3. The modules

All of them are in `packages/remote-containers/src/cli/`.

### 3.1 `cli-arguments.ts` (pure): the argument builder

```ts
export interface CliTarget {
  workspaceFolder: string;      // the host folder (the payload's hostPath)
  configFile: string;           // the chosen devcontainer.json, absolute
  dockerPath: string;           // dev.containers.dockerPath, as C2 uses it
  idLabels: readonly string[];  // 'name=value', from C7 (F-0409 BR-2)
  overrideConfigFile?: string;  // set by the pre-pass when it changed something (§3.2)
  mountWorkspaceGitRoot: boolean;
  mounts: readonly string[];     // '--mount' values, from C7 (the vscode volume, containers-06)
  logLevel: 'info' | 'debug' | 'trace';
}
export interface UpOptions { removeExistingContainer: boolean; buildNoCache: boolean; }
export function upArguments(target: CliTarget, options: UpOptions): string[];
export function runUserCommandsArguments(target: CliTarget, containerId: string): string[];
export function readConfigurationArguments(target: CliTarget, containerId?: string): string[];
```

**The rules.** The order of the list is fixed, so the rows compare whole lists:
1. The subcommand: `up`, `run-user-commands` or `read-configuration`.
2. `--workspace-folder <workspaceFolder>`, `--config <configFile>`, then `--override-config <file>` when it's set.
3. One `--id-label <label>` per entry of `idLabels`, in order.
4. `--docker-path <dockerPath>`.
5. `--mount-workspace-git-root=false` only when `mountWorkspaceGitRoot` is false.
   - **Release 1 always passes `true`**, which keeps the CLI's default: the git-root mount of F-0411 BR-1, `/workspaces/<basename of the git root>`. The `false` form is for F-0302 BR-14 and F-0301 §6.5 (the dossier's deviation 5), which come later.
   - The builder supports both, with a row for each.
6. `--log-level <logLevel>` and `--log-format json`.
7. For `up` only:
   - one `--mount <value>` per entry of `mounts`, in order (containers-06: release 1 passes
     `type=volume,source=vscode,target=/vscode`); `run-user-commands` and `read-configuration` take none;
   - `--skip-non-blocking-commands` (§4.2);
   - `--remove-existing-container` when `removeExistingContainer` is set;
   - `--build-no-cache` when `buildNoCache` is set.
8. For `run-user-commands`: `--container-id <containerId>`.
9. For `read-configuration`:
   - `--container-id <containerId>` when given;
   - `--include-merged-configuration`.

Each value is its own array element (`shell: false`), so a path with spaces or quotes reaches the CLI unchanged (contracts §6).

**What's never built:**
- `--remote-env` and `--secrets-file`: release 1 has no value to pass this way. `--remote-env name=value` would put values in argv (R-26), so no card may add it without a decision.
- `--workspace-mount-consistency`: the CLI applies it only on non-Linux hosts (F-0411 §15), and release 1 is Linux only.

### 3.2 `override-pre-pass.ts` (pure): the second mechanism of ADR-0009

`overrideText(configText: string, editorEnvironment: Readonly<Record<string, string | undefined>>): string | undefined`

**What it does.** It parses the raw JSONC text of the chosen configuration and rewrites string values in place, keeping comments and layout. It returns the new text, or `undefined` when nothing changed.
- When nothing changed, no override file is written and no `--override-config` is passed.
- When something changed, C3 writes the text as the override file (§3.5) and passes `--config <the real file>` with `--override-config <that file>`. `[devcontainers-cli] src/spec-node/configContainer.ts` reads the content from the override file and keeps `configFilePath` the real file, so relative paths, such as a Dockerfile's, still resolve from the real folder.

**Dependency:** `jsonc-parser` 3.3.1 (MIT, an exact version, bundled by our esbuild). Use `parseTree`, `findNodeAtLocation` and `modify` + `applyEdits` on string nodes only. The new dependency is for athena's design check.

**The rewrites:**
- **Deviation 1 (F-0304 BR-5a, AC-66):**
  - In every string value, each `${localEnv:VAR:default}` or `${env:VAR:default}` whose `VAR` is set to `''` in `editorEnvironment` is replaced by the literal `default` text.
  - An unset `VAR`, a non-empty one, and a reference without a default are left for the CLI.
  - The `default` text is everything after the second `:` up to the closing `}`, as the CLI parses it.
- **Deviation 2 (F-0304 BR-1, AC-27):** inside `initializeCommand` only (a string, each string of an array, or each string value of an object), each `${containerEnv:…}` reference is replaced by `''`.
  - Elsewhere, `${containerEnv:…}` is left for the CLI, which resolves it in the container.

**The other deviations go through other mechanisms** (ADR-0009 Consequences: a row each):

| Deviation | Mechanism | Where |
|---|---|---|
| 1. an empty `localEnv` gives the default | pre-pass | this module |
| 2. `${containerEnv}` in `initializeCommand` is empty | pre-pass | this module |
| 3. `localEnv` is the editor's resolved environment | the spawn environment (the CLI's own input surface, with flags) | §3.4: the CLI runs with the extension host's `process.env`, minus `ELECTRON_RUN_AS_NODE` (§3.4) |
| 4. the title's `name` needs a second pass | post-processing | `readConfiguration({containerId})`, §4.3, after the container exists. The caller of F-0504's title is C10 |
| 5. the workspace mount | flags | `--mount-workspace-git-root` (§3.1, rule 5) |
| 6. attach configurations | not in release 1 | — |

### 3.3 `cli-lines.ts` (pure): the parser of the CLI's output

**stdout:** the CLI writes exactly one JSON line, the result, then exits (`[devcontainers-cli] src/spec-node/devContainersSpecCLI.ts`: `process.stdout.write(JSON.stringify(result) + '\n')` before `finishBackgroundTasks` and `process.exit`).

```ts
export type UpResult =
  | {kind: 'up'; containerId: string; remoteUser: string; remoteWorkspaceFolder: string}
  | CliFailure;
export type RunUserCommandsResult = {kind: 'done'} | CliFailure;
export interface ConfigurationResult {
  kind: 'configuration';
  configuration: Record<string, unknown>;   // the substituted devcontainer.json, as the CLI gives it
  workspaceFolder: string;                  // workspace.workspaceFolder
  workspaceMount: string | undefined;       // workspace.workspaceMount
  mergedConfiguration: Record<string, unknown> | undefined;
}
export type CliFailure =
  | {kind: 'lifecycleFailed'; hook: string; message: string; containerId: string | undefined}
  | {kind: 'buildFailed'; message: string}
  | {kind: 'pullFailed'; message: string}
  | {kind: 'setupFailed'; message: string; description: string; containerId: string | undefined}
  | {kind: 'noResult'; status: number | null}          // the process ended without a result line
  | {kind: 'malformedResult'; field: string}            // a field C3 reads is missing or of the wrong type
  | {kind: 'spawnFailed'; message: string}
  | {kind: 'cancelled'};
```

**Reading a result** (ADR-0009 decision 3):
- `outcome: 'success'` → the success type. A missing or non-string `containerId`, `remoteUser` or `remoteWorkspaceFolder` (for `up`) is `malformedResult` naming the field.
- Unknown fields are ignored: 0.89.0 adds `ociAuthDiagnostics`.
- `outcome: 'error'` is classified in this order:
  1. `description` matching `^(\S+) from devcontainer\.json failed\.$` → `lifecycleFailed` with that hook name (recorded: `onCreateCommand from devcontainer.json failed.`);
  2. `message` starting `Command failed: docker buildx build` or `Command failed: docker build ` → `buildFailed`;
  3. `message` starting `Command failed: docker pull ` → `pullFailed`;
  4. anything else → `setupFailed`.

  C8 turns these into F-0410's dialogs. C3 shows nothing.
- `run-user-commands`' success line is `{"outcome":"success","result":"done"}` → `{kind: 'done'}`.

**stderr:** one JSON event per line (`--log-format json`). Recorded types and their fields:
- `text`: `level`, `timestamp`, `text`;
- `start` and `stop`: `stop` adds `startTimestamp`;
- `raw`: an optional `channel`, such as `postCreate`;
- `progress`: `name`, `status` (`running` or `succeeded`, and `failed` per the source), an optional `stepDetail`, and `channel`.

`parseLogLine(line)` gives:
- `{kind: 'progress', name, status, detail?}` for `progress`;
- `{kind: 'log', level, text, channel?}` for the others;
- `{kind: 'log', level: 3, text: line}` for a line that isn't JSON. Node prints its own warnings there: the recorded `(node:…) [DEP0169] DeprecationWarning: …` and `Error: Command failed: …` stack lines.

It never throws. The `text` is kept unchanged, ANSI codes included, because the log terminal of F-0415 5.0 step 10 shows them.

### 3.4 `node-cli-host.ts` (adapter): the `CliHost` of contracts §4

`nodeCliHost(paths: {node: string; preload: string; entry: string}, editorEnvironment): CliHost`, where:
- `node` is `process.execPath`;
- `entry` is `<extension>/dist/devcontainers-cli/devcontainer.js`;
- `preload` is `<extension>/dist/cli-preload.js` (below).

**`run(cliArguments, onJsonLine, cancellation)`:**
1. Spawns `node` with `['--require', preload, entry, ...cliArguments]`. The options are `shell: false`, `stdio: ['ignore', 'pipe', 'pipe']`, and `env` `{...editorEnvironment, ELECTRON_RUN_AS_NODE: '1'}`.
2. Calls `onJsonLine({stream, line})` for every line of either stream, in order.
3. Resolves `{result: <the first stdout line>, status}` when the process exits.
4. An abort kills the process tree (`SIGTERM`, then `SIGKILL` after 5 s) and resolves with `status: null`.

**The preload** (`packages/remote-containers/src/programs/cli-preload.ts`, built by `tools/build.ts`'s existing `src/programs` rule into `dist/cli-preload.js`): its one statement is `delete process.env.ELECTRON_RUN_AS_NODE`.
- **Why it's needed:** Electron reads the variable once, at start. Without the preload, the CLI's children would inherit it: `initializeCommand` on the host, and the value of `${localEnv:ELECTRON_RUN_AS_NODE}`. An Electron program those start, such as `code`, would then run as plain Node. helper-04 (#734) fixes the same leak for the ssh helper.
- With the preload, deviation 3 holds exactly: the CLI sees the editor's environment.

This file and `cli-preload.ts` are the only spawn sites of C3 (contracts §6 rows below).

### 3.5 `override-files.ts` (adapter): the override file

`overrideStoreOf(storageFolder: string): OverrideStore`, with `interface OverrideStore {write(text: string): Promise<string>; remove(path: string): Promise<void>}`.
`storageFolder` is `context.globalStorageUri.fsPath`.

**Writing it:** `write` writes `<storageFolder>/cli-overrides/<16 random hex>.json`, with the folder at mode 0700 and the file at 0600 (ADR-0009 decision 5), and gives its path. The text may hold substituted environment values.

**Removing it:** `remove(path)`. C3 removes the file in a `finally` after the run, whether the run worked, failed or was cancelled. A failed removal is logged at warn, naming the path, and doesn't change the result.

### 3.6 `cli-bridge.ts`: what C7 and C10 call

```ts
export interface CliBridge {
  up(target: CliTarget, options: UpOptions, onEvent: (event: CliEvent) => void, cancellation: AbortSignal): Promise<UpResult>;
  runUserCommands(target: CliTarget, containerId: string, onEvent: (event: CliEvent) => void, cancellation: AbortSignal): Promise<RunUserCommandsResult>;
  readConfiguration(target: CliTarget, containerId: string | undefined, cancellation: AbortSignal): Promise<ConfigurationResult | CliFailure>;
}
export function cliBridgeOf(host: CliHost, files: {readText(path: string): Promise<string>}, overrides: OverrideStore, editorEnvironment: Readonly<Record<string, string | undefined>>, logger: Logger): CliBridge;   // Logger from lib-log
```

`CliEvent` is `parseLogLine`'s output. Each call does the following:
1. Reads the config text and runs the pre-pass (§3.2).
2. Writes the override file if the pre-pass changed anything.
3. Builds the arguments (§3.1) and runs them through `host.run`.
4. Parses stdout's first line (§3.3) and streams stderr through `onEvent`.
5. Removes the override file.

A host `spawnFailed` or an abort maps to `spawnFailed` or `cancelled`. A process that ends without a stdout line is `noResult`.

## 4. The rules C7 builds on

### 4.1 Labels

C7 gives `idLabels`. Release 1's are exactly `devcontainer.local_folder=<workspaceFolder>` and `devcontainer.config_file=<configFile>` (F-0409 BR-2). C3 passes them through unchanged. The CLI also infers the same two labels when none are given (`[devcontainers-cli] src/spec-node/utils.ts`), but C3 always passes them.

### 4.2 `waitFor` and the background stage (F-0415 5.0 steps 6 to 9)

**What the CLI does by default.** Without `--skip-non-blocking-commands`, `up` runs every lifecycle command before its result line (measured: a 3 s `postStartCommand` delayed the result by 3 s). With the flag, `up` stops after the `waitFor` target, `updateContentCommand` by default (`[devcontainers-cli] src/spec-common/injectHeadless.ts`, `runLifecycleHooks`).

**What release 1 does:**
- **`up` with `--skip-non-blocking-commands`.** That's the window's connect: it resolves at the `waitFor` target, as F-0415 step 6 requires.
- **Then C7 calls `runUserCommands(target, containerId, …)`** without awaiting it for the connect. This is the background stage: `postCreateCommand`, `postStartCommand` and `postAttachCommand`, whose markers keep the already-run commands from running again.
- **Measured:** after `up --skip-non-blocking-commands` (0.57 s, with a `postCreateCommand` and a 3 s `postStartCommand`), `run-user-commands` ran `postCreateCommand` then `postStartCommand`, and its result `{"outcome":"success","result":"done"}` came at 3.28 s.

### 4.3 The process after its result line (ADR-0009 Context)

In every recorded run, the process exited within 10 ms of its result line. `CliHost.run` resolves on exit, and `up` resolves when `run` does. A process that still runs **30 s** after its result line is ended as on cancel, logged at warn as `the dev container CLI kept running after its result; ended`, and the result already read is returned. This is a guard; no recorded run reaches it.

## 5. Contract rows (contracts §6, ADR-0009 Check)

- **R-26:** a fixture environment holds `GITHUB_TOKEN=s3cr3t-token`, and the config has `"containerEnv": {"T": "${localEnv:GITHUB_TOKEN}"}`. The rows check:
  - the argv `nodeCliHost` spawns, through a recording spawner, holds neither `s3cr3t-token` nor the `GITHUB_TOKEN` name;
  - no `onEvent` text C3 produces itself holds it either. The CLI's own log lines are passed through as they are, and C10's log sink is where secrets are scrubbed, as for remote-ssh.
- **No shell:** the spawner options have `shell: false`. A `workspaceFolder` of `/work/a b/"q"` reaches argv as one element, unchanged.
- **The pin:** a manifest row asserts `dependencies['@devcontainers/cli'] === '0.89.0'`, with no range characters (`^`, `~`, `>`, `<`, `*`, `x`, space).
- **The only importer:** no file under `packages/remote-containers/src` except `src/cli/` mentions `@devcontainers/cli` or `devcontainers-cli`. It's a unit row that reads the sources, as `docs.test.ts` finds its package.

## 6. Rows

All under `packages/remote-containers/test/unit/` unless named otherwise. Name each row `C3: …`, or with the AC it proves.

### 6.1 Argument builder (`cli-arguments.test.ts`)

- `upArguments` for the release-1 target: the whole list, in §3.1's order, including `--skip-non-blocking-commands`, `--log-format json` and the two id labels.
- The same with `removeExistingContainer` and `buildNoCache`: the two flags appear after `--skip-non-blocking-commands`.
- `mountWorkspaceGitRoot: false` adds `--mount-workspace-git-root=false`; `true` adds nothing.
- `overrideConfigFile` set adds `--override-config <file>` right after `--config`.
- `mounts` with two values gives two `--mount` pairs in `up`'s list, in order, and none in the other two builders;
  an empty `mounts` gives none.
- `runUserCommandsArguments` ends with `--container-id <id>`, and has no `--skip-non-blocking-commands`.
- `readConfigurationArguments` with and without a container id: `--include-merged-configuration` in both.
- No builder ever emits `--remote-env` or `--secrets-file`: the result of every builder row is scanned.

### 6.2 Pre-pass (`override-pre-pass.test.ts`)

**Deviation 1:**
- `"name": "${localEnv:V:dflt}"` with `V: ''` gives `"name": "dflt"`, cited `F-0304 AC-66`.
- The same with `${env:V:dflt}`.
- With `V` unset: unchanged, so `undefined`.
- With `V: 'x'`: `undefined`.
- Without a default (`${localEnv:V}`, `V: ''`): `undefined`.
- A default with a `:` inside (`${localEnv:V:a:b}`) gives `a:b`.

**Deviation 2:**
- `initializeCommand` as a string, an array and an object, each with `${containerEnv:P}`: replaced by `''`, cited `F-0304 AC-27`.
- `${containerEnv:P}` in `remoteEnv`: left.

**Keeping the file:**
- Comments and trailing commas survive: the output text still has the line comment.
- A text that doesn't parse gives `undefined`. The CLI then reports the parse error itself, so C3 adds no message.

### 6.3 Parser (`cli-lines.test.ts`)

Over the appendix's recorded lines, stored as `test/fixtures/devcontainers-cli-0.89.0/*.jsonl` with the scratch paths replaced by `/work/ws1` and so on:

**Results:**
- `up` success → `up` with the three fields; `ociAuthDiagnostics` is ignored.
- A missing `remoteUser` → `malformedResult` naming the field.
- The recorded `onCreateCommand` failure → `lifecycleFailed` with hook `onCreateCommand` and the container id.
- The recorded Dockerfile build failure → `buildFailed`.
- The recorded pull failure → `pullFailed`.
- A made-up error line with another message → `setupFailed`.
- `run-user-commands` success → `done`.
- `read-configuration` → `configuration` with `workspaceFolder` `/workspaces/ws1`.

**Log lines:**
- Each recorded `type` → its event.
- A `progress` line with `stepDetail` → `progress` with `detail`.
- The recorded Node deprecation line → a `log` at level 3, whole.
- Text with ANSI codes is kept unchanged.

### 6.4 Adapters and the bridge

**`node-cli-host.test.ts`, over a recording spawner:**
- the argv is `[node, '--require', preload, entry, …]`;
- `env.ELECTRON_RUN_AS_NODE === '1'`;
- `shell: false`;
- the stdout and stderr lines arrive in order;
- an abort sends `SIGTERM`, then `SIGKILL` after 5 s (fake timers).

**`override-files.test.ts`, on a temp folder:**
- the folder is at mode 0700 and the file at 0600;
- `remove` deletes the file;
- a second `write` gives another name;
- a failing `remove` logs one warn line.

**`cli-bridge.test.ts`, over a fake `CliHost` and fake files:**
- a run whose pre-pass changes nothing writes no override file;
- one that changes something writes it, passes it, and removes it after success, after a `lifecycleFailed`, and after a cancel;
- exit with no stdout line → `noResult`;
- the 30 s guard ends the process and returns the result (fake timers).

**The preload**, a real child process: `node --require dist/cli-preload.js -e 'console.log(process.env.ELECTRON_RUN_AS_NODE ?? "absent")'` with the variable set prints `absent`.

**The VSIX** (`tools/package-extensions.test.ts`, or the package's manifest tests; needs #759):
- the built `packages/remote-containers/dist/devcontainers-cli/` holds the five files;
- `ThirdPartyNotices.txt` and `LICENSE.txt` are in `vsce ls`'s list (D-88's build row);
- `devContainersSpecCLI.js` has the same sha256 as the installed package's file (unchanged, D-88).

### 6.5 The real-CLI row (local Docker)

**Where it lives:** `tests/acceptance/containers-cli/cli-bridge.test.ts`, run by a new script `test:acceptance:containers-cli`: `pnpm build && mocha --no-config --extension ts --spec 'tests/acceptance/containers-cli/*.test.ts'`, as `test:acceptance:server` is.
- **Skipping without Docker:** a `before` hook that runs `docker version` skips the suite (`this.skip()`) when it fails, so a machine without Docker passes it.

**The steps.** It runs the real bridge (`nodeCliHost` with the built `dist/` files) on a temporary folder with:

```json
{"name": "c3-${localEnv:C3_EMPTY:dflt}", "image": "alpine:3.22", "postCreateCommand": "echo created > /tmp/c3-created"}
```

with `C3_EMPTY=''` in the editor environment, and the id label `remote-oss.c3-row=<run id>` added to the two of §4.1:
1. `up` → `kind: 'up'`, `remoteUser` `root`, and `remoteWorkspaceFolder` `/workspaces/<folder name>`;
2. `readConfiguration(target, containerId)` → `configuration.name` `c3-dflt` (deviation 1, end to end);
3. `runUserCommands` → `done`, and `docker exec <id> cat /tmp/c3-created` prints `created`;
4. a second `up` gives the same `containerId`.

**Cleanup:** in `after`, `docker rm -f` every container with the run's id label. Image tags stay.

## 7. Gates and review

**Gates:** typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-licences, check-coverage and coverage, with every file of `src/cli/` at 100 % and the remote-containers ratchet at 100/100/100. Also run `pnpm test:acceptance:containers-cli` on this lab machine: Docker is here. Paste its output.

**The PR:**
- Title: `remote-containers: C3, the dev container CLI bridge (card containers-04, #763)`.
- It opens with the `needs-verification` label: proteus checks that the VSIX holds the five CLI files unchanged and that the CLI runs from an installed VSIX.
- themis or triton reviews; athena gives the design check, including the `jsonc-parser` dependency.

## 8. Open rows (stop and report on #763)

1. The installed `@devcontainers/cli` isn't byte-identical to the 0.89.0 tarball: compare the sha256 of `devContainersSpecCLI.js` with the npm registry's tarball. Don't continue on a different build.
2. A recorded result line in your run differs from the appendix in a field C3 reads. Report it, and don't adapt the parser by guess.
3. `jsonc-parser`'s `modify` can't keep a comment adjacent to a rewritten value. Report the text.
4. `--require` with `ELECTRON_RUN_AS_NODE=1` doesn't run the preload in the editor's Electron. Measure it in the containers harness launch once it exists, or in a plain launch. If it fails, report it and don't drop the preload.

## Appendix: recorded 0.89.0 lines (lab machine, 2026-10-14)

The paths were shortened by hand; the fixtures replace the real scratch paths with `/work/<folder>`.

**`up` success, create, with `--skip-non-blocking-commands`.** Result at 0.57 s, exit at 0.57 s, status 0:
```
{"outcome":"success","containerId":"025da4eefd37f83611b94277ed7215eb31dc77ae6a22822bd58b3000871c6c92","remoteUser":"root","remoteWorkspaceFolder":"/workspaces/ws1","ociAuthDiagnostics":{"authLookupWouldBeBlocked":false,"registryRedirectWouldPreventCredentialForwarding":false,"authServerRedirect":false}}
```

**`up` reused** the same id: result at 0.18 s.

**`run-user-commands`.** Result at 3.28 s, status 0:
```
{"outcome":"success","result":"done"}
```

**`up`, failures** (status 1):
```
{"outcome":"error","message":"Command failed: docker pull remote-oss-no-such-image:0","description":"An error occurred setting up the container."}
{"outcome":"error","message":"Command failed: docker buildx build --load --build-arg BUILDKIT_INLINE_CACHE=1 -f /tmp/devcontainercli-<user>/container-features/0.89.0-<n>/Dockerfile-with-features -t vsc-ws3-845b6439fd2a5c8f313ee70d9000e744e70729793063567193c05049a64997ae --target dev_containers_target_stage …","description":"An error occurred setting up the container."}
{"outcome":"error","message":"Command failed: /bin/sh -c exit 4","description":"onCreateCommand from devcontainer.json failed.","containerId":"fcf59aa9b58801c6a6eeb0b70b92c6f887a54a64b0117f6666e059afa4616a15"}
```

The build failure's `description` is the generic one; the build's own error is in the raw lines:
```
{"type":"raw","level":3,"timestamp":1791946381354,"text":"ERROR: failed to build: failed to solve: process \"/bin/sh -c exit 3\" did not complete successfully: exit code: 3\n"}
```

**stderr events** (from `up` and `run-user-commands`):
```
{"type":"text","level":3,"timestamp":1791946302031,"text":"@devcontainers/cli 0.89.0. Node.js v24.21.0. linux 7.2.7-200.fc44.x86_64 x64."}
{"type":"start","level":2,"timestamp":1791946302576,"text":"Run: docker ps -q -a --filter label=c3probe=1"}
{"type":"stop","level":2,"timestamp":1791946302586,"text":"Run: docker ps -q -a --filter label=c3probe=1","startTimestamp":1791946302576}
{"type":"raw","level":3,"timestamp":1791946305954,"text":"\u001b[1mRunning the postCreateCommand from devcontainer.json...\u001b[0m\r\n\r\n","channel":"postCreate"}
{"type":"progress","name":"Running postCreateCommand...","status":"running","stepDetail":"echo created > /tmp/c3-created","channel":"postCreate"}
{"type":"progress","name":"Running postCreateCommand...","status":"succeeded","channel":"postCreate"}
(node:1456880) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
```

**`read-configuration --include-merged-configuration`** (stdout, abbreviated):
```
{"configuration":{"name":"c3-probe","image":"alpine:3.22",…,"configFilePath":{"$mid":1,"fsPath":"/work/ws1/.devcontainer/devcontainer.json","path":"/work/ws1/.devcontainer/devcontainer.json","scheme":"vscode-fileHost"}},"workspace":{"workspaceFolder":"/workspaces/ws1","workspaceMount":"type=bind,source=/work/ws1,target=/workspaces/ws1,consistency=cached"},"mergedConfiguration":{…}}
```
