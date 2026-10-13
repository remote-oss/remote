# Task card ssh-38: a login shell that never finishes its startup fails the connect as a timeout (#443)

Issue: #538. Why: athena's ruling on #443 after `remote-oss/remote-ssh#91` (2026-10-13). F-2704 AC-11 (a startup file
that reads its input or pauses past the connect timeout) and F-2206 AC-28 (a login shell that doesn't answer) both
require F-2601's timeout failure, `Connecting with SSH timed out.`, after the connect wait. Today ssh-34's session
bootstrap (`packages/lib-ssh/src/connection-server/session-bootstrap.ts`) has its watchdog kill layer 1 at
`LAYER1_SECONDS` (the connect timeout), then goes on to `exec sh` **without** the profile environment, and the connect
succeeds. Builder: daedalus after cli-07, or hestia (hermes assigns). Size: M.

Not in this card:
- a startup file that **replaces bash with fish** still connects through layer 1 (athena has asked metis to mark that
  AC-11 case reference-only);
- a login shell that **exits by itself** without printing `LAYER1-START` (F-2704 AC-13, `.profile` ending `exit 1`):
  athena rules separately, and its behaviour stays as today.

## 1. The bootstrap (`session-bootstrap.ts`)

- **The watchdog notes that it fired.** Just before `kill -9 -"$LAYER1_PID" "$LAYER1_PID"`, it creates
  `"$LAYER1_DIR/timeout"` (`: >"$LAYER1_DIR/timeout"`).
- **After the waits, a fired watchdog with no start line ends the session.** When `"$LAYER1_DIR/timeout"` exists and
  `"$LAYER1_DIR/out"` holds no line `LAYER1-START`, the prelude prints exactly one line, `LAYER1-TIMEOUT
  <LAYER1_SECONDS>`, removes `"$LAYER1_DIR"`, and runs `exit 124` instead of `exec sh`.
- **Every other case is unchanged:** a start line present (the environment is taken, then `exec sh`); layer 1 ending
  by itself without the start line; `$SHELL` unusable; no temporary folder. All of these go on to `exec sh` as today.
- The comment above `SESSION_BOOTSTRAP_LINES` says the session reaches `exec sh` **unless** the login shell outlasts
  its bound.

## 2. The two readers

**The shared session (helper, `helper.ts` and the runtime that writes `sessionPrelude`):** a session whose first line
of output is `LAYER1-TIMEOUT <n>` and which then ends doesn't become a working connection. The acquire fails with the
existing failure for a login that timed out, the same one the helper's own connect wait gives. The connect then fails
as F-2601's timeout, `Connecting with SSH timed out.`, and the log has one line: `the login shell did not finish its
startup within <n> s`. Where the helper reads the session's first output, recognise the line there. The marker is not
a run's output and is never passed to `ShellRuns`.

**Terminal mode (`terminal/terminal-runs.ts`):** the same line in the terminal's output after the prelude ends the
connect the same way, with the same log line.

The marker names no secret and no path. It's a fixed word, a space and a number.

## 3. Rows

| Cite | Given | Expected |
|---|---|---|
| F-2704 AC-11 | the bootstrap run by `sh` with `SHELL` a script that sleeps past `LAYER1_SECONDS=1` | its output is exactly `LAYER1-TIMEOUT 1`, and it exits 124 |
| #443 | the same with a shell that prints the start line at once | no `LAYER1-TIMEOUT`, and the session reaches `exec sh` (a following `echo ok` prints `ok`) |
| F-2704 AC-13 (unchanged) | a shell that exits 1 at once, with no start line | no `LAYER1-TIMEOUT`; it goes on to `exec sh` as today |
| #443 | the bootstrap's temporary folder | it's gone after the timeout |
| F-2704 AC-11 | the helper's session whose first line is `LAYER1-TIMEOUT 5` | the acquire fails with the login-timeout failure, and the log has `the login shell did not finish its startup within 5 s` |
| F-2704 AC-11 | terminal mode, the same line | the connect fails the same way |
| F-2206 AC-28 (real host) | tooling-17's `mute` alias, default mode | the connect fails with the timeout failure after the connect wait, never succeeds |
| F-2704 AC-11 (real host) | ssh-34's sleeping `.bash_profile` row | it becomes a timeout row: the connect fails, where today it succeeds without the profile's variables |

Update ssh-34's real-host row in `tests/acceptance/server/login-shells.test.ts` and `tests/acceptance/server/*` for
the sleeping profile (it expected success without the profile environment). It now expects the timeout.

## 4. Gates and review

The repository's gates, the changed files at 100/100/100. PR title `lib-ssh: a login shell that never finishes its
startup fails the connect as a timeout (card ssh-38, #443)`. athena, themis or triton.
