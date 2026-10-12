# Task card ssh-33: the copy terminal keeps exactly the lines it tells

Why: #440, #434 item 2, ruled by athena. The copy terminal (`packages/lib-ssh/src/terminal/terminal-copy.ts`) keeps the
last 200 non-debug lines (`KEPT_LINES`) and tells only the last 20 of them (`TOLD_LINES`). Nothing reads the other
180, so the 200 can't be seen from outside, and no row can pin it. The copier keeps exactly the lines it tells: one
constant, 20. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/terminal/terminal-copy.ts` | one constant, section 2 |
| `packages/lib-ssh/test/unit/terminal-copy.test.ts` | the rows of section 3; two existing rows renamed and changed (section 3) |

Nothing else.

## 2. Contract

- Remove `KEPT_LINES`. Keep `TOLD_LINES = 20`, with the comment `/** How many of the last non-debug lines a failure's
  detail tells. */` in place of the old two-line one.
- In the splitter's callback, `if (lines.length > TOLD_LINES) { lines.shift(); }`.
- At the end, `const told = lines.join('\n');` (the `slice(-TOLD_LINES)` goes, since `lines` holds no more than that).

No other change. The behaviour seen from outside is the same: the last 20 non-debug lines, joined by `\n`.

## 3. Test table

One assertion per `it`; the cite starts the name. `started`, `fixture` and `causeAfter` are the file's existing helpers.

| Cite | Terminal output, then exit 1 | Expected |
|---|---|---|
| #434 | 20 lines `scp: error 0` … `scp: error 19` | `detail` split on `\n` has 20 lines, the first `scp failed: scp: error 0` |
| #434 | 21 lines `scp: error 0` … `scp: error 20` | `detail` split on `\n` has 20 lines, the first `scp failed: scp: error 1` |

Each of the two rows must fail when `TOLD_LINES` is 19 or 21; check both by hand before the PR, and say so in it.

Existing rows:
- `#402: a cause followed by 199 debug lines is still told` stays as it is.
- `themis on #413: a cause followed by 250 debug lines is still told, the cap counts only the kept lines` stays as it
  is. Debug lines are never kept, so it still holds.
- `#402: a long output is cut to its latest lines, and the cause at its end is still told` (300 lines) stays as it is.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: the copy terminal keeps exactly the lines it tells (card ssh-33, #434)`.

## 6. Open rows

None.
