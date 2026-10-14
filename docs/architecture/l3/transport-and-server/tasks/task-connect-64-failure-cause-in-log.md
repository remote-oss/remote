# Task card connect-64: a failed connect logs ssh's own error lines and exit status

Issue: #840. Release 0.2, **gating** (athena's F-2003 scope ruling, register 2bb86d6: BR-6 item 11 with BR-7). Size: S.
Builder: assigned by hermes (`task:claude`). Reported by proteus, from a trace capture on main 6e180cc (pinned VSCodium
x64, `remote.SSH.logLevel` trace).

**One ssh-stderr pipeline (athena, 2bb86d6).** connect-66 (#845) collects ssh's error lines once, as `SshLines`, and
logs them live as `[ssh] …`, filtered by level. connect-60 (#833) classifies from the same collection. So this card
never logs ssh's error lines itself. Its part is what's left of the cause: ssh's exit status, and the failure line.

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

**Gating:** athena ruled BR-6 item 11 with BR-7 (the final error, with its cause) gating for 0.2 (register 2bb86d6).

## 2. The fix

**One rule:** before `connect failed: <kind>`, the log carries ssh's exit status. ssh's error lines themselves are
connect-66's: they're already in the log, live and marked `[ssh]`, by the time the connect fails. This card logs them
nowhere.

1. **lib-ssh, the helper's event** (`messages.ts`, `handler.ts`).
   - `loginFailed` gains `exitStatus: number | null`: `status`, or `null` when ssh ended on a signal.
   - The bootstrap-exited branch (`handler.ts:334-339`) sends it too.
   - `readLoginFailed` accepts the event with or without the field. A helper of an earlier build that's still running
     doesn't send it, and that's no error. When present, it's validated: a number or `null`.
   - **No line array in the event.** The lines reach the window through connect-66's `sshLines` events.
2. **lib-ssh, the client** (`client.ts`). `ConnectionFailure` `loginFailed` gains `exitStatus?: number | null`, passed
   through.
3. **remote-ssh, the step failure** (`pipeline/steps.ts`). `StepFailure` gains `sshExitStatus?: number | null`.
   - **Shared mode:** `ofConnection`'s `loginFailed` sets it from the event's field.
   - **Terminal mode:** `failureOf(end, …)` sets it from `end.code`. The cancelled-trust branch sets nothing.
4. **remote-ssh, `connect.ts`'s `failure()`.** Before its `connect failed: <kind>` line, when `step.sshExitStatus` is
   set (not `undefined`): `ssh exited with status <n>`, or `ssh ended on a signal` for `null`, at **warn**. Nothing else
   is added.

**With connect-66 and connect-60 (whichever lands second):**
- **If this card lands first:** connect-66 removes nothing from it, because this card never carried the lines. If an
  earlier build of this card did carry `errorLines` or an `sshOutput` log, connect-66 removes that duplication, as its
  §4 says.
- **If connect-66 lands first:** this card adds only the status field and the status line, and the failure line stays
  as today.
- **connect-60** changes only what the classifier reads (`SshLines.beforeAuthentication()`). This card doesn't depend
  on it.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| lib-ssh `connection-handler.test.ts` (the helper over a fake ssh) | `connect-64: a refused login tells the windows ssh's exit status` | the fake ssh writes `ssh: connect to host 127.0.0.1 port 1: Connection refused` and exits 255 | the broadcast `loginFailed` has `kind` `unknown` and `exitStatus` 255, and no line array |
| lib-ssh `connection-messages.test.ts` | `connect-64: a loginFailed event with and without the exit status` | both shapes; then `exitStatus: 'x'` | read as given; read as given without the field; `undefined` (refused) for the bad shape |
| remote-ssh `failure.test.ts` | `connect-64: a failed shared login keeps ssh's exit status for the log` | `ofConnection` of `loginFailed` with 255 | `sshExitStatus` 255 |
| remote-ssh `terminal-connection-step.test.ts` | `connect-64: a failed terminal login keeps its exit code for the log` | a login terminal that prints the refusal line and ends with code 255 | the step's failure has `sshExitStatus` 255 |
| remote-ssh `connect.test.ts` (the pipeline fixture, a recording logger) | `connect-64: a failed connect logs ssh's exit status before the failure line` | a step failure with `sshExitStatus` 255 | in order: warn `ssh exited with status 255`; warn `connect failed: unknown`; and no `[ssh]` line from this path |
| same | `connect-64: an ssh that ended on a signal` | `sshExitStatus: null` | warn `ssh ended on a signal` |
| same | `connect-64: a failure without an exit status logs as today` | no `sshExitStatus` | only `connect failed: <kind>`, and its detail line if any |

**The `[ssh]` lines are connect-66's rows**, not this card's: `F-2003 BR-8` and `F-2003 BR-9 point 1` (`ssh-log.test.ts`),
and `F-2003 BR-6 item 6: the window logs each line once` (`connection-step.test.ts`). Cite them in this card's PR as the
proof of the lines' half.

**Defect rule:** the first, third, fourth and fifth rows must fail on main and pass with the fix. Paste both runs.

**Acceptance proof** (the windows suite, the `refused` alias that coverage-19 adds, `HostName 127.0.0.1` and a closed
port): after the failure dialog, `connectionLog()` holds `ssh exited with status 255` before `connect failed: unknown`.
Once connect-66 has merged, the same row also asserts `[ssh] ssh: connect to host 127.0.0.1 port <P>: Connection
refused` before it, cited connect-66 (F-2003 AC-24). The dialog text is unchanged: `Could not establish connection to
"refused".` Add the row to `tests/acceptance/windows/authority.test.ts` beside coverage-19's F-2501 AC-17 row, cited
`connect-64`. If coverage-19 hasn't merged, add the `refused` alias as its card §1 defines it.

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-consumed,
check-coverage and coverage, with the changed files at 100 %, plus the VSCodium run for the acceptance row. Use the PR
title `lib-ssh, remote-ssh: a failed connect logs ssh's own error lines and exit status (card connect-64, #840)`.
Request athena only; hermes assigns the peer.

## 5. Open rows (stop and report on #840)

1. A test on main asserts that a failed connect logs exactly one line. Name it, and change only its expectation,
   citing this card.
