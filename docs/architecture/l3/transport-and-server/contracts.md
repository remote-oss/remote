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
| `runScript` | script text, interpreter (`posixShell`, `powershell`), environment additions, input (`ScriptInput`: `text` with its text sent as UTF-8, or `file` with a local file streamed byte for byte to standard input), cancellation | output lines as a stream, then the exit status | `channelClosed`, `spawnFailed`, `timeout`, `cancelled` |
| `copyToHost` | local file, remote path, cancellation | done | `copyToolMissing`, `copyFailed` (with the tool's message), `channelClosed`, `cancelled` |
| `identity` | none | the key that names the host in locks and records (SSH: the host string as written; containers: the container id; WSL: the distro name) | none |
| `platformHint` | none | `linux`, `macOS`, `windows` or `unknown` | none |
| `clientPathOnHost` (optional) | a local file | a host path where the host reads that file directly, or `none` | none. Callers never call it directly: they use `hostPathOf(channel, file)`, which maps a missing operation and any rejection to `none` in one place |

Rules:
- A missing local file for a streamed input fails with `spawnFailed` before anything runs.
- `clientPathOnHost` exists for WSL, which reads client files through the drive automount (remote-wsl F-6301 6.7).
  SSH and `docker exec` return `none`, and callers then use `copyToHost`.
- A channel never interprets script output.
- A channel never retries by itself.
- Failure kinds are closed: an implementation maps every error to one of the six kinds and keeps the original
  message as detail.
- The library ships a recording fake that replays scripted outputs, takes maps of local files and host paths, and
  records each whole request. lib-server's tests run on it alone.
- The shared channel suite runs the `clientPathOnHost` mapping case only for implementations whose harness declares
  `reachesClientFiles` (WSL). The "none" case runs for all.

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
- The host goes in as its own argument; a user carried by the target as `-l <user>`, and a port carried by the
  target as `-p <port>`, only then and never from the configuration (F-2501 BR-2, AC-9).
- `scp` gets the same `-F` and the alias (F-2405 BR-6); an IPv6 host is bracketed.
- `~/` (and `~\` on Windows) in `configFile` expands against the home folder with the platform's separator;
  `C:/x` stays as written (F-2201 Q4, lead's ruling 2026-10-07).
- `buildOptionsQuery` (target, `configFile`, the accepted `ssh`, home folder, platform) gives the `ssh -G` run of
  S4's `effectiveOptions`: `-F` when set, `-G`, the host.

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

`logLinesOf` returns the error lines that go to the log: every line except ssh's debug1 lines, of which only "Server
host key" stays (F-2109 BR-4). `endWithFullStop` gives a reason its one closing full stop, not after text that already
ends a sentence (F-2603 BR-10).

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

`effectiveOptions` is two pure halves around S3's run: S2's `buildOptionsQuery` gives the `ssh -G` argument list, and
`parseEffectiveOptions` reads the printed text into the options or a `parseError`.

| `parseAddHostCommand` | the text the user typed | a Host block (keywords mapped by F-2204 BR-5) | one of the four errors of F-2204 |
| `writeHostBlock` | file text, block | the new file text with the block placed by F-2204 BR-10 to BR-17 | none (B's command writes the file) |

Rules:
- `parseAddHostCommand` parses as ssh does (F-2204 BR-3, checked against OpenSSH 10.2p1): options before and
  directly after the destination are read, and the first other word after the destination starts the remote
  command, which is not written.
- `listHosts` reads fresh on every call and never caches (F-2202).
- The match-back of F-2202 BR-21 uses `effectiveOptions` until the spec answers dossier question 5.

### S1 client-locator (decision part)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `candidates` | `remote.SSH.path` user value, the environment's PATH and `ProgramFiles`, platform | the ordered candidates (F-2101 BR-1): the setting; the bare name (`ssh.exe` on Windows) when PATH is not empty; on Windows `<ProgramFiles>\Git\usr\bin\ssh.exe` when `ProgramFiles` is known | none |
| `scpProgram` | the accepted candidate, platform | the `scp` beside a configured `ssh`, otherwise the bare name (F-2405 BR-6) | none |
| `judge` | a candidate's `-V` exit status and output | accepted or rejected (F-2101 BR-4, BR-5) | none |

Rules:
- `judge` runs on the output of the one check argument list `VERSION_ARGUMENTS` (`-V`, F-2101 BR-3).
- Empty output with exit status 0 is rejected (F-2101 Q2, recommended (b)).
- Nothing is remembered between runs (F-2101 BR-10).

---

## 4. lib-ssh, process and UI parts

### S3 session-spawner

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `spawn` | an S2 invocation, the askpass environment from S7 | a session: output and error streams, input stream, exit status | `spawnFailed`, `clientVanished` |

Rules:
- The editor's environment is passed unchanged (F-2101 BR-7). Standard input is a pipe. `SSH_ASKPASS_REQUIRE` and
  `DISPLAY` are never added for the user's external askpass (F-2309); for OUR askpass endpoint the askpass environment
  sets `SSH_ASKPASS=<our launcher>` and `SSH_ASKPASS_REQUIRE=force`, because OpenSSH 8.4 and later runs an askpass
  from a process without a tty only when `DISPLAY` is set or the variable says so, and we never inject `DISPLAY`
  (narrowed 2026-10-08; confirmed by the room the same day: F-2309 BR-3/BR-4 and AC-29, F-2305 PRE-3, recorded as an
  adaptation). The window's own `DISPLAY` or `WAYLAND_DISPLAY` passes through unchanged, never added or removed, which
  is what reaches our askpass on clients older than 8.4.
- The connect wait is the timeout plus 2 seconds. It starts at the spawn in shared mode and at the platform choice in
  terminal mode. It pauses while a prompt is open, restarts after each answer, counts time spent in an external
  askpass, and stops at the first setup report (F-2105, F-2308 BR-5). The maximum for `ConnectTimeout 0` is an R-79
  bound: `unboundedWaitSeconds`, a policy value the package passes in, and it is the final limit (no +2 s margin;
  ruled 2026-10-08).

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

Rulings of 2026-10-08 for S9 and S10 (the process side):
- Secrets never touch the registry file: lib-helper's record carries only endpoint, nonce, process id and the SOCKS
  port; the shared record of F-2102 (remote port, OS, architecture, temp folder, connection token) lives in the
  helper's memory, set once after the connection completes, and reaches a later lease through a `sharedRecord`
  request after its hello. This satisfies "written only after the connection completes".
- Helper messages are plain data over lib-helper's channel: requests `connect` (owner only), `sharedRecord`,
  `setSharedRecord`, `answer {promptId, text}`, `kill`; events `prompt {promptId, surface, text}`, `promptClosed`,
  `ownerChanged`, `connected {socksPort}`, `loginFailed {kind, reason?, hints}`, `transportLost`,
  `waitingForOtherWindow`. The reply to `connect` only acknowledges it; a login that fails ends in the `loginFailed`
  event (S5's kind, reason and hints) and the oldest waiting window takes over the login. S6 classifies prompts inside
  the helper; no answer is stored or logged.
- The SOCKS port: prefer `-D 0` with the allocated port read from `ssh -v` ("Allocated port N for ...") when the
  local OpenSSH supports it (verified once against the local client and recorded as a fixture); otherwise pick a
  free loopback port by binding port 0 and closing (allowed here; W1's "never probe by binding" is about the
  forwarding search).
- The first setup report that ends the connect wait is the `ssh -v` authentication line ("Authenticated to ... using
  ..."), exposed by S5 as the marker `authenticated` (added to S5's rules; a one-row card).
- S10 runs a script with input as `sh -c '<quoted>'` and a script without input as `sh -s` on standard input; the
  quoting assumes a POSIX-reading login shell, which slice 1's harness provides; a fish or csh login shell is the
  slice-3 variant of the harness, with the room's two-mode bootstrap answer.
- The askpass endpoint is a second socket `ra-<16 hex>.sock` (mode 0600) in the runtime folder, reached by `ssh`
  through a bundled `SSH_ASKPASS` launcher script `rh-askpass-<16 hex>` (mode 0700, in a user-only folder of the
  runtime folder, the same `rh-` prefix as the helper's endpoints; ruled 2026-10-08) and two environment variables
  (`REMOTE_OSS_ASKPASS_ENDPOINT`, `REMOTE_OSS_ASKPASS_NONCE`). A connection to the endpoint that sends no first
  message within a policy deadline (R-79; 5 s default) is closed and logged; a launcher that fails to speak never
  holds a prompt open.

### S9 connection-server

Provisional (lab) for Windows clients: named pipes, a script as `SSH_ASKPASS`, and the detached helper's survival
wait for the run of F-2102 Q1 (D-60).

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `acquire` | host string, target, cancellation (the lease number is the window's identity; ruled 2026-10-08, #175) | a lease: SOCKS port, the shared record (remote port, OS, architecture, temp folder, connection token) when one exists, and S10 over this connection | S2 and S3 failures (`spawnFailed` with its cause when `ssh` could not start); `cancelled`; login failed (kind and reason from S5); `timeout` by the policy's login bound, which pauses while a prompt is open |
| `release` | lease | none | none |
| `kill` | host string | done, silently, also when nothing runs (F-2102 BR-7) | none |
| `events` | lease | `waitingForOtherWindow`, `ownerChanged`, `loginFailed`, `transportLost` | none |

Rules:
- One helper per host string, exactly as written (F-2102 BR-6).
- The record is written only after the connection completes.
- `acquire` is not used when `remote.SSH.useLocalServer` is off or socket mode is on (F-2102 BR-10, F-2410).

S9 is built on lib-helper (§9): a per-profile registry, the end policy `graceAfterLastLease`, and the oldest-first
lease list that S9 uses for login ownership. Lifetime, ownership and how it dies are in
[local-connection-server.md](local-connection-server.md) and the ADR draft `adr-drafts/local-connection-server.md`.

### S10 ssh-host-channel

"Over this connection" (ruled 2026-10-08): the helper's shared `ssh` runs with `-T` and no command, so the remote
login shell reads standard input; S10's `runScript` writes the script to that session's stdin (the two-mode
bootstrap) and reads its result block from stdout, one run at a time (the helper serialises; probe, install, start
sequentially), while the `-D` SOCKS forward rides the same session: one login, prompts once. `copyToHost` is the one
exception and runs `scp` as its own login (F-2405). No ControlMaster or ControlPath is ever added (the S2 rule
stands, POSIX and Windows alike). The lease exposes the session through the helper's request channel (a
`runScript` request whose reply streams lines and ends with the result block) beside the SOCKS port and the shared
record; after `start` the session stays as the forward's carrier and later runs (kill, cleanup) use it when idle.

H1 implemented over S9 or S3:
- `runScript` runs `sh` or `powershell` per V1's interpreter (the login-shell mode is dossier question 10).
- `copyToHost` uses `scp` through S2 and S3, run as a hidden task so that core's trust gate applies (F-2405).
- `identity` is the host string.
- `platformHint` comes from R4.

---

## 5. lib-server

### Network rule for every client-side HTTP request (2026-10-07, the user's evaluation)

Every HTTP request an extension makes on the client (server archive download, prefetch, gallery, licence texts)
goes through the editor's proxy-aware path: the extension host's patched `http`/`fetch` under
`http.proxySupport`, so the editor's system-proxy and PAC resolution applies and the family carries no proxy
resolution of its own. Spawned programs (`ssh`, the dev container CLI) inherit the environment. The native
`@vscode/os-proxy-resolver` was evaluated and is not adopted; it stays a fallback candidate that needs a ruling if a
recorded case ever shows the editor path insufficient. lib-server's V4 (archive transfer) and V10 (prefetch) and
lib-product's licence-text fetch take an injected HTTP port that the extension wires to the editor's path; a test
proves no module creates its own agent or reads proxy settings.

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
| `prefetch` | `none`; `onProductUpdate` with setting key, feed check interval, platform window, licence handling | `none` | `none` | `onProductUpdate`: `remote.WSL.downloadInBackground`, hourly, platforms used in the last 14 days, `skipUnaccepted` (F-6301 6.6, BR-13) |


Rulings of 2026-10-08 for the script parameters: a profile without `serverDataFolderName` gets the derived
`.<applicationName>-server` from lib-product's `serverDataFolderNameOrDefault(profile)` (product-scoped, never
`~/.vscode-server`; an adaptation); the host lock file is `remote-lock.<user>.<commit>` in the lock folder, `<user>`
from the effective ssh config (interop with the reference's name is not a goal); the proxy variable text of F-2404
BR-5 (empty path → "/", host lower-cased, `$` encoded) is built by lib-server's pure `proxyVariableText`.

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
- The scripts trap HUP, INT and TERM and release the host lock before exiting, so a killed `ssh` never leaves later
  connects at `LockBusy` (found in review, 2026-10-08).
- macOS sockets go in `TMPDIR` (F-2702).
- Windows uses no WMI process query, and a standard Windows user is not failed on purpose: no setting, and the
  reference's recorded failure is drift (R-86, F-3908). The PowerShell script's details are provisional (lab) until
  F-2701's capture runs (D-60).
- In `stepwise` mode each action is its own `runScript` with one log line: remove per the cleanup policy, create
  `bin/<commit>-<epoch ms>`, unpack from the streamed archive stripping the top folder, rename to `bin/<commit>`
  atomically. The installed case is one inline script that sources the environment setup, reports process id,
  kernel and node path, and starts the server (F-6304 6.1, 6.2, BR-8).
- Unpack percentage lines become progress events for the caller to render. Their format is the family's own (no
  spec defines one; ruled 2026-10-08): a whole line `remote-oss-server-progress unpack <percent>` with an integer 0–100,
  printed at most once per 5 points and once at 100, outside the result block, and ignored by `parseResult`. The
  same shape with `download` as the step is allowed for host-side downloads when the downloader reports progress.
- The scripts are written from the specs only.

### V2 host-probe

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `probe` | H1, platform hint, requirements-check policy | host facts: OS, architecture token, libc family, release id, temp folder, login shell, tools, `SSH_AUTH_SOCK`, `DISPLAY` | `unsupportedPlatform`, `unsupportedArch`, `prerequisiteMissing` (F-2401, F-2402, F-2703), channel failures |

Rule (from server-08's acceptance run, 2026-10-08): the probe script never depends on a command that fails when a
glob has no match (`ls a b` under BusyBox); libc detection must report `musl` on Alpine, and the acceptance suite
keeps a case for it.

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
- Verification follows the record: the download port reports the facts of the final response of the redirect chain
  (the final URL, the HTTP status, `content-length` when present, a digest header only when the policy table names
  one and the server sends it), and V4 applies the first rule whose facts are present (card server-09). Redirects: the
  licence classification (R-80) is tied to the TEMPLATE's host, never the final one; the final host must be the
  template's host or one of the allowed redirect hosts the product table lists per source host (for example
  `github.com` → `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, the GitHub release-asset
  hosts); any other final host is a `serverDownload` failure with a reason; the final URL is logged (origin and
  path only). A response that gives the facts of no rule and whose record lists no `none` rule counts as verified:
  there is nothing to check against, and the record's order already says what to prefer (ruled 2026-10-08, #158). A
  kept entry the host cannot unpack is deleted and downloaded once more, so one bad entry does not fail every later
  connect; the transfer deletes a kept entry in no other case (ruled 2026-10-08, #158). (Ruled
  2026-10-08, corrected the same day: a plain same-host rule would fail every GitHub release download.)
- Bounds are the library's (R-79): `DownloadRequest` carries `deadlineMilliseconds` (the whole transfer),
  `stallMilliseconds` (no bytes for that long ends it) and `maximumBytes` (the content length when known, else the
  policy table's ceiling), plus cancellation; the port implements them and the library proves them with a fake port
  that stalls, overruns and never answers. A connect never hangs on a download.
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
- An explicit acceptance is the user's acceptance for this connection even when storing it fails: the connect
  proceeds, the gate reports `remembered: false`, the store failure is logged once, and the user is asked again next
  time. A server is never installed or started without an acceptance in the same session (ruled 2026-10-08).

Never: accept for the user.

### V7 server-runtime

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `startOrReuse` | H1, installed server, options (bind host, port range, socket mode, grace time, default extensions, licence accepted, extra start options from the record's allow-list, environment setup) | port or socket, connection token, process id, remote environment additions | `serverStart` (STR:S135 at the end of the start wait), `invalidPortRange` (before any ssh), `cancelled` |
| `serverPort` | the connection | the TCP port the running server listens on at the host's loopback, or `none` in socket mode or when no server runs; it never contacts the host (F-2509 option (a), ruled by the lead 2026-10-06, for B's Open Web UI) | none |
| `installExtensions` | H1, server, ids filtered by F-2506 BR-2 | done; failures are logged per id (F-2506 Q1 (b)) | none raised |

`startOrReuse` reports `reused: boolean`; the pipeline calls `installExtensions` only when `reused` is true, since a
freshly started server receives the default ids on its command line (ruled 2026-10-08). The launcher accepts `--install-extension` without `--start-server`: confirmed at the floor tag ([oss]
`src/server-main.ts` at 1.139.1, line 44: `shouldSpawnCli` is true for an install argument without `start-server`,
and the CLI path runs the install); no fallback needed.

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

The `start` step takes the host lock (the script, 2026-10-08), so a second window starting at the same moment gets
`LockBusy`; V7 runs `start` inside V5's `hostLockLoop`, the same as the install steps.

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

### V10 server-prefetch

Downloads the next server into the kept cache before it is needed, for an extension whose record says
`onProductUpdate` (remote-wsl F-6301 6.6, BR-13, Q4; agreed with area D, 2026-10-06). It is one component driven by
the record, never a per-extension branch.

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `run` | the record's `prefetch` values, profile, the download port, V9's folders, the settings snapshot, cancellation | runs while gated, and shows nothing; log lines only | none raised; every failure is logged and skipped |

Rules:
1. **The gate.** The extension's setting is on, and core's `update.mode` is not `none`.
2. **Source first.** Before any network request, P3 must be able to resolve a source for the product at all, by
   override, product template or built-in table. If it cannot, nothing is queried. On genuine VS Code without the
   user's template this means "never", so nothing goes to Microsoft's update service for no purpose (ADR-0006
   decision 2).
3. **The feed.** It is queried at most once per feed check interval, with the time kept in global state. The feed
   shape is product data in P4, for example the OSS shape
   `{updateUrl}/api/update/{platform}/{quality}/{commit}` ([oss]
   `src/vs/platform/update/electron-main/abstractUpdateService.ts`). A product without a known feed shape gets
   `none`, logged once.
4. **Licence.** With `skipUnaccepted`, a Microsoft-licensed source (R-80) without a stored acceptance is skipped and
   logged. The modal is never shown from a prefetch (R-68).
5. **Download.** For each platform used within the window, P3 resolves with the new commit, version and release. V4
   downloads with the same verification and atomic rename as a connect.
6. **One prefetch per user at a time.** A lock file next to the kept cache, with V5's client-lock rules and a
   30-minute age takeover. Global state is per profile, so it cannot serve as this lock.
7. **Cancel.** The setting turned off or the window closing aborts an in-flight download, which leaves only the
   temporary name. A connect that needs the same archive waits for the in-flight download under R-79's bound instead
   of starting a second one; the atomic rename makes either outcome safe.

### V9 server-cache

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `cacheFolders` | product, commit, platform, whether a volume is mounted at `/vscode` (area C decides the mount, F-0419) | a pure function giving the volume tree for servers, and the extension cache folder: `extensionsCache/` for `code` and `code-insiders`, `extensionsCache-<applicationName>/` for every other product | none |
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
- `Failed` also carries `silent` (boolean): `NotAvailable`, not handled, no dialog. Remote-SSH never sets it. Dev
  Containers sets it for a stopped or removed container (F-0502, lead's ruling relayed by area C on 2026-10-06), and
  B maps it.
- `connect` shows no dialog of its own for a failure. B's per-extension presenter renders `noServerSource` and
  `invalidServerTemplate` (F-3902 rule 8) and `licenceDeclined` (F-2601 with STR:S027). `userAlreadyNotified` is
  true only after the pre-connection script's own dialog (F-2108). The licence modal itself (V6) and the
  authentication prompts (S7, S8) are interactions inside the connect, not failure dialogs (review of lib-authority,
  points 1 and 2, accepted 2026-10-06).
- `retryable` is set by A from the kind and `isReconnection` (ruled 2026-10-08): `isReconnection` AND the attempt
  limit not reached AND the kind not in the permanent set {authentication, cancelled, hostKeyChanged,
  hostKeyRejected, licenceDeclined, noServerSource, invalidServerTemplate, invalidSetting, unsupportedPlatform,
  prerequisiteMissing, preconnectFailed, lockTimeout, retriesExhausted}; every other kind is temporary during
  reconnection (F-2505 BR-2); a data table in R1. `hostKeyChanged` reaches R1 from S5 at login and `hostKeyRejected`
  from a declined host-key prompt through S9's `loginFailed`; both are mapped in slice 1. B never interprets kinds,
  and shows no failure dialog during reconnection.
- The `Connected` and `Failed` types are declared by lib-authority (the connector contract; `kind` is a string there
  because the host never interprets it) and produced by remote-ssh's pipeline narrowed with lib-ssh's `FailureKind`;
  no copy in remote-ssh (ruled 2026-10-08).
- `cancel` is called by B on window teardown or "Close Remote Connection". The SSH progress offers no Cancel
  (F-2304 BR-2), and a running host-side download is not stopped (F-2304 BR-8).
- Connected carries `tunnelFeatures` from W3 next to the tunnel factory (F-8202).
- `Connected` is data; the pipeline's internal step result carries a `release` handle beside it, which the
  connector keeps for `cancel` and window teardown (connect-02, accepted 2026-10-08).
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

---

## 9. lib-helper (draft for area C's review; lead's ruling 2026-10-06)

Names (ADR-0003, ruled 2026-10-08): the record's `recordKey` (not `key`), `startedByProcessId` (not `pid`; it is the
acquirer's process id, since the claim precedes the spawn; stopping always goes through the endpoint, never a kill
by process id), `Lease.leaseId`, `close(leaseId)`, `Clock.now()` (the user allows `now` as a named exception to the four-character rule, 2026-10-08). The wire protocol is newline-delimited
JSON (`hello`/`welcome` with the nonce, `request`/`reply` by `requestId`, pushed `leaseListChanged` and `message`,
`stop`); helper parameters travel in one environment variable, never argv; the spawn is `process.execPath` with
`ELECTRON_RUN_AS_NODE=1`, detached, stdio ignored, windowsHide, unref; the endpoint path is
`$XDG_RUNTIME_DIR` or the temp folder plus `rh-<16 hex>.sock` under umask 0o077; helper scripts are bundled from
`src/helpers/*.ts` into `dist/helpers/<name>.js` as separate entries without `vscode`.

One pattern for every detached helper process the family runs on the client. A helper outlives the extension host
that starts it, is shared by leases from several windows, and ends by a policy.

Consumers:
- S9, the SSH local connection server: per host string, per profile (F-2102);
- area C's container watchdog: stops containers once every window is gone, after a delayed check of about 10 s,
  with a registry shared across profiles (F-0417 AC-43);
- the Tunnels relay (T2), if the frozen design keeps one: per profile, idle end after 30 to 60 s (F-8103 BR-6).

The WSL listener rendezvous (area D, D5) is a candidate if D chooses it.

### X1 helper-client (in the extension host)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `acquire` | registry folder (per profile from global storage, or per user; the caller chooses), namespace (extension and kind), recordKey, start specification (the bundled helper script and its parameters), end policy, cancellation | a lease: the helper's endpoint, its record payload, `startedByMe`, and the lease's position in the oldest-first list | `spawnFailed`, `endpointUnreachable` (after replacing a stale record once), `cancelled` |
| `release` | lease | none; closing the lease's connection has the same effect, so a crashed extension host releases by itself | none |
| `request` | lease, message (plain data) | reply (plain data) | `helperGone`, `timeout` (the caller's limit) |
| `events` | lease | helper messages, `leaseListChanged`, `helperGone` | none |
| `stop` | registry folder, namespace, recordKey | done, also when nothing runs | none |

### X2 helper-runtime (bundled into each helper script)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `serve` | endpoint, record payload, end policy, message handler | runs until the end policy fires or `stop` arrives | none raised; the helper logs to its own file and exits |

End policies (data, no per-consumer branches). The policy is armed at start as if a lease had just closed, so a
helper that never receives a lease ends by the same rule (ruled 2026-10-08); a joiner never replaces a still-starting
helper's record (the claim is atomic and the starter's hello window counts as alive):
- `graceAfterLastLease(ms)`: end this long after the last lease closes. A new lease within the grace cancels it. SSH
  uses 2 to 4 s (F-2102 BR-3), and the value must also carry a reload.
- `delayedCheckAfterLastLease(ms, action)`: after the last lease closes, wait, check again, then run the consumer's
  action (for example "stop these containers") and end. Area C uses about 10 s (F-0417 AC-43).
- `idleAfterLastLease(ms)`: as the grace, for the relay's 30 to 60 s (F-8103 BR-6).

### X3 registry (pure decisions, file access through a port)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `claim` | folder, namespace, recordKey, record | `claimed`, `existing` with the record, or `corrupt` | none |
| `isStale` | record, result of one hello exchange | true when the helper does not answer within a short limit | none |

Rules:
- **Atomic claim.** A record is claimed by an atomic exclusive create. The loser of a race joins the winner. A stale
  record is replaced once, never in a loop.
- **Endpoint.** A Unix socket with mode 0600 in the user's runtime folder (temp folder on macOS), or a named pipe
  restricted to the current user on Windows. The Windows form is provisional (lab), D-60.
- **Authentication.** A per-helper nonce in the record must be presented in the hello. A per-user registry holds no
  secret beyond that nonce.
- **The process.** The helper is a script bundled in the VSIX and run on the editor's own runtime, detached, with no
  console window and stdio closed. There is no TCP listener and no network of its own. It never runs as another user.
- **Lease order.** Leases are numbered in arrival order. The oldest live lease is first. Consumers build ownership on
  this, for example S9's login owner and its hand-over (F-2102 BR-5).
- **Tests.** The lease state machine and the end policies are pure, with a fake clock and a fake endpoint.

Never:
- store prompt answers or credentials in a record;
- leave a helper without an end policy;
- share a registry across users.

