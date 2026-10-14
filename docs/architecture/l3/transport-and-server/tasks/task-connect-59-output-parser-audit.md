# Task card connect-59: the ADR-0010 audit, every parser of remote or program output and its noisy-neighbour row

Issue: #832. Release 0.2, **gating** for the remote-ssh side (lib-ssh, lib-server, lib-host, remote-ssh). The
containers rows go into their own cards' builds and gate Containers release 1 (§4). ADR-0010 (main c271452) is
binding. Size: M. Builder: `task:claude`.

## 1. Why

A user's startup files (`.bashrc`, `.bash_profile`, `.profile`, fish and zsh config, `/etc/motd`, `/etc/profile.d/*`,
`~/.ssh/rc`, a PAM session module) can print anything, on either stream, around what we run. ADR-0010 requires:
- rule 1: remote text is read only through our whole-line markers;
- rule 2: a program's text is read only in its documented, anchored form, from a stream nothing else writes into. ssh's
  diagnostics count only before the session starts;
- rule 3: prefer an exit status;
- rule 4: don't assume what wasn't read.

This card lists every parser with its rule, the finding, and the noisy-neighbour row ADR-0010's Consequences require.
It writes the rows for the parsers that conform. The parsers that don't are defects with cards of their own (§3); this
card names them so the list is whole.

## 2. The parsers

The audit was done on main ae5c024b. "Measured" means run with a hostile startup file, either in an `alpine:3.22`
container or in unit form, on 2026-10-14.

| # | Parser | File | ADR-0010 rule | Finding | Class |
|---|---|---|---|---|---|
| P1 | result block `parseResult` | `lib-server/src/scripts/result-block.ts:117` | 1 | Whole-line `remote-oss-server-result-begin`/`-end`, after one trailing `\r` is removed. Values are taken only inside a complete block, the last complete one wins, and a block without `status=` or its end marker is `noResultBlock`. Values pass through `fact`, which turns `\n\r` into spaces. It's read only from a run's own output (P8) | conforms; row |
| P2 | progress lines `parseProgressLine` | `lib-server/src/scripts/progress-line.ts:38` | 1 | A whole line of `remote-oss-server-progress <step> <percent>`, with exact field checks | conforms; row |
| P3 | bootstrap events `bootstrapEventOf` | `lib-ssh/src/connection-server/session-bootstrap.ts:111` | 1 | Anchored `^LAYER1-(READY\|TIMEOUT n\|EXITED n)\r?$`. ADR-0010 lets the `LAYER1-*` family conform as it is. In shared mode, a fake `LAYER1-EXITED` before READY only sets `early` (handler.ts:283), and READY still follows. In terminal mode (`terminal-runs.ts:53`) the first event decides | conforms; row, and see open row 1 |
| P4 | the bootstrap's environment read: `grep '^LAYER1-START$'`, then `eval` of everything after the first match | `session-bootstrap.ts:44-45` | 1, "a file only it writes" | **Breaks rule 1.** The login shell's startup output and `export -p` share `$LAYER1_DIR/out`. If a startup file prints `LAYER1-START`, its own later output is `eval`'d. Measured: a `.profile` with `echo LAYER1-START; echo "exit 3"` ends the session with status 3, and `echo LAYER1-START; echo "ERROR: Your fridge…"` gives `eval: ERROR:: not found` | **defect: connect-61 (#834)** |
| P5 | the stderr classifier `classify` (S5) | `lib-ssh/src/diagnostics/classify.ts:58`, `rules.ts:43-69` | 2 | **Breaks rule 2 twice.** (a) It matches by substring (`line.includes(text)`) anywhere in a line. (b) Its window is too wide. Shared mode collects `errorLines` until `LAYER1-READY` (`handler.ts:302`), which includes everything after `Authenticated to`: `~/.ssh/rc` and a PAM module's stderr. Terminal mode pushes every terminal line into `lines` and classifies them at the terminal's end (`terminal-connection-step.ts:246`, `:271`). Measured in unit form: after `Authenticated to …`, `curl: (28) Connection timed out after 5001 milliseconds` classifies as `timeout` S137, `…: Permission denied (fridge)` as `authentication`, and `backup.sh: Could not resolve hostname nas` as `unreachable` S032. Without them the result is `unknown` | **defect: connect-60 (#833)** |
| P6 | the prompt classifier (S6) | `lib-ssh/src/prompts/classify.ts:38-127` | 2 | Reads only the PromptReader's window, which stops at `Authenticated to` in terminal mode (`terminal-connection-step.ts:178`). In shared mode, ssh itself calls our askpass with its prompt. Anchored where it decides a flow (the host-key question and fingerprint lines). `includes('Password:')` only picks masked input for a question already being asked | conforms; row |
| P7 | the setup report `setupMarkerOf` and the PromptReader | `lib-ssh/src/diagnostics/setup-report.ts:19`, `terminal/prompt-reader.ts:135` | 2 | The handshake is a whole line, and `Authenticated to ` is ssh's own prefix. Both are read only before the session starts. connect-55 (#814, in review) adds the prefix `debug1: mux_client_request_session: master session id: ` | conforms; row |
| P8 | `ShellRuns.hear`, a run's start and end | `lib-ssh/src/connection-server/shell-runs.ts:99-125` | 1 | The markers carry a per-run random nonce (`newNonce`), so startup text can't contain them. The end marker is found mid-line on purpose, to keep a script's unterminated last words. Terminal mode runs ssh with `-T` (`invocation.ts:108`), so the remote `sh` reads a pipe and prints no prompt. The local terminal's echo of our input is written as we send it, before any remote output, so it falls before the start marker. Lines outside the active run are dropped | conforms; row (§3 explains why it isn't a defect) |
| P9 | the server's ready port `ready_port` and the start failures | `lib-server/src/scripts/bootstrap.ts:507-515`, `:522` | 2, "as narrowly as the form allows" | The stream qualifies (the server's own log, redirected by our non-login script). But `sed 's/.*Extension host agent listening on \([^ ]*\).*/'` is unanchored, `grep -q 'Could not find free port in range'` and the CVE line are substrings, and `no:[0-9]*` accepts `5abc` | **defect: connect-63 (#836)** |
| P10 | the CLI's port line | `lib-server/src/scripts/posix-script.ts:57-60` | 2 | `sed -n 's/^Listening on 127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p'` on the CLI's own log: anchored and whole-line | conforms; row |
| P11 | the agent-link listing and read-back | `remote-ssh/src/pipeline/forwarding-step.ts:63-77`, `:153-170` | 1 | Only the run's own output (P8), from our own `printf` and `readlink` | conforms; row |
| P12 | X11, `DISPLAY` | `remote-ssh/src/environment/display.ts:30-48` | 4 | The session's `DISPLAY`, read from a `fact` line, is passed through unchanged with no `XAUTHORITY`. The log says only "DISPLAY is …". Nothing concludes X11 works. With a `~/.ssh/rc`, the cookie is that script's job (sshd(8), SSHRC) | conforms; row |
| P13 | containers exec channel failures | containers-02, #808 (in review) | 2, 3 | contracts §1 as amended (#808): only the Docker client's line prefixes, with no substring of script output. iris has dropped the `is not running` match | row as an **amendment to #808** (§4) |
| P14 | the dev container CLI's lines | containers-04 (#763, not built) | 2 | The JSON result line and `--log-format json` events (ADR-0009). The card already parses non-JSON stderr as plain log lines only | row as an **amendment to containers-04** (§4) |
| P15 | C2's pre-flight classifier | `remote-containers/src/engine/check-outcome.ts` (containers-03, #842) | 2, 3 | The spawn error, the timer, the exit status and the JSON `Server.ApiVersion` conform. `/permission denied/i` and `/not ?found/i` over the whole stderr don't: measured on Docker 29.9, a `WARNING:` line, a daemon reply and an ssh host's stderr change the dialog | row and fix in **containers-10** (#862) (§4) |

## 3. The noisy-neighbour rows (this card, for the conforming parsers)

Each row runs the **real** parser. The noise is ADR-0010's set:
- **N1:** `ERROR: Your fridge is not running`, on its own line;
- **N2:** a line holding our marker text as a substring, for example `see remote-oss-server-result-begin for details`;
- **N3:** a fake `status=Ok` or `fact host.arch x64` line outside the block;
- **N4:** a program message mid-line, for example `motd: Permission denied (publickey) is a test`;
- **N5:** the same lines ending in `\r`.

Put the noise before, between and after the parser's own lines. The expected result is the same as without the noise.
Name every row `ADR-0010: <parser>: noise around and inside its stream changes nothing`.

| Row | File | Given | Expected |
|---|---|---|---|
| P1 | `lib-server/test/unit/result-block.test.ts` | a good block, with N1–N5 before and after it; a second, incomplete block opened after the good one | the good block's values. N3 outside the block adds no fact |
| P1 real shell | `lib-server/test/unit/bootstrap-script.test.ts` (`fakeHost` style) | the probe body with a login shell whose startup prints N1–N5 on stdout and stderr | the same `ProbedHost` as without them |
| P2 | `lib-server/test/unit/progress-line.test.ts` | N1–N5, and `remote-oss-server-progress unpack 50 extra` and ` remote-oss-server-progress unpack 50` | only the real progress lines are read |
| P3 | `lib-ssh/test/unit/session-bootstrap.test.ts` | `bootstrapEventOf` over N1–N5, `xLAYER1-READY`, `LAYER1-READY now` | none is an event; `LAYER1-READY\r` is |
| P6 | `lib-ssh/test/unit/prompts-classify.test.ts` | a host-key question window with N1 and N4 lines inside it | the same question and fingerprint |
| P7 | `lib-ssh/test/unit/setup-report.test.ts` | N1–N5, `banner: Authenticated to x using "y"`, `  debug1: SSH2_MSG_NEWKEYS received` | none is a marker |
| P7 terminal | `remote-ssh/test/unit/terminal-connection-step.test.ts` | lines after `Authenticated to` that say `Password:` and `Are you sure you want to continue connecting (yes/no)?` | no question is shown (the reader has stopped) |
| P8 | `lib-ssh/test/unit/shell-runs.test.ts` | between runs and before the start, N1–N5 and lines holding another nonce's `:start` and `:end 0` | the active run's lines are exactly its own; the status is its own |
| P10 | `lib-server` real shell | a CLI log holding `xListening on 127.0.0.1:1` and `Listening on 127.0.0.1:2 extra` before the real line | the real port |
| P11 | `remote-ssh/test/unit/forwarding-step.test.ts` | the channel's run output for the listing, with a line `see /tmp/vscode-ssh-auth-sock-1 elsewhere` | only lines that start with the prefix are taken |
| P12 | `remote-ssh/test/unit/display.test.ts` | a session `DISPLAY` of `localhost:10.0` | the plan passes it unchanged, sets no `XAUTHORITY`, and the log line claims nothing beyond the value |

**Acceptance row** (`tests/acceptance/server/login-shells.test.ts`, the real host): give the `harness` account a
`.profile` that prints N1–N5 on both streams, and a `~/.ssh/rc` that prints N1 to stderr. Then:
- the probe, install and start rows on that host give the same results as without them;
- a forced failure (a server download refused) shows the same failure kind as without them.

Restore the files in `after`.

## 4. Amendments to containers cards (for daedalus to apply)

- **containers-02 (#808, in review):** a row in its exec failures test. A script whose output contains
  `Error response from daemon: No such container` mid-line, and `is not running` on its own line, still ends with
  its own status and isn't `channelClosed`.
- **containers-04 (#763):** a parser row. Non-JSON stderr lines that look like a result
  (`{"outcome":"success"}` with a prefix, N1–N5) aren't read as the result or as events.
- **containers-10 (#862), the follow-up to containers-03 (#842):** C2's stderr classifier. It skips `WARNING:`
  lines, decides `engineError` on the Docker CLI's transport and daemon prefixes, and only then applies F-0201
  BR-3. Its rows R5 and R8–R12 are the noisy-neighbour rows.

## 5. Gates and review

Run all gates, with the changed test files only. The product changes are in connect-60, connect-61 and connect-63.
Use the PR title `tests: ADR-0010 noisy-neighbour rows for every conforming parser (card connect-59, #832)`. Request
athena only.

## 6. Open rows (stop and report on #832)

1. **P3, terminal mode:** the first bootstrap event decides. A startup file that prints the exact line
   `LAYER1-EXITED 1` before the real `LAYER1-READY` fails a terminal-mode connect. ADR-0010 lets the family conform, so
   this card doesn't change it. If the builder measures that a realistic startup prints such a line, report it.
2. A noisy-neighbour row here fails on main. That's a new defect. Report it with the row, and don't fix it in this
   card.
