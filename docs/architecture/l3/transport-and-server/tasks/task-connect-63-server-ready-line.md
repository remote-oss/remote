# Task card connect-63: the server's ready line and failure lines are matched in their whole-line form

Issue: #836. Release 0.2, **gating** (ADR-0010 rule 2, "matched as narrowly as that form allows"; audit connect-59
#832, row P9). Size: S. Builder: `task:claude`, or selene if hermes prefers; it's a script edit with real-shell rows.

## 1. The defect

`lib-server/src/scripts/bootstrap.ts` `startBody`:
- `ready_port` (`:507`): `sed -n 's/.*Extension host agent listening on \([^ ]*\).*/\1/p' "$LOG_FILE" | tail -n 1`.
  This is unanchored on both sides: any line holding the phrase anywhere counts, and the value runs to the first
  space;
- `start_failed` (`:511`, `:513`): `grep -q 'Could not find free port in range'` and `grep -q 'Server terminated due to
  presence of CVE-2020-1416'` are substrings;
- `started` (`:522`): `case $SOCKET_MODE:$1 in … no:[0-9]*)` accepts `5abc` as a port.

The stream itself qualifies under rule 2: the server's own log, which our non-login start script redirects. But these
matches aren't as narrow as the line's form allows.

## 2. The fix

1. **Measure the forms first.** In `tests/acceptance/server/real-server.test.ts`'s run, record the real server log's
   ready line for port mode and for socket mode. Then record the two failure lines (a busy range with `--port` set to
   a range, and the CVE line if it can be made; otherwise its text from the server's own source, cited `[oss]`). Paste
   them in the PR.
2. **`ready_port`:** port mode `sed -n 's/^Extension host agent listening on \([0-9][0-9]*\)$/\1/p'`; socket mode
   `sed -n 's/^Extension host agent listening on \(\/[^ ]*\)$/\1/p'`. Choose the form by `$SOCKET_MODE`. Allow one
   trailing `\r` if the measurement shows one. Keep `tail -n 1`: the server writes a new line on each start.
3. **`start_failed`:** `grep -q '^<measured whole line or its fixed prefix>'`, anchored at the start.
4. **`started`:** port mode accepts only `no:[1-9][0-9]*` with nothing after. Reject any other character, with
   `case $1 in *[!0-9]*|'') start_failed ;; esac` before the existing `case`.
5. `READY_LINE` stays exported from `posix-script.ts`, as the shared text of both forms.

## 3. Rows (`lib-server/test/unit/bootstrap-script.test.ts`, the `fakeHost` style)

| Name | Given | Expected |
|---|---|---|
| `ADR-0010: a line that only contains the ready phrase is not the ready line` | a log with `debug: Extension host agent listening on 1234 (old)` and then no real line, until the ready wait ends | not `Ok`; `ServerFailedToStart` (fails on main) |
| `ADR-0010: the ready port is digits only` | `Extension host agent listening on 5abc` | not started on `5abc` (fails on main) |
| `ADR-0010: a failure phrase mid-line is not the failure` | a log with `note: Could not find free port in range earlier` | no `server.failure noFreePort` (fails on main) |
| `F-2409: the measured ready line, port and socket` | the measured lines | the port, the socket path |
| `ADR-0010: noise around the ready line` | N1–N5 (connect-59 §3) before and after the real line | the real port |

**Defect rule:** the first three rows must fail on main and pass with the fix. Paste both runs.

## 4. Gates and review

Run all gates, shellcheck, and `pnpm test:acceptance:server` (the real-server rows). Use the PR title
`lib-server: the server's ready and failure lines are matched in their whole-line form (card connect-63, #836)`.
Request athena only.

## 5. Open rows (stop and report on #836)

1. The real server prints its ready line with a prefix (a time stamp, a log level). Then anchor on that prefix's
   measured form, and report it.
