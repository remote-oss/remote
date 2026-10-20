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
  - ADR-0010 (2026-10-14): remote and program output is read only between our own whole-line markers, or in
    a program's documented, anchored form, and every parser has a noisy-neighbour row;
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
| `readProfile` | the text of `<appRoot>/product.json` (the editor adapter reads the file once per session) | a profile with these fields: `applicationName`, `version`, `commit`, `quality`, `release` (empty when absent), `serverApplicationName`, `serverDataFolderName` (fallback `.vscode-server` only where a spec says so, F-0503), `dataFolderName`, `tunnelApplicationName`, `urlProtocol`, `serverDownloadUrlTemplate`, `serverDownloadRedirectHosts` (empty when absent; ADR-0006 decision 7, #1031), `serverLicense`, `serverLicenseUrl`, gallery | `unreadable` (the extension cannot run its resolvers; the log names the path) |

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
| `resolveServerArchive` | profile, host platform tokens (`os`, `arch`), the extension's override policy, the override value with the layer it came from | the URL, the step that produced it (`override`, `productTemplate`, `builtInTable`), the redirect rule V4 applies (`any` or a host list, from the step, the profile and P4; ADR-0006 decision 7, #1031) and the facts V6 needs (URL host, `serverLicense` empty or not) | `noSource` (the `applicationName` and the setting key); `invalidOverride` (the setting key and the problem from P2) |
| `cliRedirectRule` | profile, the CLI archive's address (expanded from `cliDownloadUrlTemplate`) | the redirect rule of that download: the `productTemplate` rule at the address's host, because the CLI's only source is the product's template (ADR-0006 decision 7; ruled 2026-10-19 on #1047). It is the only way to get a rule outside a resolution: no export takes a step | none |

Override policies (one table entry per extension, ADR-0006 decision 6):

| Extension | Key | Layers | Forms |
|---|---|---|---|
| remote-ssh | `remote.SSH.serverDownloadUrlTemplate` | user layer of the default profile only (F-3902 rule 1) | template |
| remote-containers | `remote.serverDownloadBaseUrl` | any layer (F-1402 rule 4) | template, or a base URL to which `/commit:{commit}/server-{platform}/{quality}` is appended |
| remote-wsl | `remote.WSL.serverDownloadUrlTemplate` (F-7902 draft, R-88) | user layer of the default profile only (F-7902 draft) | template |

Rules:
- "Set" means the allowed layers hold a value, never "differs from the default" (F-3902 rule 1).
- The key in this table is the extension's only way to set the server's download template; no second or shared key
  exists (ADR-0006 decision 6, #1039). Its value is step `override` whatever its form, so V4's redirect rule for
  `override` applies to it.
- A bad product template is logged and skipped; resolution falls through (ADR-0006 as revised).
- The built-in table matches `applicationName` exactly. It has two entries, `codium` and `codium-insiders`, and no
  entry for VS Code (ADR-0006 decision 2).

### P4 product-table

A data module holding:
- the two built-in table entries with their release repositories and asset shape (F-3902 rule 1(c), F-1402);
- the licence hosts of F-3902 rule 11(i);
- the allowed redirect hosts per source host (`github.com` → its release-asset hosts; V4, ADR-0006 decision 7);
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
- `-F <file>` when `configFile` is set, with `~/` expanded against the editor's home (F-2201 BR-4). **A value that is
  still not absolute after that expansion (relative, or starting with `$`) is an invalid setting** (metis on
  remote-ssh#30 Q1, F-2201 BR-3 and 7.E8, F-2203 7.E3): one lib-ssh check, used by `-F`, by the host list and by
  "Open SSH Configuration File", so all three judge it alike. A connect that needs it fails before any `ssh` starts,
  with F-2601's reasonless dialog and a log line naming the setting and value. The host list offers no hosts from
  it. The command rejects the pick with core's command-error dialog and the detail `remote.SSH.configFile must be an
  absolute path or start with ~/: "<value>"`, creating and opening nothing. `ssh` never gets a relative `-F`.
  **The value is used as written, never trimmed** (metis on remote-ssh#30, F-2201 BR-3): only the empty value is
  unset; a value of white space only is non-empty and not absolute, so it is invalid like a relative one; a leading
  space makes it relative; a trailing space or newline names a different file, read, handed to `-F` and opened as
  written, under F-2201 7.E8's missing-file rows when it doesn't exist.
- `-T` on the connection `ssh` unless `permitPtyAllocation` is truthy (F-2106).
- `-o ConnectTimeout=<n>` on every `ssh` of an attempt, the tunnel `ssh` and the window's `scp` included, only when
  the host sets none (F-2105; `scp` passes `-o` to its `ssh`, ruled on #253 Q13: without it a copy to an unreachable
  address waits for the system's limit). Never a `ServerAlive*` option.
- The bootstrap goes in on standard input with no remote command in shared mode; in terminal mode the remote program
  is `sh` (F-2105, F-2704).
- `-o RemoteCommand=none` when the effective options carry a `RemoteCommand` and `remoteCommandInEffect` is false
  (F-2107). S2 does not decide whether the feature is in effect; R1 does (F-2107 BR-1).
- `-v` at the level S5 needs (F-2109 BR-3), on `scp` too (#253 Q13): the copy terminal's prompt reader arms its
  unreachable-question bound only at the handshake marker, which `scp` prints only with `-v`.
- `-D 127.0.0.1:<port>`, `-L 127.0.0.1:<port>:127.0.0.1:<remote port>` or `-L 127.0.0.1:<port>:<socket path>` (F-2104
  BR-1, BR-4, F-2410). **Every local listener names `127.0.0.1` as its bind address** (corrected 2026-10-12 on #353,
  from themis's finding; the contract said `-L <port>:…` before). Without one, ssh binds `localhost`, both loopbacks.
  With a squatter on 127.0.0.1 alone, ssh then binds ::1, prints only `bind [127.0.0.1]:<port>: Address already in
  use`, and carries on, so the window, which dials 127.0.0.1 (F-2104 BR-4, BR-13), reaches the squatter. With the
  address named, a busy 127.0.0.1 is a real failure (`cannot listen to port` and `Could not request local
  forwarding.`, checked against a real sshd), and no ::1 listener is left that nobody asked for. `-D` was already
  explicit.
- The host goes in as its own argument; a user carried by the target as `-l <user>`, and a port carried by the
  target as `-p <port>`, only then and never from the configuration (F-2501 BR-2, AC-9).
- `--` comes right before the host in every invocation and in the options query (ruled on #253 Q9): defence in depth
  behind `validateTarget`, so a host starting with `-` is never read as an option by any caller. Checked on OpenSSH
  10.2p1: the options and the connection are unchanged with it. For `scp`, `--` comes before the two operands (the
  local file and `host:path`), so neither is read as an option.
- `scp` gets the same `-F` and the alias (F-2405 BR-6); an IPv6 host is bracketed.
- `~/` (and `~\` on Windows) in `configFile` expands against the home folder with the platform's separator;
  `C:/x` stays as written (F-2201 Q4, lead's ruling 2026-10-07).
- `buildOptionsQuery` (target, `configFile`, the accepted `ssh`, home folder, platform) gives the `ssh -G` run of
  S4's `effectiveOptions`: `-F` when set, `-G`, then the target exactly as the connection gives it (`-l <user>` and
  `-p <port>` only when the target carries them, then the host). OpenSSH computes `User`, `Port` and every `Match
  user` block from those arguments, so a query without them reports options the connection's `ssh` does not apply
  (ruled on #253, connect-14).

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

Host-key prompt forms (ruled 2026-10-09 as an adaptation, now the spec: F-2305 #38 revised the same day): OpenSSH 10
prints `<TYPE> key fingerprint is: <fingerprint>` with no final full stop, older clients `is <fingerprint>.`. The
rule is the revised AC-43/BR-2: `fingerprintPick` when the fingerprint line (either form, with or without the full
stop) is followed by the continue-connecting question; `maskedInput` only when that question is missing. The answer
mapping is unchanged (`yes` continues, `no` is `hostKeyRejected`). The recorded gate's F-2305 row gains a 10.x run
(VS-3); VS-1's masked case needs the relay.

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
- Every option the extension needs for a host comes from `effectiveOptions` (`ssh -G`), `ConnectTimeout` included (metis on
  remote-ssh#29: F-2202 BR-21; AC-27 to AC-30 require the `ssh -G` values). The reference's own match-back (F-2202 6.4) is
  reference data and is reproduced nowhere, so the wait the extension sets and the `ConnectTimeout` `ssh` applies are the
  same value for the same connection.

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
- Remote - SSH's start values (ruled on #253 Q8, 2026-10-12):
  - `settings.connectTimeout` is the setting through F-2105 BR-1's fallback (absent, not a number, negative or
    fractional → 15); the setting's own 0 stays 0 (F-2105 BR-4, AC-9: ssh gets 0, the extension waits 2 s).
  - `unboundedWaitSeconds` is `HOST_ZERO_TIMEOUT_SECONDS` (600), so a host's `ConnectTimeout 0` has one ceiling in the
    helper, the probe and the tunnel. It applies only to a host's 0: the setting's 0 gives the 2 s wait, never 600 s.
    Today's `ConnectWait` cannot tell the two apart (the helper passes `Number(effective ?? setting)`, and any 0 takes
    the ceiling), so `ConnectWaitSettings` gains the source: the ceiling when the looked-up value is 0, the timeout
    plus 2 s otherwise, the setting's 0 included (card ssh-16).
  - The client's `requestMilliseconds` is 10 s (one reply over a local socket). `loginMilliseconds` is the helper's
    connect wait plus 10 s, computed per connect from the looked-up timeout, so the helper's classified timeout always
    arrives before the client's backstop.
  - `displayHost` is the host as the user chose it, without user and port: the alias (`hostAlias`). STR:S001's {0}
    is that host (F-2305 3.4: the alias, or a typed host without its user, never a `HostKeyAlias`). S066's {0} is
    not `displayHost`: it is the word ssh's own prompt carries (`<user>@<HostName>`, F-2306 3.4).

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

The design of terminal mode, S8 included, is `brief-terminal-mode.md` (2026-10-12, #299). It refines the row below.

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
  `ownerChanged`, `connected {socksPort}`, `loginFailed {kind, reason?, hints, exitStatus?}` (`exitStatus`: ssh's exit status, `null` when it ended on a signal, absent from an earlier helper; connect-64),
  `spawnFailed {cause, detail}` (the `ssh` program could not be started: `clientVanished` or `spawnFailed`),
  `transportLost`, `waitingForOtherWindow`. The reply to `connect` only acknowledges it; a login that fails ends in the `loginFailed`
  event (S5's kind, reason and hints) and the oldest waiting window takes over the login. S6 classifies prompts inside
  the helper; no answer is stored or logged.
- The SOCKS port: prefer `-D 0` with the allocated port read from `ssh -v` ("Allocated port N for ...") when the
  local OpenSSH supports it (verified once against the local client and recorded as a fixture); otherwise pick a
  free loopback port by binding port 0 and closing (allowed here; W1's "never probe by binding" is about the
  forwarding search).
- The connect wait runs until the session is **ready to run scripts**, not until authentication (ssh-38, #443, option B,
  2026-10-13): after the `ssh -v` authentication line (S5's marker `authenticated`), the session's prelude runs the
  login shell's startup (layer 1) and prints `LAYER1-READY` just before `exec sh`; only then does the helper announce
  `connected` and stop the wait. `LAYER1-TIMEOUT <n>` ends the attempt as `loginFailed` (timeout, F-2704 AC-11,
  F-2206 AC-28) and `LAYER1-EXITED <status>` as `loginFailed` without a reason (S030, F-2704 AC-13 and AC-25), both
  while the windows are still in `LoginWait`; terminal mode reads the same lines. The wait still pauses while a prompt
  is open and starts over after each answer, so the time a user takes at a prompt never shortens the startup's budget.
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
| `answer` / `refuse` | lease, prompt id, the text (answer only) | whether the question was still open; a refusal closes it unanswered (the program exits 1, `ssh` cancels the prompt) and the helper refuses the run's later questions itself (card ssh-10, 2026-10-09) | none |
| `release` | lease | none | none |
| `kill` | host string | done, silently, also when nothing runs (F-2102 BR-7) | none |
| `events` | lease | `waitingForOtherWindow`, `ownerChanged`, `loginFailed`, `transportLost` | none |

Rules:
- One helper per **connection identity** (amended 2026-10-14, connect-77): the decoded target's (host, user, port),
  written as `payloadOf(target)`, the same function the own-host rule (connect-53) and the maintenance key (connect-52)
  use. The plain and hex spellings of one target, and a port given as a number or a string, share one helper and one
  record (F-2501 BR-3). A different or missing user or port, other letter case, or an alias against a typed
  `user@address` are different identities, since no alias is resolved (F-2102 BR-6). The helper key, the record and
  Kill all use it.
- The environment the helper hands to `ssh` is the editor's environment it was started with minus the helper's own parameter variable (`REMOTE_OSS_HELPER_PARAMETERS`: the nonce and the request); the askpass variables S3 sets are added on top (ruled 2026-10-09, #187 review).
- The record is written only after the connection completes.
- `acquire` is not used when `remote.SSH.useLocalServer` is off or socket mode is on (F-2102 BR-10, F-2410).
  The interim that failed such a connect at validate (ruled on #299; card connect-15) ended with T5 (#381): the
  connection step now runs the install terminal. What remains until T7b (#393) merges: the `secondSsh` and `socket`
  tunnel paths fail as a tunnel that did not open (kind `unknown`, no reason, the path named in the connect log),
  after the login, never a hang (R-79). Terminal mode is reachable for users only once ssh-27 (#390) has fixed the
  reader's bound (athena on #385), so #396 merges after #390. Both stay 0.2 release blockers under #299.

S9 is built on lib-helper (§9): a per-profile registry, the end policy `graceAfterLastLease`, and the oldest-first
lease list that S9 uses for login ownership. Lifetime, ownership and how it dies are in
[local-connection-server.md](local-connection-server.md) and the ADR draft `adr-drafts/local-connection-server.md`.

### S10 ssh-host-channel

**Login shells that are not POSIX** (ruled 2026-10-12, the user's question via hermes; measured in Alpine 3.22 with
sh/dash, bash, zsh, mksh, tcsh, csh and fish):
- **A remote command is safe in every shell when it is one fixed text on one line: `sh`, then single-quoted words
  only**, with no newline anywhere (csh and tcsh reject a quoted word that spans lines: `Unmatched '''`; corrected,
  daedalus on #447), and no `$`, backquote, `!`, `~` or glob outside the quotes. ssh runs it as `<login shell> -c
  '<command>'`, and every shell above parses such a text identically. Measured: the ssh-32 command `sh -c 'eval "$(dd bs=1 count=<n> 2>/dev/null)"'`
  with its prelude and input on stdin, and `sh -s` with a script on stdin, both give the right result through all seven.
  **Not** the direct channel's `sh -c '<script>'` for a script with input and no environment: a multi-line script
  breaks it under csh and tcsh. It goes through the prelude form too (card ssh-35). Every remote command S2 builds
  keeps the one-line form; a row per form runs it through tcsh and fish.
- **The shared session gets a remote command** (ruled on #447, daedalus's ssh-34; measured over real ssh on Alpine
  3.22 with sh, bash, zsh, dash, mksh, tcsh, csh and fish). Without one, the login shell itself reads `commandsFor`'s
  text: tcsh and csh reject the assignment prefix, and fish rejects `"$?"`. No first line on stdin can fix that,
  because fish acts on nothing until its input is complete. So the session's remote command is the fixed one-line
  form `sh -c '<one word>'`. The word sources the login profile in a subshell, takes its exported environment
  (F-2704 BR-4's layer 1, which bash also lacked without a tty), and execs `sh`, which then reads `commandsFor`'s
  commands on stdin. A profile that exits, fails or reads stdin loses only its own variables, never the session.

**No secret in any process's command line** (ruled on #412, daedalus's finding for cli-03b; measured with `ps` on
OpenSSH hosts): a `ScriptRequest`'s `environment` never appears in an argv, on the host or on the client.
- **The one documented deviation: the server the CLI starts** (#412 after remote-ssh#92; daedalus measured on the
  harness host). `[cli]` puts `serve`'s connection token into that server's argv (`--connection-token=`), and no
  `serve` parameter or CLI option avoids it. Accepted because it grants nothing to another user: the server listens
  only on its socket (`srwxr-xr-x`, so another user gets `EACCES`); the loopback ports belong to `command-shell`
  (guarded by the control token, in the environment only) and to the CLI's agent-host supervisor, which checks a token
  of its own and answers the leaked one with 403. Every process we start ourselves keeps this rule strictly.
- **On a session that reads commands on stdin** (the shared session's `ShellRuns`, terminal mode's runner):
  `commandsFor` writes the environment as an **assignment prefix** on the inner `sh`, each value `posixQuote`d:
  `NAME='value' … sh -c '<script>'`. The session shell reads that line from its stdin and puts the values in the
  child's environment, so no `ps` shows them. Never inside the `sh -c` text.
- **On the direct channel** (`planScript`), the remote command is `ssh`'s own argument on the client and `sh -c`'s on
  the host, so neither an assignment line nor a prefix may be in it. A script **without** input already goes on stdin
  (`sh -s`) and keeps its assignment lines there. A script **with** input and a non-empty environment must also get its
  environment through stdin, ahead of the input, with the remote command naming no value. The exact shell form is the
  card's (ssh-32), proven by a row against a real `sh` and `ps`. A script with input and an empty environment is
  unchanged.
- Rows: for each of the three paths, a script whose environment holds a marker value runs, and the marker is in no
  process's `args` (`ps -eo args`, on the host and the client) while it runs; and the value reaches the script.


"Over this connection" (ruled 2026-10-08): the helper's shared `ssh` runs with `-T` and no command, so the remote
login shell reads standard input; S10's `runScript` writes the script to that session's stdin (the two-mode
bootstrap) and reads its result block from stdout, one run at a time (the helper serialises; probe, install, start
sequentially), while the `-D` SOCKS forward rides the same session: one login, prompts once. `copyToHost` is the one
exception and runs `scp` as its own login (F-2405). **It runs in a hidden S8 login terminal** (ruled on #253 Q11,
2026-10-12): F-2405 BR-8 makes the copy a hidden terminal task, so the editor's workspace-trust gate applies (AC-9),
and a second login on a password host asks there. The copy terminal's output goes through T2's prompt reader and its
questions through connect-16's owner, as the install terminal's do; F-2405 AC-10 (no tab, no panel) holds because the
terminal is hidden. Interim until it's built (on main only, a 0.2 release blocker under #299; daedalus's refinement): `scp` as a process
with an **empty askpass environment** and no tty, and **no option beyond S2's list** (which gives `scp` `-v` and the connect timeout, #253 Q13). scp then
can't ask, so a password host's copy fails at once as `copyFailed` (OpenSSH 10.2: exit 255 in under 0.1 s, `Permission
denied (publickey,password,keyboard-interactive).`) instead of hanging. That interim skips the trust gate (AC-9) and
must not ship. No ControlMaster or ControlPath is ever added (the S2 rule
stands, POSIX and Windows alike). The lease exposes the session through the helper's request channel (a
`runScript` request whose reply streams lines and ends with the result block) beside the SOCKS port and the shared
record; after `start` the session stays as the forward's carrier and later runs (kill, cleanup) use it when idle.
Rulings from the build (2026-10-08, #183): a run's script goes to the session's stdin as `sh -c '<quoted>'` between
two marker lines carrying an unguessable per-run nonce, its input as a base64 here-document (bounded by the policy's
`maximumInputBytes`; a larger input fails as `spawnFailed`, and a caller with such an input uses `copyToHost`
instead); lines before the start
marker are login noise and dropped; the script's lines go to the asking lease only; the end marker carries `$?`. The run number is allocated by the connection (one counter per lease, so two channels over one connection never collide), never by a channel; a script of 128 KiB or more is refused before the run as `spawnFailed` (it travels as one `sh -c` argument and the system's E2BIG would not reach the output the session carries; the constant is a system fact, not a policy value; amended 2026-10-08, #183 delta).
The shared channel's three policy values (ruled on #253 Q10 part 2, 2026-10-12), named constants in remote-ssh's
bounds:
- `runDeadlineMilliseconds` is **derived, not stated**: `SERVER_BOUNDS.downloadSeconds + SERVER_BOUNDS.readySeconds`
  plus a 5-minute margin for unpacking (about 35 min with today's Q7 values: 30 min + 15 s + 5 min). The deadline must never be shorter than the
  longest step a run may legitimately take, and deriving it keeps that true if Q7's bounds change. Every run (probe,
  install, start, extensions install, kill) gets its own deadline from its start.
- `runWaitMilliseconds` is the deadline plus 5 minutes (41 min today): one run's deadline plus a margin for the run
  queued ahead, since the helper serialises and the steps run one after another.
- `maximumInputBytes` is **1 MiB**. It guards the session against an unexpectedly large input, which would be written
  through the shell as base64 while every other run waits. It's not a path switch: nothing falls back automatically.
  Script inputs are small files the extension makes (a token, a script); an archive always goes by `copyToHost`. A
  caller with a larger input must use `copyToHost` itself.
One run at a time, queued in arrival order; a run's deadline counts from its start, and a run past it ends the
session (a wedged shell is indistinguishable), which every window hears as `transportLost`; when `ssh` ends, the run
on it and the queued runs fail `channelClosed`. A cancelled run is abandoned, never killed (nothing on a plain stdin
stops one script without ending the session); the pipeline cancels only before the tunnel is up. Only standard
output is read: the lifecycle scripts print their result block there; the session's stderr is `ssh -v`'s log. The
streamed placement of V4 is not served by the session; `scp` is. Non-POSIX login shells are the slice-3 variant.

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
| `verification` | ordered list from `headerHash`, `lengthOnly`, `none` | `none` until the room names one | `none` until the room names one (athena, containers contracts §5) | `headerHash`, then `lengthOnly` (F-6301 BR-6, Q3) |
| `environmentSetup` | a host path to source before install and start, never on reuse; or none | none | none | the distro's server-env-setup (F-6303 BR-1 to BR-5) |
| `requirementsCheck` | `none`; `bundledHelper` (lib-server runs the server's `bin/helpers/check-requirements.sh` before each launch: exit 99 aborts the start with its output as facts, anything else launches; amended 2026-10-14, containers-21, #903); `bundledHelperPlusAlpineProbe` (the same, then the Alpine libstdc++ probe). A helper that is missing from the archive or can't run (exit 126 or 127) launches, as any exit other than 99 does, so a server of a product we don't pin is never refused by it. `serverBundled` (the launcher's own exit 207) is gone: the pinned VSCodium server's launcher runs no check and never exits 207 (amended 2026-10-20, proteus and athena on #253, connect-79). A criterion of F-2401 or F-6302 that names exit 207 reads it as the helper's exit 99, since the dialog is the same; a row that asserts the code itself cites the ruling in its name, `(ruling-253-…)` | `bundledHelper` (F-2401: exit 99 shows its dialog with the helper's output; #253) | `bundledHelper` (F-0503 5.0 step 6, 7.E1; athena on #902) | `bundledHelperPlusAlpineProbe` (F-6302; #253) |
| `allowedExtraStartOptions` | a list from an allow-list: `fileWatcherPolling`, `useHostProxy` (the server's `use-host-proxy` option), `forceDisableUserEnv` (the server's `force-disable-user-env` option: core doesn't resolve the user's login-shell environment; amended 2026-10-19, proteus and athena on #737) | none | `useHostProxy` and `forceDisableUserEnv`, both on every start. `useHostProxy`: F-0503 BR-18, remote-oss/remote-containers#122 Q6; athena 2026-10-14. `forceDisableUserEnv`: F-0416 BR-11 to BR-13, so C3's `userEnvProbe` probe is the only source of the user's environment, `none` included; #737 | `fileWatcherPolling` for WSL 1 (F-6601) |
| `extensionEntries` | `identifiersOnly` (an entry that isn't `<publisher>.<name>` is dropped with a warn); `asWritten` (each entry goes to `--install-extension` as written, suffix included, unvalidated, as one quoted argument, never interpolated; amended 2026-10-14, containers-16, #894) | `identifiersOnly` (unchanged) | `asWritten` (F-0505 BR-2, BR-4, BR-7; AC-17, AC-29: `id@version` and `id@prerelease` pass through, the server skips what it can't install). No entry starts with `-`, because C10's merge applies removals and keeps none | `identifiersOnly` (unchanged) |
| `installUmask` | `inherit` (the install and start scripts keep the umask they were given); `022` (they set `umask 022` first; amended 2026-10-14, containers-25, #924) | `inherit` (a login's umask is the user's own choice) | `022`: `docker exec` runs with umask 0000, so without it the commit folder on the shared `vscode` volume is 0777, writable by every user of every container that mounts it (F-0419 AC-37: 0755) | `inherit` |
| `cleanup` | `keepNewest(n)`; `onlyCurrentRemoveLeftovers`; `onlyCurrentKeepLeftovers` | `keepNewest(5)` (F-2413 BR-9) | `onlyCurrentKeepLeftovers`: the `vscode` volume is shared by every dev container (athena, containers contracts §5) | stepwise: `onlyCurrentRemoveLeftovers` (F-6304 BR-8, AC-9); single script: `onlyCurrentKeepLeftovers` (BR-7) |
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
- **A secret never enters a script as text** (F-2003 BR-14; athena on #253, 2026-10-20, with proteus). A credential, a
  token, or a value that comes from a user setting reaches the run only through the run's `environment`, where it's
  marked secret, so the log names it whatever its length. A value written into the script itself (an `assignment()`)
  is seen by neither the mark nor the name guard. An address that may carry a token (the template override, V4) is
  logged with its scheme, host and path only (#1087).
- The scripts trap HUP, INT and TERM and release the host lock before exiting, so a killed `ssh` never leaves later
  connects at `LockBusy` (found in review, 2026-10-08).
- macOS sockets go in `TMPDIR` (F-2702).
- Windows uses no WMI process query, and a standard Windows user is not failed on purpose: no setting, and the
  reference's recorded failure is drift (R-86, F-3908). The PowerShell script's details are provisional (lab) until
  F-2701's capture runs (D-60).
- In `stepwise` mode each action is its own `runScript` with one log line: remove per the cleanup policy, create
  `bin/<commit>-<epoch ms>`, unpack from the streamed archive stripping the top folder (ruled 2026-10-08: a leading `./` is not a folder and is dropped first; the top folder is stripped only when every entry shares one, else entries keep their paths, so a REH archive packed without a wrapper keeps `bin/`, `extensions/`, `out/`; the Windows script follows the same rule), rename to `bin/<commit>`
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
| `plan` | host facts, profile, P3's result or failure, install path setting, download mode, existing layouts reported by the probe | a plan: reuse (`bin/<commit>` or the reused CLI layout of F-3902 rule 10), or download (where, URL, the redirect rule from P3), plus data folder, launcher, lock place | `noSource`, `invalidOverride`, `invalidInstallPath` (F-2407 BR-3, before any ssh) |

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
  licence classification (R-80) is tied to the TEMPLATE's host, never the final one; which final hosts are
  allowed follows the resolution step that produced the address, because whoever chose the source decides where it
  may send the download (ruled 2026-10-16, #1031): for the user's override (`override`) any host; for the product's
  template (`productTemplate`) the template's host, the hosts the product's `product.json` lists in
  `serverDownloadRedirectHosts`, and the hosts the product table lists for the template's host; for the built-in
  table (`builtInTable`) the template's host and the hosts the product table lists for it (for example `github.com`
  → `objects.githubusercontent.com`, `release-assets.githubusercontent.com`, the GitHub release-asset hosts). Under
  every step a redirect never lowers the scheme (an https source never ends on http). `lib-product` turns the
  resolution and the profile into the redirect rule (`any` or a host list); the plan carries it and V4 and the
  download port apply it, so no other package looks at the step or the table. Any other final host is a
  `serverDownload` failure with a reason; the final URL is logged (origin and path only). A response that gives the facts of no rule and
  whose record lists no `none` rule counts as verified: there is nothing to check against, and the record's order already says what to prefer (ruled 2026-10-08, #158). A
  kept entry the host cannot unpack is deleted and downloaded once more, so one bad entry does not fail every later
  connect; the transfer deletes a kept entry in no other case (ruled 2026-10-08, #158). (Ruled
  2026-10-08, corrected the same day: a plain same-host rule would fail every GitHub release download.)
- Credentials (ruled 2026-10-16, #1033). A client download reads credentials from the client's netrc file only:
  when `NETRC` is set and not empty, the file it names and no other (a missing file there means no credentials);
  else `~/.netrc`, else on Windows `%USERPROFILE%\_netrc`. Each request of the redirect chain gets Basic
  `Authorization` only when its host has its own `machine` entry, its scheme is https, and the user
  name and password are both present. The header is built per request and never carried to another host. The
  `default` entry and `macdef` are ignored, because `default` would send the credential to any host, a redirect
  target included. A matching entry on an http request is not sent, and the log says so once. The file is read once
  per transfer, through a port that the library tests with a fake. No settings field, prompt or secret store holds
  credentials. A source that takes a query token keeps working through the template form of the override. A
  host-side download (`hostFirst`) runs the host's own tools and is not changed. Logs never show the header, the
  password or the file's contents.
- A final response of 401 or 403 fails at once as `localDownload`, cause `unauthorized`, with its status. It is not
  retried, because a retry can't succeed: Remote-SSH retries no client download anyway (F-2405 AC-12), and Dev
  Containers skips, for this cause only, the one retry it gives every other `localDownload` (F-0503 7.E2). V3's
  placement fallback is unchanged. Its STR:S071 {0} starts as for any HTTP error, `Server returned 401` or `Server
  returned 403` (F-2405 AC-12), then a colon and the hint: the source asked for credentials, the host, and both ways
  to provide them (a netrc `machine` entry, or a token in the template).
- Bounds are the library's (R-79): `DownloadRequest` carries `deadlineMilliseconds` (the whole transfer),
  `stallMilliseconds` (no bytes for that long ends it) and `maximumBytes` (the content length when known, else the
  library's default ceiling, 1 GiB; the values are lib-server's named defaults, ruled on #253 Q7), plus cancellation; the port implements them and the library proves them with a fake port
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
| `installExtensions` | H1, server, ids filtered by F-2506 BR-2, a deadline (the library's named default of 120 s unless the caller passes one) | done with one result per id, or `notRun` with its reason (`cancelled` is the caller's, `deadline` the step's); failures are logged per id (F-2506 Q1 (b)); no host lock, so a second window never waits on it (ruled 2026-10-08, #151) | none raised |

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

#### V7a. The CLI path's start and control protocol (cli-01, #412; brief-cli-path.md §4, §4a)

Read from `[cli]` at `07f806f999227108933c2e30515b26eecc1fda74` (`cli/src/commands/tunnels.rs` `command_shell`,
`cli/src/commands/args.rs` `CommandShellArgs`, `cli/src/tunnels/control_server.rs`, `protocol.rs`, `challenge.rs`,
`code_server.rs`, `cli/src/log.rs`). Measured 2026-10-12 against a CLI built without `vsda` (`1.140.06729-insider`),
on the harness host image (Alpine 3.22, aarch64). A CLI's `--version` reports its build's own revision. The `[cli]`
commit is the one its release names as its upstream.

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `startCli` | H1, the placed CLI, its data folder `~/<serverDataFolderName>/cli`, a token | the CLI's port on the host's loopback, the token, the CLI's process id | `serverStart` when no ready line comes within the ready bound (section 6's fallback row), `cancelled` |

**Start.** `VSCODE_CLI_REQUIRE_TOKEN=<token> <cli> command-shell --on-host 127.0.0.1 --on-port 0 --cli-data-dir
<data>`, under `/bin/sh` (F-2103 §6.7), inside V5's lock loop, as `startOrReuse` is.
- **The token goes in the environment variable `VSCODE_CLI_REQUIRE_TOKEN` and nowhere else** (`[cli]` `args.rs`:
  `require_token` reads that variable). It is never on the command line, where any local user can read it with `ps`, and
  it is never omitted: without a token the CLI accepts any caller (`AuthRequired::VSDA`, which a CLI without `vsda` signs
  with a public hash).
- `--on-port` takes 0 to 2 values. With no value or `0`, the system picks the port; two values are a range.
- `--server-data-dir`, `--extensions-dir`, `--reconnection-grace-time` and `--install-extension` pass through to the
  server it starts.
- **Ready line:** `Listening on 127.0.0.1:<port>`, once, on standard output (`log.result`). The CLI then serves
  connections until it is ended.

**Control protocol.** The port speaks msgpack-RPC: concatenated msgpack maps.
- A request is `{id, method, params}`. A reply is `{id, result}` or `{id, error: {code, message}}`. A notification is
  `{id: nil, method, params}`.
- **Challenge:** `challenge_issue {token}` replies `{challenge}` (16 alphanumerics). Then `challenge_verify {response}`,
  where `response` is base64url without padding of SHA-256 of the challenge. That holds for a CLI without `vsda`
  only. A `vsda` CLI's challenge can't be signed by the extension, which is section 6's "CLI doesn't start" fallback.
- **Serve:** `serve {socket_id, commit_id, quality, extensions, connection_token, use_local_download, compress}`.
  `commit_id` is the CLI's own commit: a patched CLI expands its server template only for its own release.
  `use_local_download` makes the client download the server; `compress` is `false`.
  `connection_token` is one token per host (card cli-07; F-2409 BR-11): the first connect creates
  `<CLI data folder>/connection-token` (0600, under `umask 077`, a temporary file then `ln`, so a racing connect reads
  the winner's), every connect reads it back from a script's output and passes it, and it stays after close and Kill.
  The found server then holds the token every window uses. The token lands in the server's argv: S10's documented
  deviation.
  The host also holds `[cli]`'s own `cli/agent-host-token` for its agent-host supervisor, which reaches the server only
  through its environment. The two are never the same value (cli-07 ruling on #523): the server's token is visible in
  argv, and the deviation is acceptable only because it opens nothing another user can reach, which a shared value would
  undo for the supervisor's loopback bridge. F-2409 BR-11's single file is a recorded deviation for this reason.
  - While it runs, `serve` streams `serverlog {line, level}` notifications. Levels are 0 trace, 1 debug, 2 info,
    3 warn, 4 error. Every level reaches the caller.
  - It replies `{}` when the server has started.
- **Bridge:** each `serve` attaches one bridge for its `socket_id` (`[cli]` `attach_server_bridge`), so every editor
  connection has its own `serve` before its first frame; only the first installs or starts the server. The connection
  then rides as `servermsg {i, body}` frames in both directions, and `serverclose` ends one. Only the CLI sends
  `serverclose`; `[cli]` takes none from the client, so a socket the editor closes (even while its `serve` is pending)
  stops being relayed and its bridge on the CLI goes with the control connection (#477). A `servermsg` for an `i`
  with no bridge fails with `NoAttachedServerError`, unanswered since `servermsg` goes without id.

**The `serverlog` lines of a first install, in order, and S045 (F-2103 5.0 steps 6–8):**

| Line (`level`) | S045 |
|---|---|
| `Checking <data>/servers/<Quality>-<commit>/log.txt and …/pid.txt for a running server...` (2) | — |
| `Installing and setting up <server name>...` (1) | — |
| `Downloading <product> server -> <temporary file>` (2) | shown, indeterminate |
| `server download progress: <bytes>/<total> (<pct>%)` (0), about every 2.4 % | the percentage |
| `server inflate progress: <files>/<total> (<pct>%)` (0) | stays at 100 % (step 7: the unpack isn't shown) |
| `Server integrity verified, version: <release> / <commit> / <arch> / ` (0) | stays at 100 % |
| `Server setup complete` (1), `Starting server...` (2), `Starting server process: "<path>"` (1) | stays at 100 % |
| `Server bound to <socket>` (0), `Extension host agent listening on <socket>` (0) | stays at 100 % |
| `Server started` (2), then `serve`'s reply | closed |

With the server already present, `serve` prints the check line and the start lines with no download, in about 0.1 s
(F-2103 BR-8), and S045 is never shown. The server listens on a socket under `/tmp`. The bridge, not a forward,
reaches it.

**Errors.** A failed `serve` sends a level-4 `serverlog` line `Error installing server: <text>`, then the error reply.
The reply's `message` is the Rust `Debug` form, which `parseCliServeError` reads, for example
`WrappedError(WrappedError { message: "<text>", original: "<detail>" })`. The challenge's errors are
`CodeError(AuthChallengeBadToken)`, `CodeError(AuthChallengeNotIssued)` and `CodeError(ServerAuthRequired)`. Every
measured error had `code: -1`.

**Lifetime** (metis on remote-ssh#21: the reference's bootstrap group goes at about three minutes of its own age,
and nothing visible depends on it, so the choice is ours). The CLI is started with `--parent-process-id` naming
the connect's own session process on the host (the login shell that runs it), so `command-shell` ends when that
session ends, after its open connections finish. The server it started outlives it and is found again by the next
`serve` (F-2103 BR-10, AC-33). A reconnect starts its own CLI beside a lingering one (BR-8). Over a shared session
the session outlives the window, so the window's release and the extension's `deactivate` stop that connect's own CLI,
best effort (#412, triton on #477): the CLI process only, behind the exact two-field guard, never its children, since
the server it started is the one the other windows' CLIs serve. A CLI a crash leaves ends with the shared session.
Nothing stops another connect's CLI, and the shared record holds no CLI token.
The CLI's agent-host supervisor (`<cli> --cli-data-dir …`) is one per host: the first `command-shell` starts it,
later ones use it, and it outlives every CLI and the shared session, as the server does (daedalus measured, #412).
The release stop never touches it.

**Logging.** Every `serverlog` line goes to the connect's log. Only the error line (level 4) may reach a failure's
detail, as text the presenter shows through S031 (contracts R1: no other library text in a dialog).

**Layout** under `<data>`: `agent-host-token`, and `servers/` with `lru.json` (the kept servers by folder name),
`.locks/`, and `<Quality>-<commit>/{log.txt, pid.txt, server/}`. The server is in `server/`, and its launcher is
`server/bin/<serverApplicationName>` (F-3902 rule 10's reuse).

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

Bounds (ruled 2026-10-12, #253 Q7): every time and size bound of the connect lives in a named-defaults module of the
library that owns it, each value with its basis (a spec row, or the ruling). Where the reference had no bound, R-79's
bounded wait catches a hang and never ends a slow but working operation the spec's acceptance tests require: a
download is bounded by a stall (60 s without bytes) with a generous runaway ceiling (30 min, 1 GiB unannounced);
the host download by 30 min (F-2403 AC-24 requires at least 10). **The server's ready wait is 15 s** (amended 2026-10-13,
#253 Q7 follow-up): F-2409 AC-25 and AC-26 bind that wait itself, not only a hang. A server that never reports a port
fails with STR:S135 no earlier than about 13 s and no later than about 20 s, and a healthy server slower than 20 s
fails once and is found running on Retry (BR-10: 14–16 s observed). Here the spec's acceptance tests require the end,
so R-79's "never end a slow but working operation" doesn't apply. A server that exits before reporting a port is
reported at the end of the wait, not at once (AC-25: "even though the server process failed earlier"), and a port line
written before the exit still counts (connect-26). The prerequisites check fails at once, before any wait: the
requirements helper's exit 99 ends the start before the launch, with its output (§5.0 `requirementsCheck`; amended
2026-10-20, #253: the pinned server's launcher never exits 207). The
CLI path's first `serve` keeps its own bound
(V7a: the host download plus this wait). The table with every value and its basis is on #253 (Q7).

### V9 server-cache

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `cacheFolders` | product, commit, platform, whether a volume is mounted at `/vscode` (area C decides the mount, F-0419) | a pure function giving the volume tree for servers, `<serverFolder>/bin/<platform>/<commit>`, and the extension cache folder: `extensionsCache/` for `code` and `code-insiders`, `extensionsCache-<applicationName>/` for every other product. `<serverFolder>` follows the same rule (ruled 2026-10-12, #279; ADR-0006 decision 4, R-58: products share commit ids, so a server tree keyed by commit alone would hand one product's server to another): the reference folder for `code` and `code-insiders`, `<applicationName>-server` for every other product. The name comes from lib-product's product table (`volumeServerFolder(applicationName)`), never a literal in lib-server | none |
| `clientArchiveFolder` | profile, quality, commit, the extension's cache root | the kept client archive folder: the reference layout for `code` and `code-insiders`, with an `<applicationName>` level for every other product, so two products never share a name | none |

Rule: an entry downloaded from another gallery is never reused (R-58, F-0419 BR-18). The container transport's
contract (area C) defines the volume.

**Install into the volume (athena, 2026-10-14, containers contracts §5):** lib-server's install step takes an optional
`installTree`, V9's `serverTree`. When it's set, the archive is extracted into `installTree` unless that folder already
holds a complete server, renamed into place only once extraction has finished (F-0503 5.0 step 5), and
`<dataFolder>/bin/<commit>` becomes a symlink to it, created or kept (F-0503 BR-3). Without it, nothing changes.

---

## 6. lib-forwarding

Ruling 2026-10-10 (F-2104 BR-11 answered by the room): `ClearAllForwardings yes` with the shared connection on
drops the server's own `-D` in the reference and the window hangs (7.E4). The family detects it from `ssh -G` before
any `ssh` runs and fails the connect at once as `invalidSetting` with a reason naming the option (card ssh-14; an
`[adaptation]`, R-79 forbids the hang); the second-ssh and socket paths are not blocked. In socket mode the user's
forwardings are applied by the tunnel ssh (the family's interim rule; BR-11 keeps a lab need for it).

Rulings from the build (2026-10-09, #223): the connection contract `Duplex` carries back-pressure (`send` returns
whether more may be fed, `onDrain`, `pause`, `resume`) and the relay bridge honours it both ways, so a slow side
slows the other instead of growing a queue; the SOCKS5 dialer over the shared connection's `-D` relay (no
authentication, connect to the host's IPv4 loopback port, every handshake wait bounded by a policy value) and the
`node:net` loopback adapter (127.0.0.1 only, errors as closes, early bytes held until the first listener) live in
lib-forwarding as the window tunnel's adapters; the `ssh -N -L` second-session adapter stays lib-ssh's.

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

Rule (ruled 2026-10-12, #253 Q1): a tunnel can end after `open` without being asked to. `LocalPort.listen` takes
`onFailure(detail)`, which fires at most once, for an error after listening. The adapter then closes the server. The
`open` outcome carries `onClosed(listener)`. When the listener fails, the tunnel closes its active connections and
tells every listener once with the detail. A listener registered after the end hears it at once. `close()` that the
caller asked for does not fire it. An error after listening is never left without a handler.

### W3 tunnel-factory

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `factoryFor` | a dialer, privacy options (Tunnels: `private`, `public`, F-8202) | the resolver's tunnel factory and tunnel features | none |
| `environmentTunnels` | `LocalForward` entries from S4 | the resolver's environment tunnels (F-2507) | none |

Rule: ports forwarded before a reconnection are revived over the new dialer (F-2104 Q4 and F-2507 Q1, recommended).

Rule (ruled 2026-10-12, #253 Q1): when an entry's tunnel reports closed (W2), the entry leaves `forwarded()` and is
not revived. Telling the editor (the resolver's `Tunnel.onDidDispose`) belongs to area B's adapter.

### W4 default-forwards

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `applyDefaults` | `remote.SSH.defaultForwardedPorts` | one `openTunnel` per valid entry after resolve, never on reconnection | none raised (invalid entries are skipped and logged) |

---

## 7. remote-ssh, area A part

Rulings from connect-02's build (2026-10-09, #186): R4 (`decideTerms`: the platform and `remoteCommandInEffect`
from the settings and the host string) runs before any `ssh` process and its result feeds the channel, the request
and, after card connect-06, the probe's and install-extensions' parameters; the connection step has no pipeline
bound of its own, since S9's login bound (which pauses while a question is open) is its bound; the picker and the
licence modal are user waits and unbounded; the archive format follows the address's extension (`.zip` → `zip`,
else `tar.gz`); the gate's cancellation is card server-11.

### R1 connection-pipeline

`connect` and `cancel` as agreed with area B. The inputs are the decoded target, the raw host string, the attempt,
the reconnection flag and the window identity. The outputs are Connected or Failed with kind, reason, retryable,
userAlreadyNotified, hints and diagnostics.

The step order is in `components.md`. Phase events are `initializing`, `waitingForOtherWindow`, `downloading`,
`downloadingLocally`, `copyingWithScp`, `installing`, `settingUpTunnel`, `waitingForForwarding` and
`serverDownloadPercent`.
`waitingForOtherWindow` (ruled on #253 Q12, 2026-10-12) is F-2102's STR:S157, "Waiting for other windows to connect",
shown as the progress's phase text after S129 with no "details" link (F-2102 5.2 step 3, 5.3 step 4): the connection
step reports it when the lease's `waitingForOtherWindow` notice arrives. It is a phase, not a separate surface, so the
prompt surface's `showWaiting` leaves the PromptEditor port. The mirrored prompt shows at the same time and is
independent of it (5.2 step 3: the phase **and** the mirrored input together). When the login falls to this window
(the owner gave up), the step reports `initializing` again, so the phase moves from waiting to this window's own login
(F-2102 5.3 step 4, "(details) Initializing VS Code Server"). Today lib-ssh's client becomes the owner on the helper's
`accepted` reply without telling anyone, so the client gains a notice for it (`loginOwned`), emitted when a window that
had been told `waitingForOtherWindow` becomes the owner. The connection step maps it to `initializing`.

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
- R1's validate step runs S2's `validateTarget` first (ruled on #253 Q9, 2026-10-12; F-2205 POST-1: no `ssh` process,
  no pre-connection script and no platform question for a rejected name). A problem fails as `invalidSetting`, which is
  permanent (F-2205 PRE-2: nothing can change between attempts), with the reason `{id: 'S119' | 'S120' | 'S121' |
  'S122', values: [character]}`. The dialog shows S031 with that reason (F-2205 7.E1 to 7.E6); the kind is shown
  nowhere, so no new kind is added to the closed list.
- Order before the connection (ruled on #253, connect-14): validate, the pre-connection script, R4's terms (with the
  platform picker), then S1's check and S4's lookup, then the lease. R4 comes before S1 because no `ssh` process may
  run before the picker is answered, the `-V` check included (F-2206 AC-2, F-2101 AC-28).
- The facts the lookup gives (the accepted programs, the effective options) belong to one connect: the connector
  makes the steps of each connect afresh, and nothing found by one connect is read by another. The probe's and the
  tunnel's bounds follow the lookup's `ConnectTimeout` (F-2105 BR-1), so the pipeline reads them after the lookup.
- A lookup that fails is classified by S5 as the connection's own `ssh` run would be (`classify`, purpose
  `connection`): ssh's complaint goes to the log, and the dialog shows what that complaint gives (F-2201 7.E6 and
  AC-26: a refused file shows no reason). A lookup past its bound fails as `timeout` with no reason.
- The login's questions reach B's prompt surface from the moment the connection is acquired until the login ends,
  with the connection's notices, `answer` and `refuse`; a question nobody can see would be a wait without a bound
  (R-79).
- `Connected` is data; the pipeline's internal step result carries a `release` handle beside it, which the
  connector keeps for `cancel` and window teardown (connect-02, accepted 2026-10-08).
- Every attempt makes a fresh connection when S9 reports the transport lost (F-2505 BR-1).
- **A dialog reason is never a library's internal text** (ruled 2026-10-12, found via connect-18; the same class as
  #253 Q10's `ofAcquire` fix). A `detail`, `cause`, `reason` or `mismatch` string from a library failure (lib-host's
  `failFrom` details such as `no end in time` or `the session ended`, a transfer's cause) goes to the connect log
  (F-2003), never into `Failed.reason`. A reason is an id: one from the spec's string table, or our own named entry,
  set per kind where the spec places it. `serverDownload` carries **S043** (`Downloading VS Code Server failed. Please
  try again later.`, F-2403 7.E1, POST-4), `serverInstall` carries **S075** (`Failed to install the VS Code Server`,
  F-2403 7.E2/7.E3), and a kind with no placement in the spec has no reason (S030). ssh's own failure lines still
  reach the dialog through S5's `classify`: they are ssh's words, which F-2601 shows.
- Every recorded hang becomes a bound wait followed by F-2601's dialog (R-79). This covers:
  - F-2103 Q1, F-2104 Q1, F-2304 Q2, F-2308 7.E2, 7.E8, BR-6 and BR-11 (the former Q3 and Q4), F-2405 Q3;
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

- `RequestContext.notify(body)` (added 2026-10-08, #183): a message to the lease that sent the request only, before its reply; `broadcast` stays for all leases.

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
| `stop` | registry folder, namespace, recordKey | done, also when nothing runs. When it returns, the stopped helper's record is gone, so nothing it stored for the key outlives the call (ruled 2026-10-13, #532 and #597: F-2412 BR-7 and POST-3, F-2411 6.1 step 2). A helper that answers removes its own record before it closes its endpoint (X2), and `stop` waits for that close, bounded by the hello limit. `stop` removes the record itself only when the helper doesn't answer or doesn't end in time, and only while the file holds the stopped helper's nonce: a record a new helper wrote (another nonce) stays | none |

### X2 helper-runtime (bundled into each helper script)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `serve` | endpoint, record payload and record path, end policy, message handler | runs until the end policy fires or `stop` arrives. On either orderly end the helper removes its own record, when the file still holds its nonce, **before** it closes its endpoint (ruled 2026-10-13, #597). While it still answers, no acquire may replace its record (a joiner never replaces a live record), so this removal can't delete a newer helper's record, and the windows it served reconnect only after it is gone | none raised; the helper logs to its own file and exits |

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

