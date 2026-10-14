# Task card connect-72: the server's own output in the log, and the server at trace

Issue: #851. Not gating: no milestone, by athena's F-2003 scope ruling (register 2bb86d6). F-2003 BR-6 item 13, BR-9
point 5, and AC-12's server half. Size: M. Builder: `task:claude`. **After** connect-67 (#846), whose `remoteLog` path
it uses.

## 1. The changes

1. **The server at trace (BR-9 point 5).** When `remote.SSH.logLevel` is `trace` and this connect **starts** the server
   (not a reuse), the start body passes `--log trace` among the server's options.
   - `lib-server`: `StartParameters.logLevel: 'trace' | undefined`, and `bootstrap.ts`'s `startOptions` adds
     `'--log', 'trace'` when it's set.
   - `remote-ssh` sets it from the level read at the start.
   - A reused server keeps its level.
2. **Item 13, the server's own output.** After the resolve returns `Connected`, the connect reads the server's log
   file once over the held channel, and gives each line to connect-67's `remoteLog` with the prefix `[server]` in place
   of `[remote]`. The file is the `fact server.log` path the start reported.
   - **The read:** `tail -n 2000 <file>` (BusyBox and coreutils both have it).
   - **Its lines are inert and scrubbed,** as connect-67's are.
   - **There's no continuous tail,** so no process per window stays running on the host.
   - **A reuse** reads the same file, which shows the running server's recent lines.

## 2. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| lib-server `bootstrap-script.test.ts` | `F-2003 BR-9 point 5: a trace start passes --log trace` | `logLevel: 'trace'`, then undefined | the `set --` line holds `--log trace`, then not |
| `connect.test.ts` | `F-2003 BR-6 item 13: the server's log follows the resolve` | a start reporting `server.log /h/x.log`, a channel whose run of `tail` gives two lines | after the resolved line, `[server] <line>` twice, scrubbed |
| `connect.test.ts` | `F-2003 BR-9 point 5: a reuse doesn't change the level` | a reuse at trace | no `--log` in any start |

**Acceptance:** `F-2003 AC-12: at trace, a fresh server's log has trace entries`. At `trace`, a fresh connect (install
folder removed first). Then:
- `connectionLog()` has `[server] ` lines;
- the host's server log file has trace-level lines. Measure the server's trace marker in the pinned build, and
  assert on it;
- the same connect at `debug` writes fewer lines than at `trace`.

## 3. Gates and review

Run all gates and the VSCodium run. PR title `lib-server, remote-ssh: the server's own output in the log, and the
server at trace (card connect-72, #851)`. Request athena only.
