# Task connect-12: three follow-ups of the SSH diagnostics (O1, O3, O5 of card connect-04)

Base: main **after PR #265 (card connect-04) has merged**; if `packages/remote-ssh/src/diagnostics/hint-store.ts` or
`log-content.ts` is absent, stop and report. Ruled by the architect on #265 (2026-10-12, athena; card connect-04's
header, 96a70ca): the card author's proposals for O1, O3 and O5 of connect-04 §6 are adopted here. O2 belongs to the
card that reads the persisted store; O4 is met. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/diagnostics/hint-store.ts` | `addHint` (O1) |
| `packages/remote-ssh/src/diagnostics/log-content.ts` | the prompt type and its lines (O3); the split of multi-line entries (O5) |
| `packages/remote-ssh/test/unit/hint-store.test.ts` | rows added |
| `packages/remote-ssh/test/unit/log-content.test.ts` | rows added; existing rows unchanged |

Nothing else may change: no new export, no `package.json`, no `coverage.json`, no string table.

## 2. Contract

Signatures stay as connect-04 §2 defines them, with one field made optional:

```ts
// in ResolveRecord
prompts: Array<{text: string; answer?: string}>;   // no `answer` field: the prompt was cancelled
```

- **O1, `addHint`.** When the store holds a record whose `started` equals the new record's `started`, the new record
  takes that record's place (same position, no other record moves or drops). Otherwise as today: append, then keep the
  last two. The argument and the record are not changed; a new store is returned.
- **O3, prompts.** Per prompt, in order: `Prompt: {text}` (the token masked, as today), then `Answer: ***` when the
  prompt has an `answer` field (the empty string included), or `Answer: (none)` when it has none. The answer itself is
  never written.
- **O5, multi-line entries.** Each entry of `sshLines`, `remoteOutput` and `serverOutput` is split on `\r\n`, `\n` and
  `\r` (in that order of matching, so `\r\n` is one break). Each part becomes its own line with the entry's prefix
  (`[ssh] `, `[remote] `, `[server] `) and the token masked. An empty part (two breaks in a row, or a break at the
  end) is dropped; an entry that is only breaks gives no line. For `sshLines` at level `debug`, the split comes first
  and `logLinesOf` from `lib-ssh` filters the parts, so a `debug1` part inside a multi-line entry is dropped like any
  other `debug1` line. At level `trace` all parts are kept.
- **One-line texts (amended 2026-10-12, athena's optional point, F-2003 BR-4).** In the `failure` text and in each
  summary issue's `message`, every line break (`\r\n`, `\n`, `\r`) becomes one space, after the token is masked, so
  the entry stays one line with one time and prefix. Breaks are not collapsed: two breaks give two spaces. No other
  line of the log changes: settings and prompts are written as today.

## 3. Test table

Base record: connect-04's R0 with the named fields overridden. One assertion per `it`; the Cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| F-2605.BR-10 (O1) | store `[A(started t1), B(t2)]`, `addHint` of B2 with `started` t2 | `records` is `[A, B2]` |
| F-2605.BR-10 (O1) | store `[A(t1), B(t2)]`, `addHint` of A2 with `started` t1 | `records` is `[A2, B]` |
| F-2605.BR-10 (O1) | store `[A(t1)]`, `addHint` of A2 with `started` t1 | `records` is `[A2]` |
| F-2605.BR-10 (O1) | a frozen store `[A(t1), B(t2)]`, `addHint` of B2 (t2) | a new store; the argument still holds `[A, B]` |
| F-2003.BR-6 item 7 (O3) | `prompts [{text 'Password: '}]` (no `answer`) | `Prompt: Password: ` then `Answer: (none)` |
| F-2003.BR-6 item 7 (O3) | `prompts [{text 'a: ', answer 'x'}, {text 'b: '}]` | `Prompt: a: `, `Answer: ***`, `Prompt: b: `, `Answer: (none)` |
| F-2003.BR-6 item 7 (O3) | `prompts [{text 'Password: ', answer ''}]` | `Prompt: Password: ` then `Answer: ***` (unchanged) |
| F-2003.BR-4 (O5) | `remoteOutput ['one\ntwo']` | `[remote] one`, `[remote] two` |
| F-2003.BR-4 (O5) | `serverOutput ['a\r\nb\rc']` | `[server] a`, `[server] b`, `[server] c` |
| F-2003.BR-4 (O5) | `remoteOutput ['x\n\ny\n']` | `[remote] x`, `[remote] y` (empty parts dropped) |
| F-2003.BR-4 (O5) | `remoteOutput ['\n']` | no `[remote]` line |
| F-2003.BR-4 (O5) | `remoteOutput ['token ab12-cd34\nagain ab12-cd34']`, token `ab12-cd34` | `[remote] token aa11-aa11`, `[remote] again aa11-aa11` |
| F-2003.BR-4 (O5) | level `debug`, `sshLines ['real error\ndebug1: noise']` | `[ssh] real error` only |
| F-2003.BR-4 (O5) | level `trace`, `sshLines ['real error\ndebug1: noise']` | `[ssh] real error`, `[ssh] debug1: noise` |
| F-2003.BR-4 | `failure 'first\nsecond\r\nthird\rfourth'` | `Resolution failed: first second third fourth` |
| F-2003.BR-4 | `failure 'a\n\nb'` | `Resolution failed: a  b` (two spaces) |
| F-2003.BR-4 | `failure 'x ab12-cd34\ny'`, token `ab12-cd34` | `Resolution failed: x aa11-aa11 y` |
| F-2003.BR-4 | summary `{kind 'issues', issues [{status 'E', message 'a\rb'}]}` | `[E]: a b` |

## 4. Rule for the worker

As card log-01. Tests first; fix only what fails; every existing row of connect-04 still passes unchanged. Coverage of
both files 100 % lines, branches and functions (remote-ssh's ratchet). Comments only where the guide requires them;
names of four characters or more; no duplicated code: one splitting function serves the three lists.

## 5. Gates and review

PR title `remote-ssh: diagnostics follow-ups O1, O3, O5 (card connect-12)`; answers R1–R6.

## 6. Open rows

None. If a row of section 3 cannot pass with the contract of section 2, stop and report the row and the output.
