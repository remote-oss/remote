# Area A interface contracts (draft)

- Status: draft, ahead of the container view, for lib-ssh and lib-server only (A2, A3, A4, A8, A9, A10). A1, A5,
  A6, A7, A11, A12 and A13 follow in deliverable 2. A13 will carry two alternatives until F-8902 and the relay
  question are ruled.
- Date: 2026-10-06
- Author: `remote-architect-worker-1`; lead: `remote-architect`
- Binds: ADR-0003, ADR-0004, ADR-0005 (no editor CLI for Remote-SSH, dossier §4), ADR-0006 as revised on
  2026-10-06; R-28 and F-3905 (no telemetry, no payload lines in logs); R-47, R-58, R-68.

A contract names the operations, their inputs and outputs, the failure states, what the component owns, and what it
must never do. Shapes are named fields, not code. "Reason" always means the exact user-visible text that B shows in
F-2601's dialog. Feature ids are remote-ssh unless marked.

## 0. The remote host channel (consumed by A8, A9, A10)

lib-server never knows how it reaches a host. It receives a host channel. A2 and A3 implement it for SSH, and later
contracts implement it for `docker exec` (F-0503) and WSL. This is what lets the containers and WSL rooms reuse
lib-server.

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `runScript` | script text, interpreter (`posixShell` or `powershell`), environment additions, input text | a stream of output lines, then the exit status | channel closed, timeout (the channel's own), cancelled |
| `copyToHost` | local file, remote path | done | copy tool missing, copy failed with the tool's message, cancelled |
| `identity` | none | the key that names this host in locks and records: the host string for SSH | none |
| `platformHint` | none | linux, macOS, windows or unknown (F-2206: setting first, else unknown) | none |

The channel never interprets what the script prints. Parsing belongs to A8.

## A2 ssh-session (lib-ssh)

Purpose: the only place that builds an `ssh` or `scp` invocation and spawns it (ADR-0004).

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `validateTarget` | decoded target | ok | host or user rejected: STR:S119, S120, S121 or S122 with the offending character (F-2205 BR-2, BR-3); nothing is spawned |
| `invoke` | target, purpose (`connection`, `tunnel`, `oneShot`, `copy`), forwards (SOCKS port, local to remote port, local to remote socket), remote program (none, or `sh`), askpass environment from A4 | a session: output and error streams, input stream, exit status | client missing (from A1), spawn error |
| `effectiveOptions` | target | the values OpenSSH computes for that host (`ssh -G`): `ConnectTimeout`, `RemoteCommand`, `HostName`, `User`, `Port` | the config cannot be read (reason from ssh) |

Argument rules:
- **Host.** The host and user go in as separate arguments, never through a shell (F-2205 §16).
- **Config file.** `-F <file>` when `remote.SSH.configFile` is set, with `~/` expanded. Otherwise no config option
  (F-2201 BR-4).
- **`-T`** unless `remote.SSH.permitPtyAllocation` is truthy (F-2106).
- **Timeout.** `-o ConnectTimeout=<remote.SSH.connectTimeout>` only when the host sets none (F-2105).
- **`RemoteCommand`.** An `-o RemoteCommand=none` override when the effective config has one and
  `remote.SSH.enableRemoteCommand` is not in effect (F-2107).
- **Verbosity.** Enough `-v` for the classifier's lines (F-2109 BR-3).
- **Forwards.** `-D 127.0.0.1:<port>` for the SOCKS forward, `-L` for a second-ssh tunnel or a socket forward
  (F-2104 BR-1).

Everything else the user configures is passed through untouched. That covers the 43 keywords of F-2109 and
`ProxyJump`, `ProxyCommand`, `ControlMaster`, `ControlPath`, `ControlPersist` and the host-key and key options
(F-2102 BR-11, F-2305 BR-1, F-2307 BR-1, F-2310).

Process rules:
- Use the client A1 accepted, with the editor's environment unchanged plus A4's askpass variables (F-2101 BR-7).
- Standard input is a pipe and never a terminal. `SSH_ASKPASS_REQUIRE` is never set.
- Own wait: `ConnectTimeout` plus 2 seconds. It pauses while a prompt is open and ends at the first output or the
  setup step (F-2105, F-2308 BR-5).
- Error-stream lines go to A12, which owns the classification, and to the log.

Never:
- interpret an ssh option;
- write `known_hosts`;
- add keys to an agent;
- start a shell on the client.

## A3 connection-server (lib-ssh)

Lifetime, ownership and how it dies are in [local-connection-server.md](local-connection-server.md).

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `acquire` | host string, target, window identity, cancellation | a lease: SOCKS port, the shared record (remote port, OS, architecture, temp folder, connection token) when one exists, and the host channel over this connection | any A2 failure; `cancelled`; login failed (reason from A12) |
| `release` | lease | none | none |
| `kill` | host string | done, silently, also when nothing runs (F-2102 BR-7) | none |
| `events` | lease | `waitingForOtherWindow`, `ownerChanged`, `transportLost` | none |

Rules:
- One helper per host string, exactly as written, so an alias and a typed `user@host` are two keys (F-2102 BR-6).
- The record is written only after the connection completes.
- With `remote.SSH.useLocalServer` off, `acquire` is never called. The pipeline (A6) then uses A2 directly with A4's
  login terminal (F-2102 BR-10). `remote.SSH.remoteServerListenOnSocket` forces that mode too (F-2410).

## A4 ssh-prompts (lib-ssh, the one UI component of area A)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `askpassEnvironment` | lease or window, external askpass setting | the variables `ssh` needs to call our askpass program | none |
| `answer` | prompt text from `ssh`, display host ({0} as the user named it), owner or mirror | the answer text | cancelled (the askpass program exits non-zero) |
| `loginTerminal` | invocation, name (`install`, `SSH Tunnel`, `Uninstall VS Code Server`), reveal flag | a terminal session with its output events | trust refused (core) |

Classification of a prompt, first match wins:
1. **Host-key fingerprint.** A line of the form "<TYPE> key fingerprint is <FP>." followed by the "Are you sure..."
   line gives the quick pick STR:S001 with "Continue" and "Cancel" (F-2305 BR-2).
2. **Continuation.** The "Offending key" and "Matching host key" lines give the quick pick with STR:S012.
3. **Passphrase.** "Enter passphrase for key '<path>': " gives the masked input STR:S064 (F-2307 BR-3).
4. **Password rules** of F-2306 BR-2: "'s password:", then "Password:", then "Verification code:", else the raw text.

Rules:
- **Answers.** "Continue" sends `yes`. Escape and Cancel exit non-zero.
- **Focus.** The quick picks close on focus loss; the masked inputs keep focus (F-2305 BR-5, F-2306 BR-3).
- **Re-prompts.** In shared mode, a re-prompt shows ssh's "Permission denied, please try again." as its message
  (F-2306 BR-4).
- **External askpass.** With `remote.SSH.externalSSH_ASKPASS` on, shared mode, and a non-empty `SSH_ASKPASS` in the
  editor's environment, the environment is left alone and no input appears (F-2309).
- **Login terminal.** It is created hidden, with the home folder as working folder, and is never trust-exempt (F-3903
  rule 1). With `remote.SSH.showLoginTerminal` on, it is revealed and focused and every question stays in the
  terminal. Otherwise only F-2306's prompts become inputs, read through the proposed `terminalDataWriteEvent` and
  answered with `sendText` (F-2308 BR-2, BR-4).

Never:
- store an answer;
- log an answer or its length (F-2306 BR-10, F-2307 BR-10);
- add a limit or retry of its own (F-2306 BR-6).

## A8 host-bootstrap (lib-server)

Purpose: our own remote-side step, written from the specs, as one POSIX `sh` script and one PowerShell script shipped
as text. Neither is ever derived from the reference's scripts.

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `probe` | host channel | host facts: OS (Linux, Darwin, Windows), architecture token (x64, arm64, armhf), libc family (glibc or musl from `/etc/os-release`), OS release id, temp folder, login shell name, available tools (curl, wget, tar, flock), `SSH_AUTH_SOCK`, `DISPLAY` | unsupportedPlatform (F-2401: kernel or architecture refused), prerequisiteMissing (glibc 2.28, libstdc++ 3.4.25; `bash` only where a spec still requires it, dossier question 10), channel failures |
| `runStep` | host channel, step (`install`, `start`, `kill`, `uninstall`, `cleanup`), step parameters | one result block | a named status (below), with the host's message |

The result block is a fixed set of `key=value` lines between two marker lines. A8 parses it; nothing else does.

Statuses map one-to-one to the specs' categories and hint statuses:

| Status | Source |
|---|---|
| `LockBusy` | F-2408 |
| `NoDownloaderAvailable` | F-2402 |
| `UnpackFailed` | F-2402, F-2403 |
| `ServerDownloadFailed` | F-2403 |
| `CreateInstallDirFailed` | F-2407 |
| `UnsupportedArch` | F-2401 |
| `UnsupportedPlatform` | F-2401 |
| `LinuxPrereqs` | F-2401 |
| `ServerFailedToStart` | F-2409 |

Rules:
- **Downloader.** `wget` is preferred, then `curl`. Their configuration files are skipped unless
  `remote.SSH.useCurlAndWgetConfigurationFiles` is on (F-2403 BR-12).
- **Proxy.** Lowercase `http_proxy` and `https_proxy` are exported in the exact text of F-2404 BR-5. The host's own
  login environment wins (F-2404 BR-10).
- **Locks.** `flock` by default; atomic `ln` where `remote.SSH.useFlock` is off or `flock` is missing (macOS,
  F-2702). The lock file is `vscode-remote-lock.<user>.<commit>` in the commit folder, or in `/tmp` with
  `remote.SSH.lockfilesInTmp` (F-2408).
- **macOS.** Server sockets go in `TMPDIR`, never `/tmp` (F-2702).
- **Windows hosts.** The PowerShell script runs under `powershell` from the DefaultShell's answer or as the remote
  program, and its command line stays under 8192 characters (F-2701). Whether the conformant build must reproduce
  the standard-user failure of F-3908 rule 1 is open (question 1).

## A9 server-install (lib-server)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `ensureServer` | host channel, host facts (A8), product profile (A7), extension policy (override key, download mode), licence UI port, phase sink, cancellation | an installed server: data folder, launcher path, commit, layout (`bin` or the reused CLI layout) | noServerSource, invalidServerTemplate (A7's dialog already shown), licenceDeclined, invalidSetting (install path), serverDownload, serverInstall, lockTimeout, retriesExhausted, cancelled |

Order, matching F-3902 rules 10, 1, 11, 5 and 6:
1. **Reuse.** Use an installed server for the client's commit when one exists:
   - first `<root>/<serverDataFolderName>/bin/<commit>/`;
   - else the CLI layout `cli/servers/Stable-<commit>/server/`, started directly.

   Then go to step 4.
2. **Resolve.** Ask A7 for the archive URL. A7 shows the no-default dialog itself when nothing resolves.
3. **Download and unpack.**
   - The host downloads first. Then `remote.SSH.localServerDownload` applies:
     - `auto`: on failure, the client downloads through the editor's network stack and copies with `copyToHost`.
     - `always`: always on the client.
     - `off`: never on the client (F-2405).
   - The client copy is a temporary file, deleted afterwards (F-3902 rule 6).
   - The archive is unpacked into `bin/<client commit>/`.
   - The server's `--version` is checked. A different commit is rewritten to the client's, with one log line naming
     both (F-3902 rule 9).
4. **Licence.** The gate below runs before any download (cases i, ii) and before any start (case iii).

Rules:
- **Phases** go to the sink: `downloading`, `downloadingLocally`, `copyingWithScp`, `installing` (F-2304 BR-3).
- **Client lock.** `vscode-remote-ssh-<8 hex>-install.lock` in the editor's temp folder, one per host identity,
  waited on for at most 2 minutes with S157 shown. A lock whose owner process is gone counts as free (F-2408 Q1,
  recommended).
- **Host lock.** When it is busy, A9 ends the session, waits 1 second and retries, at most 30 times, each attempt with
  the progress text "retry N" (F-2408).
- **Install path.** `remote.SSH.serverInstallPath` is matched exactly on the host part. The value is validated on the
  client before any `ssh` runs (F-2407 BR-3).
- **Manual bootstrap.** `localServerDownload` set to `manual-bootstrap` takes the archive from
  `~/vscode-remote-ssh-bootstrap/vscode-server.tar.gz` and shows STR:S088 on every attempt (F-2406).
- **Exec-server mode.** `remote.SSH.useExecServer` is logged once per connect as not applied (F-2103 BR-13).
- **Licence gate (R-68).** It is shared by every extension. Pending the register's ruling, the gate fires when
  either the F-1402 test or the F-3902 rule 11 test holds. It shows a modal naming the terms, with a link and the
  buttons "Accept and Continue" and "Cancel". An acceptance is stored in per-profile global state under a key derived
  from the licence URL.
- **Caches.** Remote-SSH keeps no client cache. The R-58 cache folders belong to the container transport (F-0419)
  and arrive with deliverable 2.

Never:
- download Microsoft's server unless the user set the URL (F-3902 rule 1);
- accept licence terms for the user;
- write outside `<root>/<serverDataFolderName>`, the configured lock place and temp folders.

## A10 server-runtime (lib-server)

| Operation | Inputs | Output | Failures |
|---|---|---|---|
| `startOrReuse` | host channel, installed server, options (bind host, port range, socket mode, grace time, default extensions, licence accepted, proxy environment) | a running server: TCP port or socket path, connection token, process id, remote environment additions (agent socket link, `DISPLAY`) | serverStart (STR:S135, at the end of the start wait), invalidSetting (InvalidPortRange before any ssh; a bad bind host falls back to 127.0.0.1 after STR:S168), cancelled |
| `installExtensions` | host channel, running server, ids | done; failures are logged per id | none raised (F-2506 Q1, recommended (b)) |
| `kill` | host channel, data folder | done; the client side then drops the A3 record | ssh failure (STR:S076) |
| `uninstall` | host channel, data folder | done, silently | ssh failure (core's "Failed to run command") |
| `cleanup` | host channel, data folder | done | none raised |

Start options:
- `--start-server`, `--host <bindHost>` (127.0.0.1 by default) and `--port <0 or range>`, or `--socket-path` in
  socket mode;
- `--connection-token-file`;
- `--accept-server-license-terms` only after A9's gate accepted (R-68);
- `--telemetry-level off` (R-28);
- `--reconnection-grace-time` only when the setting is set and not 0 (F-2413);
- `--enable-remote-auto-shutdown`;
- `--install-extension` for each id of `remote.SSH.defaultExtensions` that matches F-2506 BR-2.

The server is ready when it prints "Extension host agent listening on <port or path>" ([oss]
`src/server-main.ts`).

Reuse: a server already running for this commit and data folder is reused with its port and token (F-2409, F-2413
BR-6). Otherwise a new one starts.

Remote environment:
- The forwarded agent socket gets a stable link `/tmp/vscode-ssh-auth-sock-<n>`, re-pointed on reconnection.
- `DISPLAY` is the session's value.
- Both reach the extension host through the resolver's environment and terminals through the environment variable
  collection (F-2311, F-2312).

Kill, uninstall and cleanup:
- **Kill** stops this data folder's server process tree and removes `bin/`, so the next connect reinstalls
  (F-2411; our layout is the reference's legacy one).
- **Uninstall** stops the processes and deletes exactly `<home>/<serverDataFolderName>` (F-2412).
- **Cleanup** runs on every resolve and keeps the five most recently modified `bin/<commit>` folders, deleting the
  rest with their log and pid files (F-2413 BR-9).

Never:
- stop processes of another data folder or product;
- stop a launcher it did not start;
- remove the user's ControlMaster or anything outside the data folder, apart from its own socket and agent link.

## Open questions raised by these contracts

1. **F-3908 rule 1 (ssh#85).** The conformant default must fail for a standard Windows user. Our PowerShell step
   uses no process query that needs WMI. Must the build fail on purpose, or may it connect?
2. **Login environment vs explicit `sh` (dossier question 10).** If A8 runs under `sh` as the remote program, login
   profiles do not run. F-2508 AC-2 still needs `~/.profile` variables in the server's environment. My proposal:
   the probe reads `$SHELL`. A POSIX login shell gets the script on standard input, as the reference does. Anything
   else gets `sh` after sourcing `~/.profile`. This goes to the remote-ssh room with question 10.
3. **Commit rewrite (F-3902 rule 9).** "Make the server's commit equal to the client's" is only practical by editing
   the unpacked `product.json`. Confirm the spec means that.
