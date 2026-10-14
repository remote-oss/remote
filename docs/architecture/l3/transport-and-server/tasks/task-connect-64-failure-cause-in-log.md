# Task card connect-64: a failed connect logs ssh's own error lines and exit status

Issue: #840. Milestone 0.2. Size: M. Builder: assigned by hermes (`task:claude`). Reported by proteus, from a trace
capture on main 6e180cc (pinned VSCodium x64, `remote.SSH.logLevel` trace).

## 1. The defect

**What proteus saw:** with an alias whose `Port` is closed (`127.0.0.1:1`), the "Remote - SSH" log ends with
`connect failed: unknown`, and nothing before it gives the cause. There's no ssh error text, no `Connection refused` and
no exit status.

**What ssh gives** (measured here, OpenSSH 10.2p1, `ssh -o BatchMode=yes -p 1 127.0.0.1 true`): the stderr line
`ssh: connect to host 127.0.0.1 port 1: Connection refused`, and exit status 255. With `-v` it adds
`debug1: connect to address 127.0.0.1 port 1: Connection refused`.

**Why the window never logs it.** It's the same in both modes.

- **Shared mode:**
  - The helper collects ssh's stderr lines while connecting (`lib-ssh/src/connection-server/handler.ts:256`, `:304`)
    and classifies them with the exit status (`handler.ts:341`).
  - Its `loginFailed` event then carries only `kind`, `reason` and `hints` (`handler.ts:343-354`;
    `connection-server/messages.ts:87-92`, `:343-355`). The lines and the status stay in the helper.
  - The client turns the event into `ConnectionFailure` `loginFailed` with the same three fields
    (`connection-server/client.ts:83-89`, `:234-246`).
  - remote-ssh maps it with no `logDetail` (`pipeline/failure.ts:206-211`).
  - So `connect.ts`'s `failure()` (`pipeline/connect.ts:182-188`) writes only `connect failed: <kind>`.
- **Terminal mode:** `failureOf(end, lines)` (`pipeline/terminal-connection-step.ts:80-92`) classifies the login
  terminal's lines and `end.code`, and drops both. There's no `logDetail` either.
- **Why `unknown`:** `Connection refused` isn't one of the classifier's network texts
  (`lib-ssh/src/diagnostics/rules.ts:43-54`). That's right for the dialog: F-2501 AC-17 and F-2601 AC-1 say a refused
  connection shows `Could not establish connection to "<alias>".` with no reason. So the dialog stays as it is, and only
  the log changes.

**Gating, for athena:**
- What the log carries belongs to F-2003, which isn't in slice 1.
- F-2601 AC-18 only requires that the "Remote - SSH" channel is shown behind the dialog. Today we show a channel that
  names no cause.
- athena's ruling on #668 ("a connect that ends in `retriesExhausted` logs the last attempt's cause") covered only
  `retriesExhausted` (server-19).
- This card proposes the same rule for every failed connect and asks her to rule it gating. It's filed on 0.2 until
  then.

## 2. The fix

**One rule:** the log carries the lines the classifier read, and ssh's exit status, before `connect failed: <kind>`.

1. **lib-ssh, the helper's event** (`messages.ts`, `handler.ts`).
   - `loginFailed` gains:
     - `errorLines: string[]`: the array the handler passed to `classify`, its last 40 lines;
     - `exitStatus: number | null`: `status`, or `null` when ssh ended on a signal.
   - The bootstrap-exited branch (`handler.ts:334-339`) sends them too.
   - `readLoginFailed` accepts the event with or without the two fields. A helper of an earlier build that's still
     running sends neither, and that's no error. When present, the fields are validated: an array of strings, and a
     number or `null`.
2. **lib-ssh, the client** (`client.ts`). `ConnectionFailure` `loginFailed` gains `errorLines?: readonly string[]` and
   `exitStatus?: number | null`, passed through.
3. **remote-ssh, the step failure** (`pipeline/steps.ts`). `StepFailure` gains
   `sshOutput?: {lines: readonly string[]; exitStatus: number | null | undefined}`.
   - **Shared mode:** `ofConnection`'s `loginFailed` sets it from the two fields.
   - **Terminal mode:** `failureOf(end, lines)` sets it from `lines` and `end.code`. The cancelled-trust branch sets
     nothing.
4. **remote-ssh, `connect.ts`'s `failure()`.** Before its `connect failed: <kind>` line, when `step.sshOutput` is set:
   - each line of `logLinesOf(lines)` (lib-ssh's existing filter, which drops `debug1:` lines except the server host
     key) as `[ssh] <line>` at **warn**;
   - each other line (the dropped `debug1:` lines) as `[ssh] <line>` at **trace**, so a trace capture holds all of them;
   - `ssh exited with status <n>`, or `ssh ended on a signal` for `null`, at **warn**.

   The logger's redaction applies as for every line. ssh's stderr before the session holds no secret of ours:
   passwords go through the askpass, never stderr.

**How it composes with connect-60 (#833, card PR #837).** connect-60 narrows what the classifier reads to the lines
before `Authenticated to`. This card logs exactly the array `classify` receives, so whichever card lands second
inherits the other's window: a `.bashrc`'s noise after authentication is neither classified nor logged as the cause.

- **If connect-60 lands first,** pass its narrowed array.
- **If this card lands first,** connect-60 changes the one array that both the classifier and the log use.

A refused connection never authenticates, so all its lines are in either window.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| lib-ssh `connection-handler.test.ts` (the helper over a fake ssh) | `connect-64: a refused login tells the windows ssh's error lines and its exit status` | the fake ssh writes `ssh: connect to host 127.0.0.1 port 1: Connection refused` and exits 255 | the broadcast `loginFailed` has `kind` `unknown`, `errorLines` holding that line, and `exitStatus` 255 |
| same | `connect-64: the event keeps the last 40 lines` | 50 stderr lines | `errorLines` is the last 40 |
| lib-ssh `connection-messages.test.ts` | `connect-64: a loginFailed event with and without the error lines and the status` | both shapes; then `errorLines: [1]` and `exitStatus: 'x'` | read as given; read as given without the fields; `undefined` (refused) for each bad shape |
| remote-ssh `failure.test.ts` | `connect-64: a failed shared login keeps ssh's output for the log` | `ofConnection` of `loginFailed` with lines and 255 | `sshOutput` is `{lines, exitStatus: 255}` |
| remote-ssh `terminal-connection-step.test.ts` | `connect-64: a failed terminal login keeps its lines and exit code for the log` | a login terminal that prints the refusal line and ends with code 255 | the step's failure has `sshOutput` with that line and 255 |
| remote-ssh `connect.test.ts` (the pipeline fixture, a recording logger) | `connect-64: a failed connect logs ssh's lines and status before the failure line` | a step failure with `sshOutput` `{lines: ['debug1: connect to address 127.0.0.1 port 1: Connection refused', 'ssh: connect to host 127.0.0.1 port 1: Connection refused'], exitStatus: 255}` | in order: trace `[ssh] debug1: connect …`; warn `[ssh] ssh: connect to host 127.0.0.1 port 1: Connection refused`; warn `ssh exited with status 255`; warn `connect failed: unknown` |
| same | `connect-64: an ssh that ended on a signal` | `exitStatus: null` | warn `ssh ended on a signal` |
| same | `connect-64: a failure without ssh output logs as today` | no `sshOutput` | only `connect failed: <kind>`, and its detail line if any |

**Defect rule:** the first, fourth, fifth and sixth rows must fail on main and pass with the fix. Paste both runs.

**Acceptance proof** (the windows suite, the `refused` alias that coverage-19 adds, `HostName 127.0.0.1` and a closed
port): after the failure dialog, `connectionLog()` holds `[ssh] ssh: connect to host 127.0.0.1 port <P>: Connection
refused` and `ssh exited with status 255`, before `connect failed: unknown`. The dialog text is unchanged:
`Could not establish connection to "refused".` Add the row to `tests/acceptance/windows/authority.test.ts` beside
coverage-19's F-2501 AC-17 row, cited `connect-64`. If coverage-19 hasn't merged, add the `refused` alias as its card
§1 defines it.

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-consumed,
check-coverage and coverage, with the changed files at 100 %, plus the VSCodium run for the acceptance row. Use the PR
title `lib-ssh, remote-ssh: a failed connect logs ssh's own error lines and exit status (card connect-64, #840)`.
Request athena only; hermes assigns the peer.

## 5. Open rows (stop and report on #840)

1. athena rules the card non-gating. Then it stays on the board with no milestone. Build nothing until it's
   re-planned.
2. A test on main asserts that a failed connect logs exactly one line. Name it, and change only its expectation,
   citing this card.
