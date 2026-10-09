# Task card log-03: redact the matching run, not the whole message; commit ids are not secrets

Why: the merged rule replaces a whole message that still contains a run of 32 or more word characters, and every
40-hex commit id triggers it, so server-install logs lose their text. Ruled 2026-10-08 by the lead (lib-log contract).
Reviewing coder: `remote-coding-worker-1`.

## 1. File boundary

`packages/lib-log/src/redaction.ts`, its tests; the README's redaction sentence. Nothing else.

## 2. Contract

- A run of 32 or more word characters (`[A-Za-z0-9_-]`) that is not exempt is replaced by `[redacted]`; the rest
  of the message stays.
- Exempt: a run of exactly 40 lower-case or upper-case hex characters (a commit id), and a run of exactly 64 hex
  characters (a sha256), as whole words.
- Explicit secrets (the `secrets` getter) are still replaced wherever they appear, before the run rule.
- The marker is never applied twice to the same span.

## 3. Test table

| Given | Expected |
|---|---|
| `'token abcdefghijklmnopqrstuvwxyz012345 ok'` | `'token [redacted] ok'` |
| `'commit 0123456789abcdef0123456789abcdef01234567 installed'` (40 hex) | unchanged |
| `'sha ' + 64 hex` | unchanged |
| 39 hex | `[redacted]` for the run |
| 41 hex | `[redacted]` for the run |
| `'0123456789abcdef0123456789abcdef01234567_x'` (40 hex plus `_x`, one run of 42) | `[redacted]` |
| two runs in one message | both replaced, text between kept |
| secrets `['hunter2']` and `'pw hunter2 and ' + 40 hex` | `'pw [redacted] and ' + the 40 hex` |
| a message with no run | unchanged |
| `'[redacted]'` already present | unchanged (not doubled) |

## 4. Rule for the worker

As card log-01; the ratchet may only rise.

## 5. Gates and review

PR title `lib-log: redact runs, exempt commit and digest ids (card log-03)`.

## 6. Open rows

None.
