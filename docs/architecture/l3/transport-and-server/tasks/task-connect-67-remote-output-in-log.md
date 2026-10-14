# Task card connect-67: the remote install and start output in the log, inert and scrubbed

Issue: #846. Release 0.2, **gating** (athena's F-2003 scope ruling, register 2bb86d6). F-2003 (`remote-oss/remote-ssh#13`)
BR-6 item 8 and BR-14, under ADR-0010 rule 1 ("logged and otherwise ignored"). Size: M. Builder: `task:claude`. The
server's own output after the resolve (item 13) is connect-72 (#851), which isn't gating.

## 1. The gap

The install and start scripts' output reaches lib-server through the channel's `runScript` `onLine`. lib-server reads
only its result block and its progress lines from it (ADR-0010 rule 1), and **nothing reaches the log**. metis's run 1
on #13 notes the missing remote lines and the missing download and unpack progress.

## 2. The changes

1. **One path for remote text to the log** (athena's "build once"). The `HostChannel` that `connect-ports.ts`'s
   `channelFor` returns is wrapped by a decorator, `loggedChannel(channel, remoteLog)`
   (`remote-ssh/src/pipeline/remote-log.ts`, new). `runScript`'s `onLine` gives each line first to
   `remoteLog(line)`, then to the caller's `onLine`, unchanged. The other methods pass through.
   - It covers shared mode (`SharedSessionChannel`) and terminal mode alike, because both are this channel:
     `wiring.ts`'s `channelOf` is the `channelFor` of both the shared step (`openConnectionStep`) and the terminal step
     (`openTerminalConnectionStep`), and both call `ports.channelFor`, which is `connect-ports.ts:311`. The decorator
     wraps the channel there, once, so terminal mode needs no second place (F-2003 6.7 point 1, BR-16).
   - The F-2704 startup output (connect-69) and the server's own output (connect-72) use the same `remoteLog`, when
     they come.
2. **`remoteLog(line)`** logs `[remote] <scrubbed line>` at `info`, unless the line is empty.
   - **The result block isn't logged line by line** (athena on #853, 1d7619a): `loggedChannel` stops logging at a
     whole line `remote-oss-server-result-begin` (the begin line itself isn't logged) and resumes after the whole
     line `remote-oss-server-result-end`, or when the run ends if no end line comes. So no `fact` line reaches the
     log: the block holds host facts such as `host.display` and `host.sshAuthSock`, which are environment values of
     the remote (BR-14).
   - **The result as one summary line:** after a run whose block lib-server parsed, `connect` logs one `info` line
     from the parsed `ResultBlock`, never from the raw lines:
     `Server result: <status>, port <port>, os <os>, architecture <arch>, download <ms> ms, install <ms> ms`.
     Each part appears only when the block has it. No other fact is logged.
   - **Inert:** no code reads what `remoteLog` logs. lib-server's own parse (the result block and the progress lines)
     is unchanged, and is still the only reader.
   - **Scrubbed (BR-14):**
     - the connection token is replaced by `masked` (`log-content.ts`);
     - every value of an environment variable the channel run was given (`ScriptRequest.environment`) that is 8
       characters or longer is replaced by `${NAME}`;
     - our scripts print no environment listing.
3. **Progress at the notification's steps** (athena: "logged at the same steps and percents the notification
   shows"). Each phase event `connect()` sends the notification (`connect.ts`'s `PhaseEvent`, through `onPhase`) is
   also logged as one line at `info`, in the same order:
   - `Progress: <kind>` for the step events (`downloading`, `downloadingLocally`, `copyingWithScp`, `installing`,
     `settingUpTunnel` and the others);
   - `Downloading VS Code Server: <n>%` for each `serverDownloadPercent`.

   There's no other percent line. The unpack progress the scripts print reaches the log as their own `[remote]` lines
   (step 2).

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `remote-log.test.ts` | `F-2003 BR-6 item 8: every line of a run is logged as remote output, then handed on unchanged` | a fake channel whose `runScript` emits `a`, `remote-oss-server-progress unpack 40`, `` | the log has `[remote] a` and `[remote] remote-oss-server-progress unpack 40`, and no line for the empty one; the caller's `onLine` received all three, unchanged |
| `remote-log.test.ts` | `F-2003 BR-14: the token and the run's environment values are scrubbed` | a line holding the token, and a line holding the value of `SECRET_ONE=abcdefgh12` from the request's environment | the token masked; `${SECRET_ONE}` in place of the value; a 7-character value left as it is |
| `remote-log.test.ts` | `ADR-0010 rule 1: a remote line that looks like ours changes nothing` | a startup file's line `remote-oss-server-result-begin` before the run's own block | lib-server's result is what its own block says; the log only hides lines (from that begin to the next end), and never gains a fact line |
| `remote-log.test.ts` | `F-2003 BR-14: the result block's facts never reach the log` | a run emitting `a`, the block (`remote-oss-server-result-begin`, `fact host.display :10`, `fact host.sshAuthSock /tmp/ssh-x/agent.1`, `status=Ok`, `remote-oss-server-result-end`), then `b` | the log has `[remote] a` and `[remote] b` only; no line contains `:10`, `/tmp/ssh-x/agent.1`, `fact` or the markers |
| `connect.test.ts` | `F-2003 BR-6 item 8: the result is logged as one summary line from the parsed block` | a start whose parsed `ResultBlock` has status `Ok`, port 41234, os `linux`, architecture `x64`, download 1200 ms, install 800 ms | exactly one `Server result: Ok, port 41234, os linux, architecture x64, download 1200 ms, install 800 ms` line |
| `connect.test.ts` | `F-2003 BR-6 item 8: the steps and percents the notification shows are logged` | phase events `installing`, `serverDownloadPercent` 0, 50 and 100 | `Progress: installing`, then the three percent lines, in that order |

**AC-29 (F-2003 6.7, BR-16, republished on #13):** in terminal mode, a fresh connect's install and start output is
in the channel as server output, as in shared mode. That half of AC-29 is **gating** with this card (item 8, athena's
2bb86d6). AC-29's settings-listing half is connect-71's, which waits. AC-29 stays `todo` until both halves have rows.

| File | Name | Given | Expected |
|---|---|---|---|
| `connect-ports.test.ts` (or the file holding `channelFor`'s rows) | `F-2003 BR-16, AC-29: the terminal mode's channel is the logged channel too` | `channelFor` built for a terminal-mode connect (the terminal step's session), with a fake runner whose script emits `a` | the log has `[remote] a`, exactly as for a shared-mode connect |

**Acceptance** (`tests/acceptance/windows`, `connectionLog()`): `F-2003 BR-6 item 8: a fresh install logs the remote
output and its progress`. Remove the server's install folder on the host first (`onHost('rm', '-rf', …)`), then connect
`harness` and check:
- `[remote] ` lines;
- a `Progress: installing` line, and the script's unpack progress among the `[remote]` lines;
- these come after `Resolving ssh-remote+harness` and before `Resolved ssh-remote+harness` (connect-65).

connect-65's AC-21 row guards these lines.

**The same row in terminal mode** (`F-2003 BR-16, AC-29: a fresh terminal-mode install logs the remote output`): with
`remote.SSH.useLocalServer` false (the agent's `updateSetting`), and `remote.SSH.remotePlatform` `{harness: 'linux'}`,
remove the server folder, connect `harness`, and check the same `[remote]` and progress lines. Also check that no
line names a local connection server (the 6.7 point 2 half, which connect-68's terminal row asserts too).

## 4. Gates and review

Run all gates and the VSCodium run. PR title `remote-ssh: the remote install and start output in the log, inert and
scrubbed (card connect-67, #846)`. Request athena only.
