# Area A interface contracts

- Status: complete for the lead's review (deliverable 2), replacing the draft merged in PR #8. The tunnel client
  section (T) depends on the `[cli]` reading noted there.
- Date: 2026-10-06
- Author: `remote-architect-worker-1`; lead: `remote-architect`
- Binds:
  - ADR-0003, ADR-0004, and ADR-0005 and ADR-0006 as revised on 2026-10-06 (no CLI download, CLI for Tunnels only,
    no VS Code entry in the server table);
  - R-28 and F-3905 (no telemetry, no payload lines in logs);
  - R-47, R-58, R-68 with R-80 (the source-based licence test alone);
  - R-79 (one hang rule), R-83 (servers start with telemetry off), R-86 (F-3908: no deliberate failure), D-60
    (clauses that need a lab run are marked "provisional (lab)" and keep their defaults).
- Component ids are those of `components.md`.

How to read a contract: each lists the operations with their inputs, outputs and failure states, the rules with
their feature ids, and what the component must never do. Shapes are named fields, not code. "Reason" is the exact
user-visible text B shows in F-2601's dialog; the specs' string ids (STR:Snnn) name it. Feature ids without a repo
are remote-ssh's.

Order: the pure components come first, because they are the candidates for the first coding briefs. Those are
lib-host, lib-product, and the pure parts of lib-ssh (S2, S5, S6, S4's parser and writer, S1's decision).

---

## 1. lib-host

### H1 host-channel

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `runScript` | script text, interpreter (`posixShell`, `powershell`), environment additions, input (text, or a local file streamed as bytes to standard input), cancellation | output lines as a stream, then the exit status | `channelClosed`, `spawnFailed`, `timeout`, `cancelled` |
| `copyToHost` | local file, remote path, cancellation | done | `copyToolMissing`, `copyFailed` (with the tool's message), `channelClosed`, `cancelled` |
| `identity` | none | the key that names the host in locks and records (SSH: the host string as written; containers: the container id; WSL: the distro name) | none |
| `platformHint` | none | `linux`, `macOS`, `windows` or `unknown` | none |
| `clientPathOnHost` (optional) | a local file | a host path where the host reads that file directly, or `none` | none: an error means `none`; an implementation that omits the operation means `none` |

Rules:
- A missing local file for a streamed input fails with `spawnFailed` before anything runs.
- `clientPathOnHost` exists for WSL, which reads client files through the drive automount (remote-wsl F-6301 6.7).
  SSH and `docker exec` return `none`, and callers then use `copyToHost`.
- A channel never interprets script output.
- A channel never retries by itself.
- Failure kinds are closed: an implementation maps every error to one of the six kinds and keeps the original
  message as detail.
- The library ships a recording fake that replays scripted outputs. lib-server's tests run on it alone.

Never: depend on any transport, the editor API, or lib-server.

---

## 2. lib-product

### P1 profile-reader

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `readProfile` | the text of `<appRoot>/product.json` (the editor adapter reads the file once per session) | a profile with these fields: `applicationName`, `version`, `commit`, `quality`, `release` (empty when absent), `serverApplicationName`, `serverDataFolderName` (fallback `.vscode-server` only where a spec says so, F-0503), `dataFolderName`, `tunnelApplicationName`, `urlProtocol`, `serverDownloadUrlTemplate`, `serverLicense`, `serverLicenseUrl`, gallery | `unreadable` (the extension cannot run its resolvers; the log names the path) |

Rules:
- Commit and quality may also come from `env.appCommit` and `env.appQuality` under `resolvers`. The file is the
  source of record (F-3903 rule 2).
- Nothing outside lib-product reads `product.json` (ADR-0006).

### P2 template-expander

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `expand` | template, values for `os`, `arch`, `commit`, `quality`, `version`, `release`, `applicationName`, allowed names | an absolute URL | `unknownPlaceholder` with its name; `notHttpUrl` |

Rules:
- `${release}` expands to the empty string when the product has none (F-3902 rule 3).
- `${applicationName}` is allowed only where the extension's policy lists it (ADR-0006 decision 2).
- A value with no placeholder is used as one URL for every host.

### P3 archive-resolver

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `resolveServerArchive` | profile, host platform tokens (`os`, `arch`), the extension's override policy, the override value with the layer it came from | the URL, the step that produced it (`override`, `productTemplate`, `builtInTable`) and the facts V6 needs (URL host, `serverLicense` empty or not) | `noSource` (the `applicationName` and the setting key); `invalidOverride` (the setting key and the problem from P2) |

Override policies (one table entry per extension, ADR-0006 decision 5):

| Extension | Key | Layers | Forms |
|---|---|---|---|
| remote-ssh | `remote.SSH.serverDownloadUrlTemplate` | user layer of the default profile only (F-3902 rule 1) | template |
| remote-containers | `remote.serverDownloadBaseUrl` | any layer (F-1402 rule 4) | template, or a base URL to which `/commit:{commit}/server-{platform}/{quality}` is appended |
| remote-wsl | from the WSL drafts | to be added | to be added |

Rules:
- "Set" means the allowed layers hold a value, never "differs from the default" (F-3902 rule 1).
- A bad product template is logged and skipped; resolution falls through (ADR-0006 as revised).
- The built-in table matches `applicationName` exactly. It has two entries, `codium` and `codium-insiders`, and no
  entry for VS Code (ADR-0006 decision 2).

### P4 product-table

A data module holding:
- the two built-in table entries with their release repositories and asset shape (F-3902 rule 1(c), F-1402);
- the licence hosts of F-3902 rule 11(i);
- the VSCodium release prefixes of rule 11(ii);
- the licence rules `clientLicence` and `sourceBased` and the active set, evaluated by `classifyLicence`;
- the dev tunnels service domain, once the Tunnels ruling lands.

It is the only place these strings may appear (ADR-0006 Check). P4 has no operations; P3 and V6 read it.

---

## 3. lib-ssh, pure parts

### S2 argument-builder

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `validateTarget` | decoded target (alias, or host name with optional user and port) | ok | `invalidHost` or `invalidUser` with the reason STR:S119, S120, S121 or S122 and the character (F-2205 BR-2, BR-3) |
| `buildInvocation` | target, purpose (`connection`, `tunnel`, `oneShot`, `copy`), the settings snapshot (`configFile`, `connectTimeout`, `permitPtyAllocation`), `remoteCommandInEffect` (decided by R1), effective options from S4, forwards, remote program | program, argument list, environment additions | none (validation runs first) |

The argument rules:
- `-F <file>` when `configFile` is set, with `~/` expanded against the editor's home (F-2201 BR-4).
- `-T` on the connection `ssh` unless `permitPtyAllocation` is truthy (F-2106).
- `-o ConnectTimeout=<n>` on every `ssh` of an attempt, the tunnel `ssh` included, only when the host sets none
  (F-2105). Never a `ServerAlive*` option.
- The bootstrap goes in on standard input with no remote command in shared mode; in terminal mode the remote program
  is `sh` (F-2105, F-2704).
- `-o RemoteCommand=none` when the effective options carry a `RemoteCommand` and `remoteCommandInEffect` is false
  (F-2107). S2 does not decide whether the feature is in effect; R1 does (F-2107 BR-1).
- `-v` at the level S5 needs (F-2109 BR-3).
- `-D 127.0.0.1:<port>`, `-L <port>:127.0.0.1:<remote port>` or `-L <port>:<socket path>` (F-2104 BR-1, F-2410).
- The host and user go in as their own arguments.
- `scp` gets the same `-F` and the alias (F-2405 BR-6).

Never: add `ControlMaster`, `ControlPath`, `ControlPersist`, host-key, identity or proxy options; quote for a shell.

### S5 stderr-classifier

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `classify` | ssh's error lines of one run, in order; the run's exit status; the purpose; the connection mode (`shared` or `terminal`) | a failure kind (`unreachable`, `timeout`, `authentication`, `hostKeyChanged`, `hostKeyRejected`, `forwardingDisabled`, `channelClosed`, `brokenPipe`, `unknown`), the reason, and hints (message, status, mitigations, resources) | none |

The rules are the specs' tables, by reference:
- the network reasons, their substring and case rule, and their priority when several lines match (F-2603);
- "administratively prohibited" and the MITM warning (F-2604); S107 only in terminal mode (F-2604 BR-6);
- "Connection closed." as `channelClosed` (F-2604 7.E1);
- the broken pipe as `brokenPipe` (F-2603 7.E3): R1 asks B for the platform pick again and, if the next run fails
  the same way, fails with an empty reason;
- the timeout wordings S137 and S140 (F-2105);
- the changed-key refusal S111, in shared mode only (F-2305 BR-6): the mode is an input, never guessed;
- the last "Permission denied (...)" line with its `user@host: ` prefix removed (F-2306 BR-13, F-2601 BR-3).

An unrecognised failure yields `unknown` with an empty reason, which B shows as STR:S030. "Could not resolve host"
stays unrecognised, and a session that ends early without a recognised line is `unknown` (F-2105, F-2109). Of
ssh's debug1 lines, only "Server host key" is kept for the log (F-2109).

Never: log or return prompt answers.

### S6 prompt-classifier

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `classifyPrompt` | the prompt text ssh passes to askpass, the display host | a surface (`fingerprintPick`, `continuationPick`, `maskedInput`) with title or placeholder and the answer mapping | none |

The rules, first match wins:
1. The fingerprint pattern of F-2305 BR-2, with the placeholder rules of F-2305 BR-3.
2. The Offending/Matching continuation lines of F-2305 BR-2.
3. The passphrase question of F-2307 BR-3, shown as STR:S064 with {0} empty until F-2307 Q3 is decided.
4. The password order of F-2306 BR-2.
5. Otherwise the raw text in a masked input.

### S4 config-model (parser and writer)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `filesInEffect` | settings snapshot, home folder | the ordered files (user file, then the system file and its includes; or the one configured file) with their existence | none |
| `listHosts` | the file texts through a file port | host entries in the order and with the inclusion rules of F-2202 BR-1 to BR-20 | `parseError` with file and reason (F-2201 BR-8) |
| `effectiveOptions` | target | `ConnectTimeout`, `RemoteCommand`, `HostName`, `User`, `Port`, `LocalForward` as OpenSSH computes them (`ssh -G` through S3) | `parseError` |
| `parseAddHostCommand` | the text the user typed | a Host block (keywords mapped by F-2204 BR-5) | one of the four errors of F-2204 |
| `writeHostBlock` | file text, block | the new file text with the block placed by F-2204 BR-10 to BR-17 | none (B's command writes the file) |

Rules:
- `listHosts` reads fresh on every call and never caches (F-2202).
- The match-back of F-2202 BR-21 uses `effectiveOptions` until the spec answers dossier question 5.

### S1 client-locator (decision part)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `candidates` | `remote.SSH.path` user value, PATH, platform | the ordered candidates (F-2101 BR-1) | none |
| `judge` | a candidate's `-V` exit status and output | accepted or rejected (F-2101 BR-4, BR-5) | none |

Rules:
- Empty output with exit status 0 is rejected (F-2101 Q2, recommended (b)).
- `scp` is looked for beside the accepted `ssh`, then on PATH (F-2405 BR-6).
- Nothing is remembered between runs (F-2101 BR-10).

---

## 4. lib-ssh, process and UI parts

### S3 session-spawner

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `spawn` | an S2 invocation, the askpass environment from S7 | a session: output and error streams, input stream, exit status | `spawnFailed`, `clientVanished` |

Rules:
- The editor's environment is passed unchanged (F-2101 BR-7). Standard input is a pipe; `SSH_ASKPASS_REQUIRE` is
  never set.
- The connect wait is the timeout plus 2 seconds. It starts at the spawn in shared mode and at the platform choice in
  terminal mode. It pauses while a prompt is open, restarts after each answer, counts time spent in an external
  askpass, and stops at the first setup report (F-2105, F-2308 BR-5). The maximum for `ConnectTimeout 0` is an R-79
  bound.

### S7 prompt-ui

Provisional (lab) for Windows clients: the surfaces and askpass route under Windows OpenSSH wait for the run of
F-2305, F-2306 and F-2307 Q1 (D-60).

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `askpassEnvironment` | lease or session, `remote.SSH.externalSSH_ASKPASS` | variables that make `ssh` call our askpass endpoint; none when the external askpass applies (F-2309) | none |
| `answer` | S6's surface, owner or mirror | the answer | `cancelled` |

Rules:
- The user's external askpass is kept only in shared mode, never in socket mode. An empty `SSH_ASKPASS` counts as
  unset. No `DISPLAY` is injected (F-2309).
- Picks close on focus loss; masked inputs do not (F-2305 BR-5, F-2306 BR-3).
- In shared mode, a re-prompt carries ssh's "Permission denied, please try again." line (F-2306 BR-4).

Never: store or log an answer or its length.

### S8 login-terminal

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `runInTerminal` | invocation, name (`install`, `SSH Tunnel`, `Uninstall VS Code Server`), `remote.SSH.showLoginTerminal` | a session over the terminal: output events, input, end | trust refused (core) |

Rules:
- The terminal is hidden until revealed. With the setting on, it is revealed and every question stays in it. With
  the setting off, F-2306's prompts become S7 inputs, read through `terminalDataWriteEvent` and answered by sending
  the text (F-2308 BR-2, BR-4).
- It is never created trust-exempt (F-3903 rule 1).

### S9 connection-server

Provisional (lab) for Windows clients: named pipes, a script as `SSH_ASKPASS`, and the detached helper's survival
wait for the run of F-2102 Q1 (D-60).

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `acquire` | host string, target, window identity, cancellation | a lease: SOCKS port, the shared record (remote port, OS, architecture, temp folder, connection token) when one exists, and S10 over this connection | S2 and S3 failures; `cancelled`; login failed (kind and reason from S5) |
| `release` | lease | none | none |
| `kill` | host string | done, silently, also when nothing runs (F-2102 BR-7) | none |
| `events` | lease | `waitingForOtherWindow`, `ownerChanged`, `transportLost` | none |

Rules:
- One helper per host string, exactly as written (F-2102 BR-6).
- The record is written only after the connection completes.
- `acquire` is not used when `remote.SSH.useLocalServer` is off or socket mode is on (F-2102 BR-10, F-2410).

Lifetime, ownership and how it dies are in [local-connection-server.md](local-connection-server.md) and the ADR
draft `adr-drafts/local-connection-server.md`.

### S10 ssh-host-channel

H1 implemented over S9 or S3:
- `runScript` runs `sh` or `powershell` per V1's interpreter (the login-shell mode is dossier question 10).
- `copyToHost` uses `scp` through S2 and S3, run as a hidden task so that core's trust gate applies (F-2405).
- `identity` is the host string.
- `platformHint` comes from R4.

---

## 5. lib-server

### 5.0 The server policy record

Each extension passes lib-server one flat data record. lib-server never branches on which extension calls it. A
policy that the record cannot express is a new component, never a flag (lead, 2026-10-06). Values that come from a
setting at run time are filled in by the extension's adapter before the call.

| Field | Values | remote-ssh | remote-containers | remote-wsl |
|---|---|---|---|---|
| `downloadPlacement` | `hostFirst` with `auto`, `always` or `off`; `clientFirstThenHost`; `clientOnly` | `hostFirst`, from `remote.SSH.localServerDownload` (F-2405) | `clientOnly`: the client machine downloads and copies into the container (F-1402) | `clientFirstThenHost`: a silent `wget` fallback in the distro (F-6301 BR-1, BR-7) |
| `cache` | `none`; `kept` | `none` (F-3902 rule 6) | `kept` (F-0503 host cache) | `kept`, shared per user across windows and editor instances (F-6301 BR-4, BR-5, BR-14) |
| `verification` | ordered list from `headerHash`, `lengthOnly`, `none` | `none` until the room names one | open (F-1402 Q4) | `headerHash`, then `lengthOnly` (F-6301 BR-6, Q3) |
| `environmentSetup` | a host path to source before install and start, never on reuse; or none | none | none | the distro's server-env-setup (F-6303 BR-1 to BR-5) |
| `requirementsCheck` | `none`; `serverBundled` (the server's own check after unpack) | `serverBundled` (F-2401) | `serverBundled` (F-0503) | `serverBundled` plus the Alpine libstdc++ probe (F-6302) |
| `allowedExtraStartOptions` | a list from an allow-list | none | none | `fileWatcherPolling` for WSL 1 (F-6601) |
| `cleanup` | `keepNewest(n)`; `onlyCurrentRemoveLeftovers`; `onlyCurrentKeepLeftovers` | `keepNewest(5)` (F-2413 BR-9) | to be set by area C | stepwise: `onlyCurrentRemoveLeftovers` (F-6304 BR-8, AC-9); single script: `onlyCurrentKeepLeftovers` (BR-7) |
| `installMode` | `singleScript`; `stepwise` | `singleScript` | `singleScript` | from `remote.WSL.experimental.scriptLessStartup`, read by the WSL package and passed in (F-6304) |


### V1 bootstrap-scripts

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `scriptFor` | step (`probe`, `install`, `start`, `kill`, `uninstall`, `cleanup`), interpreter, install mode, parameters (data folder, launcher, commit, URL, proxy variables, lock method and place, downloader policy, environment setup, start options) | script text under 8192 characters for PowerShell (F-2701) | none |
| `parseResult` | output lines | the result block between two markers: status, host facts, server facts, timings | `noResultBlock` (treated as `channelClosed`) |

Statuses: `LockBusy`, `NoDownloaderAvailable`, `UnpackFailed`, `ServerDownloadFailed`, `CreateInstallDirFailed`,
`UnsupportedArch`, `UnsupportedPlatform`, `LinuxPrereqs`, `NoBash` (only while a spec still requires bash),
`ServerFailedToStart`.

Rules inside the scripts:
- `wget` is preferred, then `curl`, and their configuration files are skipped unless
  `useCurlAndWgetConfigurationFiles` is on (F-2403 BR-12).
- Lowercase `http_proxy` and `https_proxy` are exported in F-2404 BR-5's text, and the host's login environment
  wins (F-2404 BR-10).
- Locks use `flock` or atomic `ln` (F-2408, F-2702).
- macOS sockets go in `TMPDIR` (F-2702).
- Windows uses no WMI process query, and a standard Windows user is not failed on purpose: no setting, and the
  reference's recorded failure is drift (R-86, F-3908). The PowerShell script's details are provisional (lab) until
  F-2701's capture runs (D-60).
- In `stepwise` mode each action is its own `runScript` with one log line: remove per the cleanup policy, create
  `bin/<commit>-<epoch ms>`, unpack from the streamed archive stripping the top folder, rename to `bin/<commit>`
  atomically. The installed case is one inline script that sources the environment setup, reports process id,
  kernel and node path, and starts the server (F-6304 6.1, 6.2, BR-8).
- Unpack percentage lines become progress events for the caller to render.
- The scripts are written from the specs only.

### V2 host-probe

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `probe` | H1, platform hint, requirements-check policy | host facts: OS, architecture token, libc family, release id, temp folder, login shell, tools, `SSH_AUTH_SOCK`, `DISPLAY` | `unsupportedPlatform`, `unsupportedArch`, `prerequisiteMissing` (F-2401, F-2402, F-2703), channel failures |

### V3 install-planner

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `plan` | host facts, profile, P3's result or failure, install path setting, download mode, existing layouts reported by the probe | a plan: reuse (`bin/<commit>` or the reused CLI layout of F-3902 rule 10), or download (where, URL), plus data folder, launcher, lock place | `noSource`, `invalidOverride`, `invalidInstallPath` (F-2407 BR-3, before any ssh) |

Rules:
- Reuse is checked before the source is resolved, so a host with a server needs no source (F-3902 rule 8, exception).
- Where the download runs comes from the policy record's `downloadPlacement`. With `clientFirstThenHost`, a failed
  client download falls back to the host in both install modes (F-6304 7.E2). Provisional until the WSL room answers
  F-6304 Q2 (lead, 2026-10-06); no stepwise-only value unless the room says so.
- `useExecServer` is never applied and is logged once per connect (F-2103 BR-13).

### V4 archive-transfer

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `transfer` | plan, H1, a download port (the editor's network stack), UI phase sink | the archive unpacked into `bin/<client commit>/`, with its commit checked and rewritten when needed | `serverDownload` (STR:S043), `localDownload` (STR:S071 with its detail), `unpack` (STR:S075), `copy` (from H1), `cancelled` |

Rules:
- Placement follows the record. For `hostFirst`: `auto` falls back to the client, `always` uses the client, `off`
  never does (F-2405).
- The archive reaches the host by `clientPathOnHost` when it returns a path, else by `copyToHost`, or as the streamed
  input of the unpack step.
- With `cache` `none` the client copy is a temporary file, deleted afterwards (F-3902 rule 6). With `kept` the
  download goes to a temporary name, is verified, then renamed atomically into V9's folder. The rename is the only
  step shared across windows and editor instances.
- Verification follows the record: the download port reports the redirect chain's response facts (a hash header,
  the content length), and V4 applies the first rule whose facts are present.
- Manual bootstrap reads the fixed file and shows STR:S088 on every attempt (F-2406).
- The commit is rewritten by editing the unpacked `product.json` only (F-3902 rule 9, pending the room's
  confirmation).

### V5 install-locks

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `withClientLock` | host identity | the lock held for the install phase | `lockTimeout` after 2 minutes, with S157 shown meanwhile (F-2408) |
| `hostLockLoop` | a step that may return `LockBusy` | the step's result | `retriesExhausted` after 30 attempts, 1 second apart, each shown as "retry N" |

Rules (F-2408 as revised):
- A client lock whose owner died is not free. A waiter takes it over only when the file is at least 4 minutes old,
  polling about every 0.5 s and giving up after 2 minutes. The holder never refreshes the file. It removes the file
  on a clean end and relies on the age rule otherwise.
- The lock id is any stable 8-hex value per host identity; interop with the reference is not a goal (BR-6).
- Settings are read once per attempt sequence (AC-36).
- The host lock wait is bounded at 30 attempts, so it needs no R-79 rule.

### V6 licence-gate

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `classify` | delegated to lib-product's `classifyLicence` (facts, active rules); the rules are data in P4 | `microsoftLicensed` (with the terms URL) or `free` | none |
| `ensureAccepted` | the classification, the profile's store, a UI port | `accepted` | `licenceDeclined` (reason STR:S027, "Connecting was canceled") |

Rules:
- The active rule is the P4 entry `sourceBased` (F-3902 rule 11) alone (R-80). `clientLicence` (F-1402 rule 5)
  stays in the table as an inactive entry.
- An acceptance is stored per profile under a key derived from the terms URL, and is never synced.
- The modal offers "Accept and Continue" and "Cancel" (R-68).

Never: accept for the user.

### V7 server-runtime

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `startOrReuse` | H1, installed server, options (bind host, port range, socket mode, grace time, default extensions, licence accepted, extra start options from the record's allow-list, environment setup) | port or socket, connection token, process id, remote environment additions | `serverStart` (STR:S135 at the end of the start wait), `invalidPortRange` (before any ssh), `cancelled` |
| `installExtensions` | H1, server, ids filtered by F-2506 BR-2 | done; failures are logged per id (F-2506 Q1 (b)) | none raised |

Start options:
- `--start-server`, `--host`, and `--port` or `--socket-path`;
- `--connection-token-file`;
- `--accept-server-license-terms` only after `accepted`;
- `--telemetry-level off` on every start (R-83);
- `--reconnection-grace-time` when set and not 0;
- `--enable-remote-auto-shutdown`;
- `--install-extension` per default id;
- `--file-watcher-polling <ms>` when the record allows `fileWatcherPolling` and the caller passes it (F-6601).

The server is ready on its "Extension host agent listening on" line ([oss] `src/server-main.ts`). A bad bind host
shows STR:S168 and falls back to 127.0.0.1 (F-2409).

Grace time: read at each resolve that starts a server, and never passed to a Windows host (F-2413 7.E5).

Remote environment (F-2311, F-2312):
- The session's `SSH_AUTH_SOCK` and `DISPLAY` are learned from the session at server start, once per connection,
  never built by us.
- The agent link `/tmp/vscode-ssh-auth-sock-<n>` has a random name per window session, kept across reconnects, and
  never overwrites an entry it did not create. Links are never removed.
- The link step is gated by core's terminal trust (F-2311). It runs as a hidden terminal process through S8's
  mechanism, not through H1. A failed link only logs a warning.

### V8 server-maintenance

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `kill` | H1, data folder | done; the caller then drops S9's record | the channel failure (B shows STR:S076) |
| `uninstall` | H1, data folder | done, silently | the channel failure |
| `cleanup` | H1, data folder | done | none raised |

Rules:
- `kill` stops this data folder's server process tree and removes `bin/` (F-2411).
- `uninstall` deletes exactly `<home>/<serverDataFolderName>` (F-2412).
- `cleanup` follows the record's policy: `keepNewest(5)` for SSH on every resolve (F-2413 BR-9 as revised). It
  deletes an older install only when its F-2408 lock can be taken, always keeps the current one, follows
  `serverInstallPath`, tolerates a missing `.log`, and never prunes the reused CLI layout's folders;
  `onlyCurrentRemoveLeftovers` removes every other 40-character commit folder and every `<commit>-<suffix>`
  leftover, keeping other names (F-6304 BR-8, AC-9); `onlyCurrentKeepLeftovers` keeps the leftovers (F-6304 BR-7).

### V9 server-cache

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `cacheFolders` | profile | the volume tree for servers, and the extension cache folder: `extensionsCache/` for `code` and `code-insiders`, `extensionsCache-<applicationName>/` for every other product | none |
| `clientArchiveFolder` | profile, quality, commit, the extension's cache root | the kept client archive folder: the reference layout for `code` and `code-insiders`, with an `<applicationName>` level for every other product, so two products never share a name | none |

Rule: an entry downloaded from another gallery is never reused (R-58, F-0419 BR-18). The container transport's
contract (area C) defines the volume.

---

## 6. lib-forwarding

### W1 port-search

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `parseRange` | `remote.SSH.preferredLocalPortRange` value | a range, or none with a log reason | none (an invalid value is ignored, F-2104 BR-6) |
| `findFreePort` | range or none, a probe port | the first port whose connection attempt is refused; a random free port when there is no range | `noFreePort` (STR:S095 inside S067) after the whole range, or after about 3 seconds (F-2104 BR-7) |

Never: probe by binding.

### W2 window-tunnel

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `open` | a dialer, the remote target (server port on the host's IPv4 loopback, or a socket path), W1's port | the local address 127.0.0.1 and port | `tunnelNotReady` after the wait (about 10 s on the second-ssh path, F-2104 BR-10); dialer failures |

Rule: the target is always the host's IPv4 loopback in TCP mode, whatever `bindHost` says (F-2104 BR-13).

### W3 tunnel-factory

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `factoryFor` | a dialer, privacy options (Tunnels: `private`, `public`, F-8202) | the resolver's tunnel factory and tunnel features | none |
| `environmentTunnels` | `LocalForward` entries from S4 | the resolver's environment tunnels (F-2507) | none |

Rule: ports forwarded before a reconnection are revived over the new dialer (F-2104 Q4 and F-2507 Q1, recommended).

### W4 default-forwards

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `applyDefaults` | `remote.SSH.defaultForwardedPorts` | one `openTunnel` per valid entry after resolve, never on reconnection | none raised (invalid entries are skipped and logged) |

---

## 7. remote-ssh, area A part

### R1 connection-pipeline

`connect` and `cancel` as agreed with area B. The inputs are the decoded target, the raw host string, the attempt,
the reconnection flag and the window identity. The outputs are Connected or Failed with kind, reason, retryable,
userAlreadyNotified, hints and diagnostics.

The step order is in `components.md`. Phase events are `initializing`, `downloading`, `downloadingLocally`,
`copyingWithScp`, `installing`, `settingUpTunnel`, `waitingForForwarding` and `serverDownloadPercent`.

Rules:
- `Failed.kind` is one of the closed list: `unreachable`, `timeout`, `authentication`, `hostKeyChanged`,
  `hostKeyRejected`, `forwardingDisabled`, `channelClosed`, `brokenPipe`, `unsupportedPlatform`,
  `prerequisiteMissing`, `noServerSource`, `invalidServerTemplate`, `licenceDeclined`, `serverDownload`,
  `serverInstall`, `serverStart`, `invalidSetting`, `preconnectFailed`, `lockTimeout`, `retriesExhausted`,
  `cancelled`, `unknown`. B's presenter maps every kind.
- R1 decides `remoteCommandInEffect`: `remote.SSH.enableRemoteCommand` on, shared mode, and the host not excluded by
  the platform match of F-2107 BR-1. S2 only applies it.
- `connect` shows no dialog of its own for a failure. B's per-extension presenter renders `noServerSource` and
  `invalidServerTemplate` (F-3902 rule 8) and `licenceDeclined` (F-2601 with STR:S027). `userAlreadyNotified` is
  true only after the pre-connection script's own dialog (F-2108). The licence modal itself (V6) and the
  authentication prompts (S7, S8) are interactions inside the connect, not failure dialogs (review of lib-authority,
  points 1 and 2, accepted 2026-10-06).
- `retryable` is set by A from the kind and `isReconnection`. B never interprets kinds, and shows no failure dialog
  during reconnection.
- `cancel` is called by B on window teardown or "Close Remote Connection". The SSH progress offers no Cancel
  (F-2304 BR-2), and a running host-side download is not stopped (F-2304 BR-8).
- Connected carries `tunnelFeatures` from W3 next to the tunnel factory (F-8202).
- Every attempt makes a fresh connection when S9 reports the transport lost (F-2505 BR-1).
- Every recorded hang becomes a bound wait followed by F-2601's dialog (R-79). This covers:
  - F-2103 Q1, F-2104 Q1, F-2304 Q2, F-2308 Q3 and Q4, F-2405 Q3;
  - after the revisions of 2026-10-06: F-2105 (a `ProxyCommand` that never answers, `ConnectTimeout 0`), F-2108
    7.E8, F-2311 7.E8 (through F-2104 and F-2304), the declined scp trust of F-2405, F-2406 7.E6 and F-2703 7.E5,
    and F-2701 Q6.
  F-2408 Q1 is closed by observation: its wait is bounded.
- On reconnection the session's environment is learned again. The extension-host environment is refreshed, and the
  terminal environment contribution is replaced without relaunching terminals (F-2312 6.9).
- The pre-connection script runs on attempt 1 only, as a detached child that is never killed (F-2108).

### R2 ssh-diagnostics

Operations:
- `recordResolve`: the log content of F-2003 BR-6, without secrets.
- `storeHints`: the two newest records (F-2605).
- `showTroubleshooting`: the session table terminal.

### R3 preconnect-runner and R4 platform-decider

R3:
- Runs the configured script with no arguments and the editor's environment.
- Shows the confirmation for an unconfirmed script and stores its hash (F-2108).
- Failure kind `preconnectFailed` with F-2108's detail.

R4:
- Decides the platform in the order of F-2206 BR-1 to BR-4.
- Writes the setting only under F-2206 BR-9.
- Asks B for the picker when it is needed.

---

## 8. remote-server tunnel client: blocked

Frozen pending D-55 (the user). F-8902 is accepted: sign-in through `vscode.authentication` only. F-8201 Q1 is
ruled "three quirks fixed", which T4 and B's `currentConnection` follow. A spike of option (c) runs as an
investigation by `remote-coding-worker-1`.

The `[cli]` reading of 2026-10-06 (crate at commit 2c1d4c1a) shows that option (a), the shipped tunnel executable
as the relay, cannot meet F-8103 and F-8902 as the specs stand. The contract for T2 to T5 is therefore not written.
Only T1 and T3's token source are fixed.

Facts:
1. **No client relay mode.** The CLI's only path that connects to someone else's tunnel is
   `DevTunnels::connect_to_tunnel_port` ([cli] `src/tunnels/dev_tunnels.rs`). Its only caller is
   `code agent ps|stop|logs --tunnel <name>` ([cli] `src/commands/agent.rs`), which reaches the agent-host port 31546,
   runs one command and exits. No subcommand connects to a tunnel's server and exposes a local socket or port for the
   editor.
2. **`command-shell` is the other side.** It serves the host side of the control protocol (`serve`, `forward`,
   `fs_*`, `spawn`) on a local socket or port ([cli] `src/tunnels/control_server.rs`); it is not a tunnel client.
3. **Every token is stored.** The device-code flow, `tunnel user login --access-token` and
   `VSCODE_CLI_ACCESS_TOKEN` all write the credential to the OS keychain or to `<cli-data-dir>/token.json`
   ([cli] `src/auth.rs`). No route keeps a token in memory only, which F-8902's sign-in rule needs.
4. **GitHub tokens carry the CLI's client id.** The CLI sends them as `client_id=01ab8ac9400c4e429b23 <token>`.
   Whether the service accepts a token minted for the editor's own GitHub session under that header cannot be seen
   from the source.
5. **Where the executable sits.** It ships as `bin/<tunnelApplicationName>` in the editor install (`build/`
   packaging steps). The Rust code itself never reads `tunnelApplicationName`.

What remains possible, for the user through the register:
- (a) as decided, which needs a CLI client mode that does not exist in VS Code OSS today; we would depend on a
  future upstream change;
- (b) the dev tunnels client library in an A3-style helper, which needs an ADR-0004 exception for
  `@microsoft/dev-tunnels-ssh` (`tunnel-client-alternatives.md`);
- (c) the native OpenSSH client through a small WebSocket bridge as `ProxyCommand`, speaking the relay's SSH
  directly. This keeps ADR-0004 whole but is unverified: whether OpenSSH can authenticate to the relay's host side
  must be shown before it counts as an option.

Also fixed by the revisions of 2026-10-06, whatever relay is chosen:
- The client contacts only the dev tunnels service domain, the cluster and relay addresses it returns, and the
  editor's own authentication. It contacts no update or server-download service (F-8902 AC-4, AC-6).
- Any telemetry flag in a start or reuse request to the host is forced off (F-8104 BR-15, R-83).
- Open with the server room: F-8102 BR-5 against F-8103 BR-8 on when an account association is written, and
  F-8104 Q6's wording against F-8902 rule 3. With remote-development: the dev tunnels terms of service (F-8902
  Q1), which may hold the whole tunnel client.

Fixed regardless of the choice:
- **T1.** P1 gives `tunnelApplicationName`; a missing executable is F-8103 7.E10.
- **T3.** Tokens come only from `vscode.authentication` with F-8102's provider ids and scopes.
- **T2.** One relay per profile with F-8103 BR-6's lifetime.
