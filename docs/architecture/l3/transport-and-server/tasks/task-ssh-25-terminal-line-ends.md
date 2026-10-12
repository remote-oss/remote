# Task card ssh-25: the login terminal's line ends are normalised

Why: themis's finding on #352/#353, ruled by athena (#299, brief 5926db6). A pty's output post-processing (ONLCR)
turns `\n` into `\r\n`, so `ssh`'s own `\r\n` lines arrive as `\r\r\n` (measured: `printf 'x\r\n'` on a pty gives
`x\r\r\n`). `LineSplitter` strips one trailing `\r`, so every line keeps a stray `\r` and every exact line match fails:
the tunnel gate's success and failure lines (#353), the handshake marker (#352: it strips one `\r` itself), and the
prompt reader's lookbacks. The gate never settles although the right lines are on screen. **Ruled:** the terminal
layer normalises line ends; `LineSplitter`, which the pipe paths share and which never see `\r\r\n`, is unchanged.
Reviewing coder: `remote-coding-worker-1`.

**Merges before #352 and #353**, which then need no change.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/terminal/terminal-stream.ts` | the line ends of `write`'s text, and the release at `end` (section 2) |
| `packages/lib-ssh/test/unit/terminal-stream.test.ts` | rows (section 3); create it if the file doesn't exist yet |

Nothing else. The editor adapter and `RecordingTerminals` both go through `TerminalStream`, so both get it.

## 2. Contract

After `PlainTextFilter`, `TerminalStream` normalises the text before delivering it:
- every run of one or more `\r` followed by `\n` becomes `\n` (`/\r+\n/g`);
- a lone `\r` (one not followed by `\n`) stays: progress output redraws a line with it;
- a run of `\r` at the **end** of a piece is held and joined to the next piece, which decides it (a `\n` next makes
  it a line end; anything else keeps it);
- at `end(...)`, a held run is delivered as it is **first**: it reaches the output listeners and counts for
  `hadOutput`, and only then is the end built and told. So nothing is lost (`a\r` at the end gives `a`, then `\r`), and
  a terminal whose only output was a held `\r` ends with `hadOutput: true`.

The existing rules hold: nothing is delivered after the end; a piece whose text is empty after the filter and the
normaliser is not delivered and doesn't set `hadOutput` (a piece that is only a held `\r` delivers nothing yet).

## 3. Test table

One assertion per `it`; the cite starts the name. Each row writes the pieces with `write` and records the output
listener's calls; "end" calls `end(0, 'process')`.

| Cite | Pieces | Expected output |
|---|---|---|
| #299 (themis) | `'a\r\r\n'` | `['a\n']` |
| #299 | `'a\r\n'` | `['a\n']` |
| #299 | `'a\rb'` | `['a\rb']` (a lone `\r` stays) |
| #299 | `'a\r'`, then `'\nb'` | `['a', '\nb']` |
| #299 | `'a\r\r'`, then `'\nb'` | `['a', '\nb']` |
| #299 | `'x\r'`, then `'y'` | `['x', '\ry']` (the held `\r` was a lone one) |
| #299 | `'a\r'`, then end | `['a', '\r']`, and the end listener heard the end after it |
| #299 | `'\r'` alone, then end | the output is `['\r']` (released at the end), and the end reports `hadOutput: true` |
| #299 | `'\r'` alone, then `'\n'`, then end | `['\n']`, and the end reports `hadOutput: true` |
| #299 | `'\r'` alone, with no end yet | no output yet (the run is held) |
| #299 | `'\x1b[0mok\r\r\n'` (an escape and a pty line end) | `['ok\n']` |
| #353 | the lines of a busy-port tunnel as a pty delivers them, each ending `\r\r\n` (`bind [127.0.0.1]:18111: Address already in use`, `channel_setup_fwd_listener_tcpip: cannot listen to port: 18111`, `Could not request local forwarding.`, the success line), the output joined and passed through a `LineSplitter` | the four lines exactly as written, with no `\r` (so #353's `===` comparisons and #352's handshake match) |

The rows were checked on a prototype of the normaliser (2026-10-12); fed the last row's output, the tunnel gate's line
rules (#353) settle `forwardFailed` on the `cannot listen` line. That gate row itself stays #353's, since this card
merges first.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: the login terminal's line ends are normalised (card ssh-25)`.

## 6. Open rows

None. Ruled by athena (#299, brief 5926db6).
