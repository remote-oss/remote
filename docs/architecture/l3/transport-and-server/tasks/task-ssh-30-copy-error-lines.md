# Task card ssh-30: a failed copy keeps its error lines, not `-v`'s debug lines

Why: #402, themis's finding on #399 (card ssh-28 gave `scp` its `-v`). `SshHostChannel.collectError` keeps the **last
2000 characters** of the client's standard error for a failure's detail. With `-v`, a copy that fails after the
handshake writes about 5.5 KB to standard error. Its real error lines sit before the end, followed by `Transferred:`
and `Bytes per second:`, among 77 `debug1:` lines. So the detail of `copyFailed` becomes debug lines, and the cause is
lost. Checked on OpenSSH 10.2p1 (`scp -v … -- f localhost:/nonexistent/dir/f`, exit 1): 5530 bytes in all, 653 once the
debug lines go. The two lines that matter are
`scp: dest open "/nonexistent/dir/f": No such file or directory` and `scp: failed to upload file f to /nonexistent/dir/f`.
A connection failure is unaffected, since its message is the last line. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/process/host-channel.ts` | `collectError` keeps whole lines and drops the debug lines (section 2) |
| `packages/lib-ssh/test/unit/host-channel.test.ts` | the rows of section 3 |

Nothing else. The copy terminal (#392, card ssh-29) builds its detail from its own kept lines; hestia applies the
same rule there, under the same name (section 2), when she builds it.

## 2. Contract

A module-level function in `host-channel.ts`, exported so the copy terminal can share it:

```ts
/** Whether a line of the client's standard error is a debug line of `-v`, which a failure's detail leaves out. */
export function isDebugLine(line: string): boolean;
```

It is true when the line, after an optional leading `scp: `, starts with `debug1:`, `debug2:` or `debug3:`. So
`debug1: Reading configuration data /etc/ssh/ssh_config` and `scp: debug1: stat remote: No such file or directory`
are debug lines, and `scp: dest open "/x/f": No such file or directory` is not.

`collectError` keeps standard error as **lines**: a `LineSplitter` (as the channel already uses for output) over
`session.onError`. It keeps each line for which `isDebugLine` is false and which is not empty after trimming. The kept
lines are joined with `\n`, and the joined text keeps its last 2000 characters (`ERROR_TEXT_LIMIT`, unchanged).
`flush()` the splitter when the text is read, so a last line without a line end counts. The returned function keeps
its form: `''` when nothing is kept, otherwise `': ' + text`.

Export `isDebugLine` from `packages/lib-ssh/src/index.ts`.

## 3. Test table

One assertion per `it`; the cite starts the name. `copyBy` and `process.error(...)` are the file's existing fakes.

| Cite | stderr pieces, then exit | Expected `detail` |
|---|---|---|
| #402 | 70 lines `debug1: x…` (each 40 characters), then `scp: dest open "/x/f": No such file or directory\n`, then `Transferred: sent 1, received 2 bytes, in 0.1 seconds\n`, exit 1 | `scp failed: scp: dest open "/x/f": No such file or directory\nTransferred: sent 1, received 2 bytes, in 0.1 seconds` |
| #402 | `scp: debug1: stat remote: No such file or directory\nscp: failed to upload file f to /x/f\n`, exit 1 | `scp failed: scp: failed to upload file f to /x/f` |
| #402 | `scp: dest op` then `en "/x/f": No such file\n` in two pieces, exit 1 | `scp failed: scp: dest open "/x/f": No such file` |
| #402 | `scp: /remote: Permission denied` with no line end, exit 1 | `scp failed: scp: /remote: Permission denied` |
| #402 | only `debug1:` lines, exit 1 | `scp failed` |
| S10 | 3000 characters of non-debug lines, exit 1 | the detail's text after `scp failed: ` is the last 2000 characters of those lines joined by `\n` |
| #402 | `isDebugLine` of `debug1: a`, `debug3: a`, `scp: debug1: a`, `scp: dest open`, `Host key verification failed.` (one `it` each) | true, true, true, false, false |

The existing copy rows (`scp failed: scp: /remote: Permission denied`, status 255 → `channelClosed`) pass unchanged.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: a failed copy keeps its error lines, not -v's debug lines (card ssh-30, #402)`.

## 6. Open rows

None.
