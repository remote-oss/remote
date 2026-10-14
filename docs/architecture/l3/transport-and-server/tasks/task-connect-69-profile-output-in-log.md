# Task card connect-69: the login profile's printed output in the log, in local-server mode

Issue: #848. Not gating: no milestone, by athena's F-2003 scope ruling (register 2bb86d6). F-2704 5.0 step 3, 6.1, BR-5;
AC-18 (terminal mode keeps it out). Size: M. Builder: `task:claude`. **After** connect-61 (#834), which athena leaves
unchanged. This card reads the startup output file **before** the bootstrap removes its folder.

## 1. The changes

1. **The bootstrap** (`lib-ssh/src/connection-server/session-bootstrap.ts`, as connect-61 leaves it).
   - **The streams:** the login shell's startup standard output goes to the startup output file, as now. Its standard
     error now goes to a second file, `$LAYER1_DIR/err`, instead of `/dev/null`.
   - **The lines it prints:** after the environment is taken and before the folder is removed, it prints each line of
     each file as one line of its own, base64-encoded:
     - `LAYER1-OUT <base64>` for each standard output line, then `LAYER1-ERR <base64>` for each standard error line;
     - at most 1000 lines in all, then `LAYER1-OUTPUT-CUT <n>`.
   - **base64:** the text can then never contain a line of ours (ADR-0010 rule 1). If the host has no `base64`, it
     prints `LAYER1-OUTPUT-SKIPPED no-base64` instead.
   - **Arrival order between the two streams is lost.** Within each stream it's kept. That's recorded as a deviation
     from BR-5's "in arrival order", for athena.
2. **Shared mode** (lib-ssh, the helper's session reader).
   - The `LAYER1-OUT`, `LAYER1-ERR` and `LAYER1-OUTPUT-*` lines are taken out of the stream, decoded and sent to the
     lease that started the session, as `{type: 'profileOutput'; lines: {stream: 'out' | 'err'; text: string}[]}`.
   - Joiners get nothing.
3. **remote-ssh, shared mode only.** Through connect-67's `remoteLog` path, each line is logged as `> <text>` for
   `out` and `stderr> <text>` for `err`, scrubbed, before the `Host platform:` line.
4. **Terminal mode (AC-18).** The window doesn't log these lines at all: the terminal step drops the `LAYER1-*` output
   lines, so nothing of the profile reaches the log.

## 2. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| lib-ssh `session-bootstrap` real-shell row | `F-2704 BR-5: the profile's output is printed encoded` | a `.profile` printing `hello` and, on stderr, `oops` | `LAYER1-OUT aGVsbG8=` and `LAYER1-ERR b29wcw==`, before `LAYER1-READY` |
| same | `ADR-0010: a profile line that looks like ours stays data` | a `.profile` printing `LAYER1-READY` | the reader sees it only inside a `LAYER1-OUT` line |
| lib-ssh `handler.test.ts` | `F-2704 6.1: the starter gets the profile output` | those lines | one `profileOutput` event to the starter, none to a joiner |
| `connection-step.test.ts` | `F-2704 BR-5: the lines are logged with > and stderr>` | the event | `> hello`, `stderr> oops`, before `Host platform:` |
| `terminal-connection-step.test.ts` | `F-2704 AC-18: terminal mode keeps it out` | the same lines in terminal mode | no `> ` line logged |

**Acceptance:** a host account whose `.profile` prints one line. In local-server mode, the log has `> <line>`. In
terminal mode, it doesn't.

## 3. Gates and review

Run all gates, shellcheck and the VSCodium run. PR title `lib-ssh, remote-ssh: the login profile's output in the log in
local-server mode (card connect-69, #848)`. Request athena only.
