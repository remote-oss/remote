# Task card ssh-31: one debug-line rule for the log and both copies, bounded while collecting (#417)

Why: #417. It gathers athena's two follow-ups from #416 (card ssh-30) and themis's two from #413 (card ssh-29).

1. **Two rules for one fact.** Three places decide which of ssh's stderr lines are noise:
   - the log (`logLinesOf` in `diagnostics/classify.ts`) drops `debug1:` lines except `Server host key`, and keeps
     `debug2:`/`debug3:`;
   - the process copy (#416's `isDebugLine`) drops `debug1:`, `debug2:` and `debug3:`, with or without `scp: `;
   - the copy terminal (#413) uses `logLinesOf`, so it keeps `scp: debug1:` lines.

   F-2109 BR-4 (`remote-oss/remote-ssh#27`) decides it: "Debug1 lines are dropped except the 'Server host key' line",
   and "the debug2/debug3 lines that `LogVerbose` forces reach the Remote - SSH log". The client runs with `-v`, so
   its own debug output is all `debug1`. `debug2:`/`debug3:` appear only when the user's `ssh_config` sets `LogVerbose`,
   and BR-4 keeps them. So the one rule is **debug1**: a line is a debug line when, after an optional `scp: `, it
   starts with `debug1:`. The log adds one exception, the server host key line.
2. **Bounded while collecting.** #416's `collectError` keeps every non-debug line and trims only when the text is
   read, so a long stderr grows without bound. It keeps at most a fixed number of lines as it goes.
3. **The copy terminal's cap counts debug lines.** It keeps the last 200 raw lines, then filters. A cause followed by
   250 debug lines falls out of the 200 before the filter runs: #402's defect, moved into the terminal. Filtering
   while collecting fixes it.
4. **Unpinned take-down.** No row checks that the copy terminal stops its wait and its reader when it settles.

Reviewing coder: `remote-coding-worker-1`.

**Starts after #416 (card ssh-30) is merged.**

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/diagnostics/classify.ts` | `isDebugLine` moves here; `logLinesOf` uses it (section 2.1) |
| `packages/lib-ssh/src/process/host-channel.ts` | `collectError` bounded while collecting; imports `isDebugLine` (section 2.2) |
| `packages/lib-ssh/src/terminal/terminal-copy.ts` | filters while collecting (section 2.3) |
| `packages/lib-ssh/src/index.ts` | `isDebugLine` exported from its new place |
| `packages/lib-ssh/test/unit/diagnostics-classify.test.ts`, `host-channel.test.ts`, `terminal-copy.test.ts` | rows (section 3) |

Nothing else.

## 2. Contract

### 2.1 `classify.ts`

```ts
/** Whether a line is a debug1 line of the client's `-v`, with or without the `scp: ` that scp puts before its ssh's lines. */
export function isDebugLine(line: string): boolean;
```

It is true when the line, after removing one leading `scp: `, starts with `debug1:` (`DEBUG1_PREFIX`).
`logLinesOf(lines)` becomes `lines.filter(line => !isDebugLine(line) || line.includes(SERVER_HOST_KEY_TEXT))`. That is
its current rule, plus the `scp: ` form.

### 2.2 `host-channel.ts`'s `collectError`

It keeps the non-empty, non-debug lines (`isDebugLine` from classify) in a list of at most `ERROR_LINES_KEPT` lines.
When the list would grow past it, the oldest line goes. `ERROR_LINES_KEPT = 50`, a named constant beside
`ERROR_TEXT_LIMIT`. Reading joins the kept lines with `\n` and keeps the last `ERROR_TEXT_LIMIT` (2000) characters, as
today.

### 2.3 `terminal-copy.ts`

The splitter keeps a line only when `!isDebugLine(line)` and it is non-empty, and the 200-line cap (`KEPT_LINES`) then
counts only those lines. The end's detail is the kept lines' last `TOLD_LINES` joined, with no `logLinesOf` call. The
host key line is not a cause, so dropping it there is right.

## 3. Test table

One assertion per `it`; the cite starts the name.

`diagnostics-classify.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| F-2109 BR-4 | `isDebugLine` of `debug1: a`, `scp: debug1: a`, `debug2: a`, `debug3: a`, `scp: dest open`, `Warning: y` (one `it` each) | true, true, false, false, false, false |
| F-2109 BR-4 | `logLinesOf(['scp: debug1: x', 'debug1: Server host key: k', 'debug2: y'])` | `['debug1: Server host key: k', 'debug2: y']` |
| F-2109 BR-4 | the existing `logLinesOf` rows | pass unchanged |

`host-channel.test.ts` (#416's rows for `isDebugLine` move to the classify file; its `debug2`/`debug3` rows now expect
false):

| Cite | stderr, then exit 1 | Expected detail |
|---|---|---|
| #417 (1) | 60 non-debug lines `e1` … `e60` | the text after `scp failed: ` is `e11` … `e60` joined by `\n` (50 kept) |
| #417 (1) | `scp: dest open "/x/f": No such file`, then 10 000 `debug1:` lines | `scp failed: scp: dest open "/x/f": No such file` |
| F-2109 BR-4 | `debug2: forced`, then `scp: failed to upload`, exit 1 | `scp failed: debug2: forced\nscp: failed to upload` (LogVerbose's lines stay, as in the log) |

`terminal-copy.test.ts`:

| Cite | Given | Expected |
|---|---|---|
| themis on #413 | `scp: dest open "/x/f": No such file\n`, then 250 `debug1: x\n` lines, then the terminal ends with code 1 | `copyFailed`, and the detail contains `scp: dest open "/x/f": No such file` |
| themis on #413 | the copy settles (code 0); then the scheduler advances past the connect wait and the reader's bound | the copy's outcome is still `copied`, and no timer fired (the wait and the reader were stopped) |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: one debug-line rule for the log and both copies, bounded while collecting (card ssh-31, #417)`.

## 6. Open rows

None. F-2109 BR-4 decides the rule.
