# Area C interface contracts

- Status: first version for the lead's review (deliverable 2)
- Date: 2026-10-06
- Author: `remote-architect-worker-3`; lead: `remote-architect`
- Binds: ADR-0003, ADR-0005 (the CLI as a dependency, R-76), ADR-0006 (the product profile), the container view's
  remote-side scripts rule (§2), R-28 (no telemetry), R-47, R-58, R-68; the area A contracts H1, V2–V9, W2–W3; the
  area B contracts as amended by PR #31; the ADR drafts in `adr-drafts/` (CLI bridge, engine abstraction).
- Component ids are those of `components.md`.

How to read a contract: operations with inputs, outputs and failures; rules with their feature ids; what the
component must never do. Shapes are named fields, not code. "Reason" is a string id from the spec (S-nnn) that the
UI port renders from the string tables. Feature ids are remote-containers' unless a repo is named.

Order: the pure components needed by the F-0201 brief first (C2a, C2b, C2f), then the processes around them, then
the CLI bridge and the connection.

---

## 1. Engine (C2)

### C2a program-locator (pure)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `locate` | setting value (verbatim), which setting (`dockerPath` or `dockerComposePath`), base folder or none, workspace file folder or none, trusted flag, execution-host kind (`local`, `wsl`, `remote`), host OS | a spawn target: the value as a bare name for PATH lookup, or an absolute path | `relativeNotAllowed` (relative value in an untrusted, remote or empty window: treated as not found, F-0201 BR-1, Q-trust-relative), `windowsScriptRejected` (`.cmd`/`.bat`, F-0201 7.E15) |

Rules:
- No shell, no `~`, no `$VAR` or `%VAR%`, no argument splitting (F-0201 BR-1).
- A relative value resolves against the `.code-workspace` folder in a multi-root window, else the single folder
  (F-0201 Q-multiroot, preferred form).
- `locate` is called once per attempt; a connected container window keeps the target recorded at connect until
  reload (F-0201 BR-2).

Never: read settings itself, touch the file system.

### C2b endpoint-merger (pure)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `merge` | the four sources (`containers.environment`, `docker.environment`, `docker.host`/`docker.certPath`/`docker.tlsVerify`, process environment), read without a resource scope; the host OS | the four variables `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CERT_PATH`, `DOCKER_TLS_VERIFY` with their values or absent, and the endpoint label for the window title (` @ <context>` or ` @ <host>`, none for the default) | `dashHost` (an `ssh://` host starting with `-`, S197) |
| `bindToWindow` | the endpoint recorded in a container window's authority | the same four variables | none; a dead endpoint shows as a check failure, never a fallback (F-0205 BR-19) |

Rules:
- Precedence: `containers.environment` over `docker.environment` over the `docker.*` settings, then settings over the
  process environment (F-0205 BR-13).
- Only the four names are copied; never `PATH`, `HOME`, `DOCKER_CONFIG` or any other entry (F-0205 BR-18).
- A settings `DOCKER_HOST` applies even when a named context is current (F-0205 Q1); the bridge passes it as a
  variable, never as `--context`.
- Variable names compare case-insensitively on Windows.

### C2c execution-host (port)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `kind` | none | `local`, `wsl` (distro name), `remote` (decoded outer hop) | none |
| `spawn` | spawn target, arguments, environment additions (C2b's four variables, askpass variables), stdin text, cancellation | a child with output streams and exit status | `notFound`, `spawnFailed`, `cancelled` |
| `toHostPath`, `toFolderPath` | a path | the path in the other form (`C:\…` ↔ `/mnt/c/…`, `\\wsl.localhost\<d>\…` ↔ `/…`) | `unmappable` |
| `refreshPath` | none | the host's PATH re-read (Windows after an install, F-0203 BR-10) | none |

Implementations: local (C2c, here), WSL distro (area D, F-0207, F-1301), the window's remote host over `lib-host`
(C19, F-1302). The choice per attempt follows F-0207 BR-15/18/19 and F-1301 BR-9: a folder on a WSL share or a WSL
window uses its distro; else `executeInWSL` decides; else local.

### C2d engine-runner (process)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `check` | query (`clientVersion`, `structuredVersion`, `fullVersion`, `serverVersion`, `buildxVersion`, `composePluginVersion`, `composeStandaloneVersion`, `info`, `contextList`), C2a target, C2b variables | stdout text and exit status | `timeout` (after the timebox; the child is killed, F-0201 BR-14, Q5), the C2c failures |
| `run` | engine operation (a typed list: `ps`, `inspect`, `start`, `stop`, `kill`, `rm`, `volumeLs`, `volumeCreate`, `volumeRm`, `events`, `logs`, `exec`, `run`, `composeUp`, `composeConfig`), arguments as fields | output stream and exit status | the C2c failures; never a timeout (pulls, builds, runs are unbounded) |
| `askpass` | the SSH question text | the answer from the UI port, remembered per window by question text until reload (F-0205 BR-14, BR-15) | `cancelled` |

Rules:
- The timebox applies to `check` only; default 60 s, configurable within 30–60 s.
- `askpass` is wired through `SSH_ASKPASS` and `SSH_ASKPASS_REQUIRE=force` in the child's environment; it also works
  on native Windows (F-0205 7.E7, AC-7d).
- No caching across attempts (F-0201 BR-9, F-0202 BR-4).

Never: interpret stderr (C2f does), show UI other than through `askpass`'s port.

### C2e preflight (process; decisions pure)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `firstCheck` | the attempt's context (window kind, execution host, command) | `pass` with the resolved Compose program, or a C2f verdict | `cancelled` |
| `secondCheck` | as above, after the reload | `pass`, or a C2f verdict for the resolve-time dialog | `cancelled` |
| `ensureCacheVolume` | the setting `cacheVolume` | the `vscode` volume exists in the engine the CLI talks to | engine failure kinds |

Rules:
- Order per F-0201 §5.0: trust (C5) before the first check; the first check before any picker; the second check after
  the reload; then the volume.
- Compose: the engine's plugin first; the standalone program only when the plugin answers nothing; neither gives
  `composeMissing` (F-0201 BR-4). Resolved again on every attempt (Q4).
- The structured version's server API below 1.35 gives `apiTooOld`, which offers Ignore and is not remembered
  (F-0201 7.E6). Buildx and server-version failures never gate.
- A slow check shows the daemon-start progress after about 2 s (F-0202, S332), with Cancel abandoning the open.

### C2f failure-classifier (pure)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `classify` | spawn error code or exit status, stderr text, which check, execution-host kind, host OS, setting value | a verdict: `missingCli` (with the dialog variant by location: local, remote, Windows, WSL), `permission`, `daemonDown` (with `startable` when the wording matches F-0202 6.2), `sshPermission`, `sshTooManyAuth`, `apiTooOld`, `composeMissing`, `other`; plus the detail string id (S079 dropped when the value is exactly the default) | none |

Rules: matching is case-insensitive on the phrases the specs name; stdout is ignored (F-0201 §5.0 step 3); the
first-check and resolve-time dialog shapes differ (F-0202 BR-1) and the verdict says which.

### C2g daemon-starter, C2h installers, C2i host-requirements

- `startDaemon(verdict)`: only macOS and Windows; only when Docker Desktop is installed at its default location and
  not already running (F-0202 Q3); re-checks every 5 s, six times, or up to 5 minutes on Windows after a fresh start
  (Q2 as amended). Output `answered` or `gaveUp`; Cancel ends the open.
- `installDocker(os, cpuArchitecture)`: Linux opens the documentation link; Windows and macOS download the installer
  for the architecture, run it, report S141 or S137 (F-0203 BR-9). The Windows "already installed" prompt only when
  C2a resolves the configured CLI.
- `compare(daemonFigures, requirements)`: CPUs and memory compared, storage echoed, GPU per `gpuAvailability`;
  output `met` or the S244/S140 dialog values (F-0206). The memory parser accepts the F-0206 grammar only.

---

## 2. Dev container CLI bridge (C3)

### C3a argument-builder (pure)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `forUp` | workspace folder (host form), config file, id labels, rebuild intent (`none`, `rebuild`, `rebuildNoCache`), expect-existing flag, skip-post-create flag, GPU mode, dotfiles settings, remote environment, Compose program, engine target, override file | the argument list | `unsupportedConfigName` (config not named `devcontainer.json` or `.devcontainer.json`: attach configurations take `set-up`) |
| `forReadConfiguration` | workspace folder, config file, container id or none, include-merged flag, include-features flag | the argument list | none |
| `forSetUp` | container id, config file or none | the argument list | none |
| `forRunUserCommands`, `forBuild`, `forTemplatesApply`, `forFeaturesInfo`, `forOutdated`, `forUpgrade` | per operation | the argument list | none |

Rules:
- Always `--log-format json`, `--docker-path`, `--docker-compose-path` from C2, explicit `--id-label` pairs
  (`devcontainer.local_folder`, `devcontainer.config_file`), and `--mount-workspace-git-root=false` (F-0301 §6.5,
  F-0302 BR-14).
- The `vscode` volume is added with `--mount` when C7 decided to mount it (F-0419).
- Paths are passed in the execution host's form (C2c).

### C3b override-pass (pure plus a file port)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `prepare` | the raw configuration text, the editor's resolved environment, the container's environment when known, the operation | an override configuration file, or none when no deviation applies | `unreadable` (the C4d validations run first) |

Deviations handled (dossier §4): empty `${localEnv:VAR:default}` gives the default (F-0304 BR-5a);
`${containerEnv}` in `initializeCommand` is empty (F-0304); `localEnv` is the editor's resolved environment, also
passed as the spawn environment; the window-title `name` gets the second pass even without a container. Each
deviation is a named rule with its own unit test against a recorded CLI output.

### C3c output-parser (pure)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `parseResult` | the stdout line | `upSucceeded {containerId, remoteUser, remoteWorkspaceFolder, composeProjectName?, configuration?, mergedConfiguration?}`, `buildSucceeded {imageName}`, `readConfiguration {configuration, workspace, featuresConfiguration?, mergedConfiguration?}`, or `cliFailed {message, description, containerId?, disallowedFeatureId?, didStopContainer?, learnMoreUrl?}` | `noResult` (exit without a line: `read-configuration` failures print a stack only) |
| `parseLogEvent` | one stderr line | `progress {name, status}`, `text {level, text}`, `start`/`stop` with timings, or `raw` | none (an unparsable line is `raw`) |

Rule: the result line is not the end of the process; background lifecycle commands keep it alive
(`src/spec-node/devContainersSpecCLI.ts`).

### C3d cli-runner (process)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `run` | argument list, environment, execution host, log sink, cancellation | C3c's result, then process exit | `cliMissing` (bundle not found on the host, C19 provisioning), `spawnFailed`, `cancelled` |

Rules:
- The CLI runs with the editor's own Node (`ELECTRON_RUN_AS_NODE`) on the local host; on a remote host with the
  Node of the installed server (C19); never a Node we ship.
- `NODE_PATH` points at the editor's `node_modules` so the CLI can load the editor's `node-pty`; without it the CLI
  falls back to plain pipes (ADR draft "CLI bridge" rule 4).
- Cancellation kills the whole process tree; a killed client aborts a remote build (F-1302 BR-10).
- Log lines go to C1c through `lib-log`'s redaction; secrets passed with `--secrets-file` never reach the log.

Never: parse output itself, show UI, retry.

---

## 3. Exec channel (C11)

H1 implemented over the engine's exec, one implementation per family:

| H1 operation | `docker`/`podman` | `kubectl` | Apple `container` |
|---|---|---|---|
| `runScript` | `exec -i -u <user> <id> sh` with the script on stdin | `exec -i <pod> -c <container> -- sh` | `exec -i <id> sh` |
| `copyToHost` | a tar stream into `exec -i … tar -x -C <dir>` (F-1402 §6) | same through `kubectl exec` | same |
| `identity` | container id | namespace, pod, container | container id |
| `platformHint` | `linux` | `linux` | `linux` |

Failure mapping onto H1's closed kinds: exec program missing → `spawnFailed`; container not running or gone →
`channelClosed`; no `tar` in the container → `copyToolMissing`; tar exit ≠ 0 → `copyFailed` with its message;
cancellation → `cancelled`. `timeout` only where the caller asks for one.

Exec dialer (for `lib-forwarding` W2 and for C16): opens a byte stream to a port or a Unix socket inside the
container through an `exec -i` running a relay script with the installed server's Node. The relay scripts are text
shipped in the VSIX (container view §2); one script, parameterised by target.

Never: retry, interpret script output, publish a container port.

---

## 4. Container connector (C10)

C10 is the `connector` B's resolver host calls (B's contract 3.2), one per family; `exec` has a formatter and no
resolver (PR #31).

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `connect` | decoded target (F-0501 payload, optional outer hop), attempt, reconnection flag, window id, phase sink, cancellation | A's `Connected` shape plus `trusted` (true for attach, pod and volume windows, F-0106 BR-13) | A's `Failed` shape (below) |
| `cancel`, `revealDetails` | connection | as A's | none |
| `transportEvents` | connection | `transportLost` when the exec dialer drops, `transportClosed` when the container stops | none |

Steps of `connect` (F-0502 §5): C2 second check (C2e) → match or create (C7, or C12's set-up for attach) → C9 lease →
A's V2 probe, V3 plan with the cache facts, V4 transfer with client download, V6 licence gate, V7 start, all over
C11 → W2 window tunnel over the exec dialer → machine settings and MCP servers written (F-0506) → `Connected`.

`Failed` mapping, first match wins:

| Situation | kind | retryable | silent | userAlreadyNotified |
|---|---|---|---|---|
| Server process gone, pod deleted, container paused (F-0502) | `serverStart` or `unreachable` | true | false | false |
| Container stopped or removed (F-0502) | `unreachable` | false | true | false |
| Setup failure classified by C8 (F-0410) | `serverInstall` or a C8 kind | false | false | true (C8 showed the dialog) |
| Licence declined (R-68) | `licenceDeclined` | false | false | false |
| No server source (F-1402 rule 4) | `noServerSource` | false | false | false |
| Cancelled | `cancelled` | false | false | false |

Rules:
- A reload during connect abandons all work; `connect` is idempotent, and rebuild intent travels in persisted one-shot
  state keyed by window id, never in a running process (F-0408 6.8).
- Reconnection logs "Reconnection attempt N" (S286); core owns the retry schedule.
- The `devPort` settings are equivalent (F-0502).

Never: show the F-0410 dialog itself (C8 does), set `isTrusted` (B does from `trusted`).

---

## 5. Lifecycle, recovery, shutdown

### C7 container-lifecycle

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `findContainer` | id labels, legacy labels | the newest container of the first tier that matches, with its state (F-0409 three tiers) | engine failures |
| `bringUp` | configuration (C4d), found container or none, rebuild intent, cache-volume decision, phase sink | `upSucceeded` from C3, after restart, recreate or create; paused gives `paused` for C8 | `cliFailed`, the extension's own pre-checks (S004, S356, S412), `cancelled` |
| `probeEnvironment` | container, remote user | the user environment within 10 s or none (F-0416) | none raised |

Rules: a stopped container restarts silently, a removed one is recreated silently, a changed configuration reuses
the container (F-0409); the rebuild teardown removes the old container before the build and does not restore it
(F-0405); the build output is scanned for S343 (F-0412).

### C8 recovery

`decide(failure, window facts)` returns the dialog variant (detail S018, S019 or S034; S420 for CLI subcommands
outside `up`/`build`), the edit button by folder location, whether "Rebuild Container" is offered (a container
object exists) and, for volumes, the recovery-container plan (bootstrap image, volume and config labels for reuse).
Pure; the dialog and the quick pick are rendered through the UI port (F-0410).

### C9 shutdown-manager

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `lease` | window id, profile, container or Compose project, shutdown action, window kind (attach windows count but hold no obligation) | a lease, renewed while the window lives | none |
| `release` | lease, reason (`closed`, `reloading`, `switched`, `failed`) | none | none |
| `check` (in the watchdog) | the registry | after about 10 s, stop (`docker stop`) or kill (Compose `runServices`) what no live lease holds | engine failures, logged |

Rules (F-0417): never stop a container another window uses; a Compose project's shared containers stop with the last
window; a reloading window counts from the start of its reload; a failed window does not count; Switch Container
releases the left container. The watchdog lives outside every window's process tree (AC-43) on `lib-helper`
(lead's ruling 9; contract drafted by area A).

---

## 6. Trust gate (C5) and Remote Explorer data (C15)

### C5 trust-gate

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `requireTrust` | command, folder, window state | `trusted` or `declined`; for Open Folder the prompt runs after the window switch has begun (F-0106 BR-2) | none |
| `confirmKind` | `attach` or `clone` | `confirmed` or `declined`; remembered per profile (BR-4, BR-5) | none |
| `forcedTrust` | window kind | true for attach, pod and volume windows (BR-13) | none |

Rules: the dialogs never depend on Docker detection (BR-8); `security.workspace.trust.enabled=false` silences only
core's dialog (BR-10); revoking trust reloads the window (BR-14). The prompt uses `requestWorkspaceTrust` when the
`workspaceTrust` proposal is granted (question to the room through remote-development, lead's ruling 4).

### C15 explorer-data

Three tree data providers registered into the `remote` view container (`contribViewsRemote`, F-0906): rows of
`targetsContainers` grouped as F-0901 states, the `detailsContainers` rows (F-0903), and the Dev Volumes rows
(F-0904). Data from C2d (`ps`, `inspect`, `volumeLs`) and C4b; refresh on the commands and on the Docker context
change watch (F-0205 BR-17); row labels unique per view (the runner finds rows by label). Row actions (F-0902) and
Clean Up (F-0905) go through C2d; Explore and Clone actions hand over to C13.

---

## 7. What area C needs that is not yet in another contract

- **A, Failed shape:** the boolean `silent` (sent to worker-1; B's rule 2a already maps it, PR #31).
- **A, V4:** a `clientOnly` download mode (F-1402 §6).
- **A, V9:** a pure function of product, commit, platform and "volume mounted at `/vscode`" (F-0419 layout).
- **A, `lib-helper`:** leases, a control socket, death rules, a registry shared across profiles (C9).
- **B:** nothing further after PR #31.
- **D:** C2c's WSL implementation and the path mapping.
