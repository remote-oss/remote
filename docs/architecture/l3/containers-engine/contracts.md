# Contracts: Remote - Containers, release 1

Status: ruled by athena (architect), 2026-10-14, for `brief-release-1.md` (D-87) and `components.md`. Cards cite these
sections. A builder doesn't change a contract; a question goes to the architect.

## 1. C11 exec channel (a lib-host `HostChannel`)

`execChannelOf(engine: EngineHost, containerId: string, user: string): HostChannel`

| Operation | Rule |
|---|---|
| `runScript` | `docker exec -i --user <user> [-e NAME …] <containerId> sh -c '<prelude>'` for `posixShell`, where `<prelude>` is lib-host's `preludeCommand(<script byte count>)` (`eval "$(dd bs=1 count=<n> 2>/dev/null)"`; measured on BusyBox ash, dash and bash; `sh -s` gives a script's input to the shell on ash and dash). No `powershell` in release 1 (`spawnFailed`). stdin carries exactly the script's bytes, then `ScriptInput` (a text, or a local file's bytes, unchanged), then it is closed; only the byte count is in argv. Each stdout line goes to `onLine` in order before the outcome settles. The exit status is the outcome's `status`. **Environment values are passed as `-e NAME` with the value in the `docker` process's own environment, never `-e NAME=value`**, so no value appears in `docker`'s argv or in `ps` (R-26). |
| `copyToHost` | streams a one-file tar archive of `localFile` into `docker exec -i --user <user> <containerId> tar -x -C <dir>`, renamed to `remotePath`'s basename (F-1402 §6: the archive is piped, never `docker cp` from a path the engine reads). A container without `tar` is `copyToolMissing`. |
| `identity` | the container id. |
| `platformHint` | `linux`. |
| `clientPathOnHost` | not implemented (a container never reads a client path directly). |

**Failures:** a `docker` that can't start is `spawnFailed`; a container that stopped or vanished during an operation
(exit 125, or a stderr line that **starts with** the Docker client's own `Error response from daemon:` or `Error: No such container:`, never a line that merely contains such words, since a script's own stderr is merged into the same stream (amended 2026-10-14, iris and triton on #808), or exit 137 or 143 with an empty stderr while one `docker inspect` through the same `EngineHost` says the container no longer runs; measured on Docker 29.9, amended 2026-10-14 on #808) is `channelClosed`; an abort is `cancelled`. The
channel never retries.

**The exec dialer:** `execDialer(engine, containerId, user, relayScriptPath): Dialer` (lib-forwarding's `Dialer`).
Each `dial({kind: 'port', port})` runs `docker exec -i --user <user> <containerId> <node> <relayScriptPath> <port>`,
where `<node>` is the installed server's own `node` (its install folder's root), and returns a `Duplex` over the exec
process's stdin and stdout. The relay script (shipped as text, written into the container by the install step beside
the server, owned by the remote user, mode 0644) connects to `127.0.0.1:<port>` and pipes both ways; it exits when either
side ends. `{kind: 'socket'}` is refused in release 1.

## 2. C10 container connector (a lib-authority `Connector`)

`containerConnectorOf(dependencies): Connector` for the `dev-container` family only.

**`connect(input)`, in order** (F-0408 §5.0; each step reports its phase through `onPhase`):
1. Decode the payload (§3). A malformed payload fails as `Failed{kind: 'malformedAuthority', silent: false}`.
2. C2's second pre-flight check (F-0201 5.0 step 5; the first check ran before the reload, in C6's flow, and showed
   its own F-0201 dialog). It shows nothing: a failure returns its detail id (S339, S104 or S144), and the connector
   returns `Failed{userAlreadyNotified: false}` with that reason, for C8 to present as F-0202's three-button dialog
   (amended 2026-10-14, containers-03 §6.1, #842).
3. C7: find, reuse, start or create the container (F-0409, F-0412, F-0415), with the rebuild intent if the payload
   carries one (F-0405 BR-17).
4. lib-server: probe, plan, transfer and start over C11 with the remote-containers policy row (§5), the licence gate
   (R-68) and `installTree` from V9 when the `vscode` volume is mounted.
5. The host listener: choose the local port with lib-forwarding's port search, preferring the server's container
   port (F-0502 BR-3); `openRelayTunnel` with C11's exec dialer and the target `{kind: 'port', port: <container
   port>}`. The log names both ports.
6. Return `Connected{address: {host: '127.0.0.1', port}, connectionToken, extensionHostEnv: {}, environmentTunnels: [],
   trusted: false}`. No tunnel factory and no tunnel features are given to core (brief ruling 1).

**Failures** (`Failed`): the dev-container family's kinds and their presentation are C8's (F-0410). A container that
stopped or was removed while connected answers `silent: true` (F-0502's "plain NotAvailable, no dialog"), and every
other failure is presented. `retryable` is true only for a lost transport of a container that still runs (F-0502's
reconnection rules). `diagnostics` never hold the token.

**`cancel()`** ends C3's and C2's processes and the exec relays. **`onTransportLost`** fires when the relay's exec
process ends while the container runs, and **`onTransportClosed`** when the container stops.

## 3. The `dev-container` payload (F-0501 BR-2a)

lib-authority's `containerCodec('dev-container', …)` carries the payload as an opaque string. remote-containers owns
its content:
- **The text:** lowercase hex of the UTF-8 JSON `{"hostPath": <folder>, "localDocker": false, "configFile": {"$mid": 1,
  "fsPath", "external", "path", "scheme"}}`, with `"settings": {"context": <name>}` when a non-default Docker context
  is current. Field order and spelling are F-0501's.
- **The rebuild intent** (C6 → C7) isn't part of the authority, which must stay stable (F-1102 §16). The reloaded
  window has another workspace identity, so its workspace state can't carry it. C6 stores it in the extension's
  `globalState` under a key of ours (R-27), keyed by the payload, with the time, before the reload. C10 takes it once at
  the start of the resolve's first attempt, clears it, and hands it to C7 in the container request, so C7 holds no
  editor state (amended 2026-10-14, containers-14 #891). An intent older than 5 minutes is cleared unused, so a rebuild never fires on
  a later, ordinary open.
- **The codec functions:** `devContainerPayloadOf(target) → string` and `devContainerTargetOf(payload) → target |
  malformed` are pure, with rows for every field and a malformed hex, JSON and shape.

## 4. Ports C1–C8 use (all faked in unit rows)

| Port | Operations | Real adapter |
|---|---|---|
| `EngineHost` (C2) | `run(argv, {stdin?, environment?, cancellation}) → {status, stdout, stderr}`; `spawn(argv, …) → a live process` | `child_process.spawn` with `shell: false` (F-0201) |
| `CliHost` (C3) | `run(arguments, onJsonLine, cancellation, onStdin?) → {kind: 'ran', result: <the first stdout line, or undefined>, status: <the exit status, or null after an abort>}`, or `{kind: 'spawnFailed', message}` when the process can't start; `onStdin`, when given, gets the writer for the CLI's stdin and the run's `StdinPresentation` once the host knows it, from the preload's `remote-oss-cli-preload` marker: `echoed` when the preload loaded `node-pty` (the run's reader is a pty, which echoes), `plain` when it didn't or no marker came (amended 2026-10-14 on #764, 2026-10-15 on remote-containers#124, 2026-10-16 for ADR-0011) | spawns `process.execPath` with `ELECTRON_RUN_AS_NODE=1` and `REMOTE_OSS_EDITOR_MODULES=<appRoot>/node_modules.asar` on the bundled CLI's entry script, after the preload, which removes both variables and resolves `node-pty` from the editor's folder for this process alone (ADR-0009, ADR-0011); the CLI's stdin is piped |
| `TrustPort` (C5) | `isTrusted()`, `request(message) → granted or not` | `vscode.workspace` (proposal `workspaceTrust`) |
| `ConfigFiles` (C4) | `exists`, `read`, `list` over workspace URIs | `vscode.workspace.fs` |
| notices and dialogs | as remote-ssh's surfaces: an adapter per surface, scripted in the harness | `vscode.window` |

## 5. Additions to other areas' contracts

1. **Transport contracts §5.0, the remote-containers column** (filled):
   - `downloadPlacement: clientOnly`;
   - `cache: kept`;
   - `verification: none` (until the room names one);
   - `environmentSetup: none`;
   - `requirementsCheck: bundledHelper` (containers-21, #903);
   - `allowedExtraStartOptions: [useHostProxy, forceDisableUserEnv]`: every server start runs in host-proxy mode
     (F-0503 BR-18, #122 Q6), so the container's extensions take the local proxy and, with `http.systemCertificates`, its
     certificates. Every start also passes `--force-disable-user-env` (amended 2026-10-19, proteus and athena on #737):
     core's server would otherwise source the remote user's login-shell environment itself (`buildUserEnvironment`,
     `getResolvedShellEnv` [oss]) whatever `userEnvProbe` says, so C3's probe is the only source (F-0416 BR-11 to BR-13),
     with `userEnvProbe: none` too;
   - `cleanup: onlyCurrentKeepLeftovers` (the volume is shared by every dev container);
   - `installMode: singleScript`;
   - `prefetch: none`.
2. **lib-server: `installTree`.** The install step takes an optional `installTree` (V9's `serverTree`). When it's set,
   the archive is extracted into `installTree` if that folder isn't a complete server, renamed into place only once
   extraction has finished (F-0503 5.0 step 5), and `<dataFolder>/bin/<commit>` becomes a symlink to it, created or
   kept (F-0503 BR-3). Without it, nothing changes. This is area A's code with area C's input, and it's carded with
   C10.
   **One tree per connection (amended 2026-10-14 on #806; narrowed the same day on containers-08's build):** C10 gives
   every lib-server script of a connection that takes the host lock or writes (install, start, cleanup) the same
   `installTree`, built once per connection, not once per step. Without it, such a script would take its host lock
   under `bin/<commit>`, a link into the shared tree (containers-05 R6). The probe takes no lock, and it's what
   reports the platform the tree's path needs (`cacheFolders(…, platform, true).serverTree`), so the first probe runs
   without it. When the `vscode` volume is mounted, a second probe with the tree reads `treeComplete`, and the plan
   reads that probe's facts. Without the volume there's one probe and no tree. C10's rows check `INSTALL_TREE` in the
   install, start and cleanup scripts, and its absence from the first probe.
   **The volume's shared folders (amended 2026-10-14, daedalus; the user's `scriptFailed` on a non-root image):** a fresh
   named volume is `root:root 0755`, so the remote user can't create the tree. When the volume is mounted, after the first
   probe and before the second, C10 runs one fixed script of ours over a C11 channel opened with `--user root`. For each of
   `cacheFolders`' server root, its `bin` and its `bin/<platform>` (for VSCodium `/vscode/codium-server/…`: our
   product-specific names keep our tree apart from the reference's on the shared volume, transport contracts #279) that
   **doesn't exist**, it runs `mkdir` and then `chmod 0777` on that folder. The extensions cache folder
   (`cacheFolders`' `extensionsCache`, not F-0419's observed `vscode-server/extensionsCache`) joins this step with the
   increment-2 card that uses it (corrected 2026-10-14 on #925). It never changes an existing folder's owner or mode, so F-0419 7.E4 and 7.E5 hold as
   observed: a root-only `0700` tree stays unusable, and the install then fails as observed. This is F-0419 5.0 step 6's
   layout.
   - `<platform>` is the first probe's `templatePlatformOf`, checked against `^[a-z0-9-]+$` and passed as a script
     parameter, never interpolated unchecked.
   - The script reports through our result block (ADR-0010).
   - A refused or failed root step is logged and the connect goes on, so the remote user's install fails or succeeds on
     its own terms.
   - The install, the start and the commit folder stay the remote user's (0755): F-0419 calls the owner reference data
     for its layout decision, and a later container's other user can read and run it.
   - Running the whole tree install as root is rejected, because it would leave root-owned files in the user's
     `~/.vscode-server`.
3. **lib-authority:** nothing new. `Failed.silent`, `Connected.trusted` and the container codec already exist (dossier
   Q3 and Q6 are answered by them).

## 6. Rows every card keeps

- **R-26:** no token, password or secret in any argv **we** build (`docker`, `docker exec`, the CLI's) or in any log
  line or message of ours. A unit row per spawn site checks the argv against the secrets of its fixture.
  - **The CLI's own `docker run`** (athena, 2026-10-14, dike on #764): the dev container CLI passes the configuration's
    `containerEnv` to `docker run` as `-e NAME=value`. That process is the CLI's, the values are the user's own
    configuration, and changing it would mean forking the CLI (ADR-0009). It's a **documented deviation**: those values
    are briefly in that process's argv on the user's machine, and they're in the container's configuration anyway
    (`docker inspect`). The reference, which bundles the same CLI, does the same. It goes in the release notes.
  - **What C3 passes on is ours, and is scrubbed:** before any CLI log event, error message or description reaches our
    log, a failure or a dialog, C3 replaces each occurrence of the value of every editor environment variable that the
    chosen configuration references as `${localEnv:VAR}` or `${env:VAR}` (values of 8 characters or more) with that
    reference text. lib-log's standard redaction then applies, as to every line. It's a pure function with rows: a token
    in a `Run:` line and in `Command failed:` is replaced, a short value isn't, and an unreferenced variable isn't
    touched.
- **ADR-0010:** a value from a container's shell is read only between our own whole-line markers. The engine's and the
  CLI's output is read only in their documented, anchored forms (prefixes, the JSON result line, `docker inspect -f`).
  Each parser has a noisy-neighbour row.
- **No shell:** every engine and CLI spawn has `shell: false`, and a row proves a value with spaces and quotes reaches
  the program unchanged (F-0201).
- **Pure parts first:** the payload codec, the label matching (F-0409's tiers), the CLI argument builder and the
  JSON-line parser are pure modules with their own rows before any adapter is written.
