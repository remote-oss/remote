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
   - It covers shared mode (`SharedSessionChannel`) and terminal mode alike, because both are this channel.
   - The F-2704 startup output (connect-69) and the server's own output (connect-72) use the same `remoteLog`, when
     they come.
2. **`remoteLog(line)`** logs `[remote] <scrubbed line>` at `info`, unless the line is empty.
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
| `remote-log.test.ts` | `ADR-0010 rule 1: a remote line that looks like ours changes nothing` | a line `remote-oss-server-result-begin` emitted outside a run's block | logged; lib-server's result is what its own block says |
| `connect.test.ts` | `F-2003 BR-6 item 8: the steps and percents the notification shows are logged` | phase events `installing`, `serverDownloadPercent` 0, 50 and 100 | `Progress: installing`, then the three percent lines, in that order |

**Acceptance** (`tests/acceptance/windows`, `connectionLog()`): `F-2003 BR-6 item 8: a fresh install logs the remote
output and its progress`. Remove the server's install folder on the host first (`onHost('rm', '-rf', …)`), then connect
`harness` and check:
- `[remote] ` lines;
- a `Progress: installing` line, and the script's unpack progress among the `[remote]` lines;
- these come after `Resolving ssh-remote+harness` and before `Resolved ssh-remote+harness` (connect-65).

connect-65's AC-21 row guards these lines.

## 4. Gates and review

Run all gates and the VSCodium run. PR title `remote-ssh: the remote install and start output in the log, inert and
scrubbed (card connect-67, #846)`. Request athena only.
