# Coding brief: lib-log (slice 1, build-order step 6)

> Issued by `remote-architect` 2026-10-07; the PM allocates the seat. A small library; after a Claude coder sets the
> package shape and the adapter, the pure parts (redaction, once-per-session, level filtering) are one local-worker
> card. Binding: ADR-0002, 0003, 0007, 0008. Requirements: `c4-l2-containers.md` (lib-log row), constraints 58–60
> (no telemetry; F-3905: no event-payload lines), F-2003 (the Remote - SSH log), F-0104 (containers' log), F-6002
> (WSL's log and terminal sink), the area B needs (`contracts.md` §5 of windows-and-explorer).

## What is built

`packages/lib-log`, a root library (depends on nothing). Consumers: every package that has a log by spec
(containers, ssh, wsl, server) and every library that reports (a logger is passed in; no global).

| Piece | Content |
|---|---|
| `src/index.ts` | `Logger` (levels trace, debug, info, warn, error; `child(scope)`), `createLogger(sink, options)`, `logOncePerSession(logger, key, line)`, the redaction rule, the level filter driven by a getter the package wires to its log-level setting |
| `src/sinks/` | the output-channel sink (created lazily on first line, only where a spec has a channel; name from the identifier table), the terminal sink (a named terminal with a per-extension-host buffer, F-6002), a memory sink for tests |
| `src/redaction.ts` | the rule libraries cannot bypass: tokens (connection tokens, access tokens, nonces), prompt answers, authority connection tokens, anything a caller marks `secret(value)`; applied before any sink; a line that still matches a token shape after redaction is dropped and replaced by a fixed marker |
| `src/testing/` | the memory sink and a redaction fixture set |

## Behaviour to get right (each a named test)

- A package with no log by spec (explorer F-5901 §6, ssh-edit F-4002 AC-14) never creates a channel: creating a
  logger with no sink is valid and silent.
- The channel is created on the first line, not at activation (F-2003 BR-1 class of criteria; the exact ACs are the
  consuming package's).
- `logOncePerSession(key)`: the second call with the same key in one extension-host session writes nothing; a new
  session writes again (F-5902 and F-3906 rule 9's version-mismatch line).
- Levels: lines below the package's level never reach a sink; the getter is read per line (a setting change applies
  at once).
- Redaction: every fixture secret is replaced in the line and in structured arguments; a `secret()`-wrapped value
  never appears in any sink in any level; prompt answers passed by mistake are caught by the token-shape rule.
- Never: event-payload lines, telemetry-shaped lines (F-3905 rule 4): the API has no method for them, and a lint
  rule forbids `console.*` in packages.
- The terminal sink keeps a buffer per extension host and replays it when the terminal is shown later (F-6002).

## Acceptance

No slice-1 acceptance criterion names the library directly; the consuming packages' log criteria (F-2003's lines
by meaning) run in the harness later. Unit coverage at the ADR-0003 gates now.

## Done

Gates green; library convention; ADR-0008 in README and comments; PR body answers R1–R6.
