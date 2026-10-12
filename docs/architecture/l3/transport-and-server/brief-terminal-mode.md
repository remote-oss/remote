# Coding brief: terminal mode, the login terminal (S8) and the two non-default window tunnels

> Issued by `athena` 2026-10-12 for daedalus, who turns it into cards. Answers #299 (1): terminal mode is in 0.2
> (slice 2 is in 0.2, build-order.md; #253 Q5 made the secondSsh and socket tunnel paths 0.2 release blockers), and it
> is on the critical path to the 0.2 tag. Contracts: `contracts.md` §S2, §S3, §S7, §S8, §S9, §S10, §R1, §W1–W3, §V7.
> Spec: remote-oss/remote-ssh F-2308 (#41), F-2102 BR-10, F-2104 6.2/6.8/BR-1/BR-2/BR-9–BR-11, F-2410, F-2306,
> F-2305 6.6, F-2307 AC-23, F-2105 BR-3, F-2704 6.4/BR-1/BR-6, F-2206, F-2311 BR-8. Binding: ADR-0003, 0007, 0008;
> R-29, R-79, R-26.

## What terminal mode is

The connection without the shared local connection server: `remote.SSH.useLocalServer` false, or socket mode on
(`remote.SSH.remoteServerListenOnSocket`, which forces the shared connection off whatever `useLocalServer` says:
F-2410 BR-2; lib-forwarding's `effectiveUseLocalServer`). Each window runs its own `ssh` in a hidden terminal. No
helper, no lease, no prompt mirroring, no S157 (F-2102 BR-10). Today card connect-15's interim fails every such
connect in validate; this brief replaces that interim.

## The flow (R1's terminal branch)

1. validate, then the platform question (F-2206 5.2: always asked in this mode when no entry decides), then the client
   check and `ssh -G` (connect-14 order, unchanged).
2. The connect wait starts right after the platform choice (F-2704 BR-6) and ends at the **first output of the
   install terminal** (F-2105 BR-3, F-2308 BR-5). After that only ssh's own timeouts apply, and a recognised prompt
   never times out (F-2306 BR-7).
3. The install connection: `ssh` with remote command `sh` and no pty (F-2704 BR-1, 6.4 step 2), in a terminal named
   `install`, working folder the local home, no askpass variables (F-2101 AC-30). One terminal per attempt, never
   reused (F-2308 BR-9). It carries the live connection: its end ends the window's connection (BR-7, 7.E5).
4. Prompts while it logs in (S7 over S8, below).
5. The probe, install and start run through S10 **over that terminal** (below).
6. The window tunnel by path: `socks` (dynamic forwarding on: the install `ssh` holds the `-D`, F-2104 6.3, BR-11),
   `secondSsh` (`ssh -L` with the tunnel's remote command, in an `SSH Tunnel` terminal, F-2104 6.2), or `socket` (always two logins, `-L
   <port>:<socket path>`, F-2104 BR-2, F-2410 5.0 steps 5–6).

## Components

### S8 login-terminal (new; lib-ssh port, remote-ssh adapter)

| Operation | Contract |
|---|---|
| `open(invocation, name, reveal)` | creates the terminal (`window.createTerminal` with `hideFromUser: !reveal`, the local home as cwd, never trust-exempt: F-2308 §16, F-3903 rule 1), starts the invocation, and returns a session: `onOutput(chunk)`, `send(text)`, `reveal()`, `onEnd(status)`, `dispose()` |
| output | read through the proposed `terminalDataWriteEvent` (`window.onDidWriteTerminalData`), filtered to this terminal, chunked as the editor delivers it. The event delivers raw data including VT escape sequences (the proposal's own doc), so **the adapter strips them and the port promises plain text** (ruled on #299): CSI, OSC and the other ESC sequences are removed, `\r\n` and `\r` are kept for the line splitter. Prompt and marker matching are then pure functions of plain lines, testable without a terminal. A sequence split across two chunks is held until it completes. **A held string sequence is bounded** (ruled on #341, after the DEC VT500 parser, vt100.net): an OSC/DCS/SOS/PM/APC string ends at BEL (OSC) or ST, **and is cancelled by any other ESC, by CAN (0x18) or by SUB (0x1A)**; the cancelling ESC starts the next sequence. A string still open after 4 KiB is dropped **through the next line end** (the line end too), and the text after that flows; with no line end yet, the following pieces are dropped up to the first one (ruled on #341: option ii, so the tail of an endless string never leaks into the line the prompt matcher reads). Otherwise one stray `ESC ]` in a host's banner would swallow the password prompt and every marker after it |
| `reveal` | `Terminal.show(false)`: reveals and focuses (F-2308 BR-2, 6.1 step 4) |
| trust | the editor's workspace-trust dialog gates the terminal. Cancel → the attempt fails at once and no `ssh` runs (F-2308 7.E7, AC-24); an answer later than the connect wait → the wait's timeout (F-2306 AC-28) |

- `remote.SSH.showLoginTerminal` is read once at the start of each attempt (F-2308 BR-3).
- With it on, every login terminal is revealed at creation and no question becomes an input (BR-2, BR-4).
- With it off, terminals are hidden (`hideFromUser`) and only recognised prompts become inputs (BR-4).
- The adapter is the only file that imports `vscode` for S8. The port is in lib-ssh, with a recording fake in
  `testing/`.

### Prompt recognition over terminal output (S7 terminal list)

- A line splitter over the chunked output (LineSplitter, which already strips a trailing `\r`), plus a **partial-line
  check**: a prompt has no newline, so the current partial line is also matched once the output pauses.
- The recognised set in terminal mode, with the setting off:
  - F-2306's three: `<user>@<host>'s password:`, `Password:` and `Verification code:` (F-2308 BR-4).
  - The host-key question by F-2305 BR-2's patterns (ruled below).
  - The key passphrase (F-2307 AC-23, ruled below).
  - `classifyPrompt`'s raw fallback (rule 5) does **not** apply in terminal mode: anything else stays in the terminal
    (F-2308 6.3).
- The answer goes back with `send(text + '\r')`. While an input is open, further output is held, not acted on
  (F-2308 BR-6); the wait on the open input is bounded under R-79 (BR-6's adaptation).
- A re-prompt carries no "Permission denied" line in terminal mode (F-2306 BR-4, AC-9).

### S10 over the install terminal (reuse, not a new channel)

- lib-ssh's `ShellRuns` and `SharedSessionChannel` already run scripts over one long-lived `sh` session, framed by
  markers. In shared mode the helper writes to ssh's stdin. In terminal mode the **same classes** take S8's `send` as
  their writer and S8's output lines as their reader. The marker framing, base64 input and deadlines are unchanged.
- **Constraint, corrected on #299 (daedalus, 2026-10-12):** the remote side has no pty (`sh` as a command, `-T`;
  checked against a real sshd: `sh` echoes nothing back), but the local terminal echoes what `send` writes into its
  own output. `ShellRuns` does **not** match markers as whole lines: the start uses `includes` and the end `indexOf`,
  on purpose, for scripts with no final newline. Fed its own echo, a run would start on the echoed `printf` line.
  **Ruled (option b): the commands never contain a marker literally.** `commandsFor` prints each marker from two
  pieces (for example `printf '%s%s\n' '<marker>:st' 'art'`, and the same for the end), so no echo, wherever it
  falls, can carry the marker text, while the printed line is unchanged. The matching logic stays as it is, and one
  framing serves both modes. Rejected: (a) whole-line matching (it would change the shared path's start-in-line
  behaviour) and (c) turning echo off (it acts on the editor's own pty and can't cover the first command). Rows:
  a run fed its own echoed commands starts and ends only on the printed markers, and collects no echoed line; the
  shared path's existing rows are unchanged.
- The terminal also merges ssh's stderr (the `-v` lines, F-2308 BR-8) into the same stream. The reader ignores lines
  outside a run's markers, as it does today.

### S3 / S2 changes

- Terminal mode's invocation: purpose `connection`, remote program `sh`, `-T`. It keeps `-v` (F-2308 BR-8 shows ssh's
  output unfiltered), and keeps S5's classification of ssh's own failure lines.
- The connect wait (`ConnectWait`) is started after the platform choice, and stopped at the first output chunk instead
  of the `authenticated` marker. A `mode` input to the wait's owner decides which.
- secondSsh and socket: purpose `tunnel`, **no `-N`** (the tunnel runs the remote command ruled under W2 below, which
  prints F-2308 BR-10's line), `-L 127.0.0.1:<port>:127.0.0.1:<remote port>` or `-L <port>:<socket path>` (already
  built). **No `ExitOnForwardFailure`** (corrected on #340, 2026-10-12): the extension doesn't add it. F-2104 BR-11
  applies the user's own forwards to this ssh, and BR-12/7.E6/7.E7 make a failing user forward end it **only when the
  user's host entry sets `ExitOnForwardFailure yes`**. Forcing it would fail the connect for every user whose entry has
  a forward that can't bind. The tunnel's own `-L` is safe without it: W1 has just found the port free, and the 10 s
  readiness wait (BR-10) fails a tunnel that never accepts.
- With dynamic forwarding off, the install `ssh` must not act on the user's own forwards (F-2104 6.2 step 1):
  `ClearAllForwardings yes` on that run only. S2's "never add" list gains this one exception, scoped to that run.
  Checked against a real sshd: a host block's `LocalForward` opens without it and doesn't open with it.
  **It also clears command-line forwards** (daedalus, OpenSSH 10.2p1: a `-L` given beside it didn't open). So it may go
  only on a run that carries no forward of ours: the second-login and socket paths' install run. The
  dynamic-forwarding path's install run carries our `-D` and never gets it; that path's user forwards are the user's
  own, as in shared mode (F-2104 BR-11). `buildInvocation` throws if the two are combined.

### W2 second-login and socket paths

- lib-forwarding's `openForwardedTunnel` is the wait (10 s, S158, "Max wait time exhausted": F-2104 BR-10, 7.E5).
- The tunnel step's two branches start the tunnel `ssh` in an `SSH Tunnel` terminal through S8, with prompts as above.
  The progress shows "(details) Setting up SSH tunnel" with the tooltip S132 (F-2308 6.2, F-2104 AC-7).
- The success line "Connected to SSH Host - Please do not close this terminal" (F-2308 BR-10) is printed by the tunnel
  `ssh`'s remote command. That needs a remote command on the host, which `-N` doesn't run. **Ruled:** the tunnel `ssh`
  runs `echo 'Connected to SSH Host - Please do not close this terminal'; exec sleep 2147483647` in place of `-N`
  (POSIX `sh`, the remote login shell), so the line is the host's own output, as the spec says. It's still bounded by
  the 10 s readiness wait. Checked against a real OpenSSH sshd (2026-10-12): the line arrives, the forward carries
  traffic, and it ends with the process.
- **The forward itself is checked, not the run** (themis's note; checked against a real sshd, 2026-10-12). With our
  port busy, the tunnel `ssh` exits 0, prints the success line, and only warns on stderr: `bind [127.0.0.1]:<port>:
  Address already in use`, `channel_setup_fwd_listener_tcpip: cannot listen to port: <port>`, `Could not request local
  forwarding.` (printed at every log level). And the readiness probe would then connect to **whoever holds the port**.
  So T7 fails the tunnel when the tunnel terminal shows `Could not request local forwarding.` or `cannot listen to
  port: <our port>` before the probe succeeds, and only then trusts the probe. The success line alone never means up.
- A tunnel login that is cancelled, fails, or exits through the user's own `ExitOnForwardFailure` fails the connect with F-2601's
  dialog after the bound, never a hang (F-2104 7.E7/7.E10, F-2308 7.E2/BR-11, R-79).
- W3 in these two paths: the user's forwarded ports open one `-L` each on the tunnel session. F-2104 Q4 and BR-11's
  socket-mode lab item stay open; until answered, W3 there reports a port it can't forward instead of guessing.

### V7 socket path

- The bootstrap passes `--socket-path` when socket mode is on. `StartedServer` gains `socketPath`, read from the
  server's ready line, which prints the path in place of the port (`Extension host agent listening on <path>`;
  `[oss]` `src/server-main.ts`); the start script's port reader becomes "a port or an absolute path".
- **One server per endpoint kind, each reused (ruled on #299, daedalus's option b).** The `[oss]` server listens on a
  path *or* on host/port, never both (one `listen` call). The reference's server proper serves both because a per-connect
  CLI layer sits in front of it (F-2410 BR-6, BR-9); we have no such layer. So the start records its endpoint kind
  beside the PID file, and a running server is reused only when its kind matches the connect's mode. A mismatch starts
  a server for the other kind and leaves the first running. That keeps F-2410 BR-7 (a mode switch takes effect on the
  next resolve **without killing the server**, so the other mode's open windows stay connected) and BR-6 (the server
  is shared and reused in both modes).
  - Rejected: (a) restarting on a mode change, which kills the other mode's windows against BR-7; and (c) never
    reusing in socket mode, a full server start per connect that F-2410 doesn't describe.
  - BR-5's "a new socket path per connect" is the reference's per-connect CLI socket, an artefact of the layer we don't
    have. What a user observes is held: a socket-mode connect uses a socket and opens no TCP listener (AC-9), and a
    port-mode record is discarded (BR-5's "no persisted connection data").
  - Cost: a host where the user switched modes runs two servers until one is killed, as BR-6 observes for the
    reference's leftover CLIs. "Kill VS Code Server on Host..." stops both kinds (F-2411).

## Rulings in this brief

1. **Host-key question in terminal mode: F-2305 BR-2's adaptation applies in both modes.** Asked on F-2305 (#38). The
   adaptation's reason (the surface shouldn't depend on the client's OpenSSH version) holds in terminal mode too, and
   AC-30 already gives the pick there for the classic wording. AC-31 and AC-38 (the 10.x wording left in the terminal)
   are marked pending the spec's answer.
2. **Passphrase in terminal mode: recognised from the terminal output (option a), keeping F-2307 AC-23.** Asked on
   F-2307 (#40). If the spec answers (b), the recognition is dropped and an askpass set up for it instead.
3. **An unanswered question after the handshake is bounded when nobody can reach it** (F-2308 7.E3, F-2305 BR-7;
   R-79). A recognised prompt shown as an input waits without limit (F-2306 BR-7). An unrecognised question in a
   hidden terminal is reachable only through "details" in a phase that carries the link (F-2308 6.1 step 4). In a
   phase without the link, or once the output has been silent for the connect timeout with a partial line
   pending, the attempt fails with F-2601 after the bound. The bound is R-79's family default, not a new number.
4. **The connect wait ends at the first output** in terminal mode (F-2105 BR-3), not at `authenticated`. The `-v`
   banner arriving first is what the spec observed (F-2308 5.0 step 4).
5. **A late trust answer** (after the attempt failed): nothing runs. The terminal isn't created after the attempt's
   end, and no stale input appears (F-2306 7.E7 says it should not; the reference's late install is a defect, not
   reproduced).
6. **The `ClearAllForwardings` pre-check** (F-2105 AC-29) applies to terminal mode's dynamic-forwarding path too,
   since it hangs the same way (the 2026-10-09 ruling said "shared connection on" only because terminal mode wasn't
   built).
7. **Stale citation:** contracts R1's "F-2308 Q3 and Q4" becomes "F-2308 7.E2, 7.E8, BR-6, BR-11" (the adaptations
   are now inline). Fixed in the same commit as this brief.

## Lab items left open (not blockers for the cards)

F-2308 Q1/Q2, F-2102 Q1 and F-2410 Q1/Q2 need Windows or macOS runs (D-60: provisional on Linux). F-2410 Q2 also
needs a decision; it's taken when the lab result is in.

## Cards, in order

| # | Card | Package | Depends on |
|---|---|---|---|
| T1 | S8 port, recording fake, adapter over `createTerminal`/`onDidWriteTerminalData`/`sendText`/`show`; trust outcomes | lib-ssh, remote-ssh | — |
| T2 | Prompt recognition over terminal output: splitter plus partial line, the terminal list, held output while an input is open, the R-79 bound for unreachable questions | lib-ssh | T1 |
| T3 | S2/S3: terminal invocation (`sh`, `-T`), the wait's first-output end, the tunnel invocation with its remote command (no `-N`), `ClearAllForwardings` on a forward-free install run only | lib-ssh | — |
| T4 | S10 over the terminal: `ShellRuns` with S8 as writer and reader, markers printed from two pieces, the test with echoed input | lib-ssh | T1 |
| T5 | R1's terminal branch replacing connect-15's interim: the mode decision, the install terminal, the wait, login through T2, the server steps through T4 | remote-ssh | T1–T4 |
| T6 | V7 socket path: `--socket-path`, the ready line's path, `StartedServer.socketPath`, the endpoint kind beside the PID file (reuse only on a match), Kill stops both kinds, the discarded port record | lib-server | — |
| T7 | W2's secondSsh and socket branches: the tunnel terminal, the success line, the 10 s wait, failures after the bound | lib-forwarding, remote-ssh | T1–T3, T6 |

T1, T3 and T6 can start at once. Closing #299 needs T5 and T7 merged and F-2104 6.2/6.8 and F-2410's resolver rows
passing in the SSH suite.
