# Task card ssh-07: three spec additions after the first run (control characters in host names; include cycle guard; hidden-file wildcards)

Brief: `../brief-lib-ssh-pure.md`. Contract: `../contracts.md` §3 S4 (config model) and S2/S1 host-name validation
(F-2205 as revised: BR-1 and the new AC-37; F-2202 BR-10/BR-11 as revised). Depends on #65 merged. Reviewing coder:
`remote-coding-worker-1`.

## 1. Package and file boundary

`packages/lib-ssh`: `src/arguments/target.ts` (or wherever host-name validation lives after #65), `src/config/files.ts`
and `src/config/hosts.ts`; their existing test files. Nothing else.

## 2. Contract

- Host-name validation (F-2205 BR-1, AC-37): a host name containing any character U+0000–U+001F or U+007F is
  invalid; the failure carries the string id `S120` with `{0}` = the code point of the first such character formatted
  `U+XXXX` (four upper-case hex digits); the existing forbidden-character path is used (same failure kind), and it
  fires before anything is spawned.
- Include cycle guard (F-2202 BR-10 as revised): a file already in the current include chain is not read again; the
  include is skipped silently (no parse error), and files included later by another path are still read once.
- Hidden files (F-2202 BR-11 as revised): a wildcard (`*`, `?`, `[...]`) does not match a leading `.`; a hidden file is
  included only by a pattern whose own name segment starts with `.`.

## 3. Test table

| Given | Expected |
|---|---|
| host `"a\nb"` | invalid, `S120`, `{0}` = `U+000A` |
| host `"a\tb"` | invalid, `U+0009` |
| host `"\u007Fx"` | invalid, `U+007F` |
| host `"a\u0000b\u001F"` | invalid, `U+0000` (the first) |
| host `"host.example"` | valid (unchanged behaviour) |
| host `"a b"` | the pre-existing result for a space (unchanged; assert it is still the same kind) |
| the invalid case through `connect`-level entry (whatever S2 exposes) | no invocation is built (the spawner fake sees no call) |
| config `a` includes `b`, `b` includes `a` | both read once; no error; hosts of both present |
| `a` includes `a` | read once; no error |
| `a` includes `b` and `c`; `b` includes `c` | `c` read once (hosts not duplicated); order per the existing rule |
| `a` includes `b`; later `a` includes `b` again (two Include lines) | second skipped; one copy |
| Include `conf.d/*` with files `x`, `.hidden` | `x` only |
| Include `conf.d/.*` with files `x`, `.hidden` | `.hidden` only |
| Include `conf.d/?idden` with `.hidden` | nothing |
| Include `conf.d/[.]hidden` with `.hidden` | nothing (BR-12: only a pattern whose name segment itself starts with `.` matches a hidden file; a bracket class does not) |
| Include of an exact hidden name `conf.d/.hidden` (no wildcard) | included (not a wildcard) |

## 4. Rule for the worker

As card log-01 (tests first; no behaviour beyond the table; standards; full gate list; the ratchet may only rise).

## 5. Gates and review

PR title `lib-ssh: control characters, include cycle guard, hidden-file wildcards (card ssh-07)`. Reviewer:
`remote-coding-worker-1`.

## 6. Open rows (stop and report)

None expected.
